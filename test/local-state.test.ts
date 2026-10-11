import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const URL = "http://127.0.0.1:42069";

/** `serve` up over Repos `acme/api` and `acme/web`, each with one Ready issue, its first Sync done. */
async function serving(ctx = setup()) {
  const { cli, world } = ctx;
  for (const name of ["api", "web"]) {
    world.addClone(`/src/${name}`, `git@github.com:acme/${name}.git`);
    await cli("repo", "add", `acme/${name}`, "--path", `/src/${name}`);
    world.addIssue(`acme/${name}`, { number: 7, title: `Add retries to ${name}` });
  }
  expect((await cli("serve")).exitCode).toBe(0);
  await settled();
  return ctx;
}

/** Let what serve started without awaiting, such as its first Sync, run to its end. */
async function settled() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function get(ctx: ReturnType<typeof setup>, path: string) {
  return ctx.world.server!.handler(new Request(`${URL}${path}`));
}

describe("Local state", () => {
  test("the app's reads and the Lead's board tool answer from Local state, without a call to the outside world", async () => {
    const ctx = await serving();
    ctx.world.calls.length = 0;

    const board = await (await get(ctx, "/api/board")).json();
    expect(board.issues).toMatchObject([{ issue: "acme/api#7" }, { issue: "acme/web#7" }]);
    expect((await get(ctx, "/api/partners")).status).toBe(200);
    expect((await (await get(ctx, "/api/stats")).json()).days).toBe(30);
    expect((await (await get(ctx, "/api/stats?days=7&repo=acme/api")).json()).days).toBe(7);
    expect((await (await get(ctx, "/api/repos")).json()).repos).toMatchObject([{ slug: "acme/api" }, { slug: "acme/web" }]);
    const mcp = await ctx.world.server!.handler(
      new Request(`${URL}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "board" } }) }),
    );
    expect(JSON.parse(await mcp.text()).result.structuredContent.issues).toMatchObject([{ issue: "acme/api#7" }, { issue: "acme/web#7" }]);

    expect(ctx.world.calls).toEqual([]);
  });
});

describe("Sync", () => {
  test("a restarted serve answers from state.json before its first Sync ends", async () => {
    const first = await serving();
    first.world.githubIssueNamed("acme/api", 7).title = "Add retries, renamed";
    first.world.addIssue("acme/web", { number: 8, title: "Cache the index" });

    // The same config directory, a new serve whose first Sync waits on GitHub.
    const ctx = { ...first };
    const release = ctx.world.holdGitHub("acme/api");
    expect((await ctx.cli("serve")).exitCode).toBe(0);
    await settled();
    ctx.world.calls.length = 0;
    const before = await (await get(ctx, "/api/board")).json();
    // acme/web synced on its own meanwhile; acme/api is as state.json kept it.
    expect(before.issues).toMatchObject([{ issue: "acme/api#7", title: "Add retries to api" }, { issue: "acme/web#7" }, { issue: "acme/web#8" }]);
    expect(ctx.world.calls).toEqual([]);

    release();
    await settled();
    const after = await (await get(ctx, "/api/board")).json();
    expect(after.issues).toMatchObject([{ issue: "acme/api#7", title: "Add retries, renamed" }, { issue: "acme/web#7" }, { issue: "acme/web#8" }]);
  });

  test("a Repo that fails keeps its last Board and records why, while the others sync", async () => {
    const ctx = await serving();
    ctx.world.addIssue("acme/web", { number: 8, title: "Cache the index" });
    ctx.world.failGitHub("acme/api", "ssh: connect to host github.com port 22: Connection timed out");
    expect((await post(ctx, "/api/sync")).status).toBe(200);

    const board = await (await get(ctx, "/api/board")).json();
    expect(board.issues).toMatchObject([{ issue: "acme/api#7" }, { issue: "acme/web#7" }, { issue: "acme/web#8" }]);
    expect(board.errors).toBeUndefined();
    expect(board.synced.repos).toEqual([
      { repo: "acme/api", at: "2026-09-30T12:00:00.000Z", error: "ssh: connect to host github.com port 22: Connection timed out", failedAt: "2026-09-30T12:00:00.000Z" },
      { repo: "acme/web", at: "2026-09-30T12:00:00.000Z" },
    ]);
  });

  test("a slow Repo holds up no other: theirs shows while it still syncs", async () => {
    const ctx = await serving();
    ctx.world.addIssue("acme/web", { number: 8, title: "Cache the index" });
    const release = ctx.world.holdGitHub("acme/api");
    const sync = post(ctx, "/api/sync");
    await settled();

    const board = await (await get(ctx, "/api/board")).json();
    expect(board.issues).toMatchObject([{ issue: "acme/api#7" }, { issue: "acme/web#7" }, { issue: "acme/web#8" }]);
    release();
    expect((await sync).status).toBe(200);
  });

  test("POST /api/sync syncs now, and two at once run one Sync", async () => {
    const ctx = await serving();
    ctx.world.addIssue("acme/api", { number: 8, title: "Log retries" });
    ctx.world.calls.length = 0;
    const release = ctx.world.holdGitHub("acme/api");
    const [one, two] = [post(ctx, "/api/sync"), post(ctx, "/api/sync")];
    await settled();
    release();
    expect((await one).status).toBe(200);
    expect(await (await two).json()).toMatchObject({ sync: "done" });

    expect(ctx.world.calls.filter((c) => c === "github issues acme/api")).toHaveLength(1);
    expect((await (await get(ctx, "/api/board")).json()).issues).toMatchObject([{ issue: "acme/api#7" }, { issue: "acme/api#8" }, { issue: "acme/web#7" }]);
  });

  test("a Sync that changes Local state tells the page which parts changed", async () => {
    const ctx = await serving();
    const told: string[] = [];
    const reader = (await ctx.world.server!.handler(new Request(`${URL}/api/events`))).body!.getReader();
    const listen = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        told.push(...decoder.decode(value).split("\n\n").filter((e) => e.startsWith("event: state-changed")));
      }
    })();

    expect((await post(ctx, "/api/sync")).status).toBe(200);
    expect(told).toEqual([]);

    ctx.world.addIssue("acme/web", { number: 8, title: "Cache the index" });
    expect((await post(ctx, "/api/sync")).status).toBe(200);
    expect(told).toEqual(['event: state-changed\ndata: {"parts":["board"]}']);
    void reader.cancel();
    await listen;
  });

  test("serve syncs every sync.intervalSeconds, 120 unless config sets it", async () => {
    const ctx = await serving();
    ctx.world.addIssue("acme/web", { number: 8, title: "Cache the index" });
    const issues = async () => (await (await get(ctx, "/api/board")).json()).issues.map((i: { issue: string }) => i.issue);

    await ctx.world.tick(110_000);
    expect(await issues()).toEqual(["acme/api#7", "acme/web#7"]);
    await ctx.world.tick(10_000);
    await settled();
    expect(await issues()).toEqual(["acme/api#7", "acme/web#7", "acme/web#8"]);
  });
});

describe("Local state between Syncs", () => {
  test("an action taken while a Sync runs shows once a Sync after it ends", async () => {
    const ctx = await serving();
    const release = ctx.world.holdGitHub("acme/api");
    const sync = post(ctx, "/api/sync");
    await settled();
    const args = ["acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high"];
    expect((await post(ctx, "/api/dispatch", { args })).status).toBe(200);

    release();
    await sync;
    await settled();
    const board = await (await get(ctx, "/api/board")).json();
    expect(board.dispatches).toMatchObject([{ issue: "acme/api#7" }]);
    expect(board.issues).toMatchObject([{ issue: "acme/web#7" }]);
  });

  test("each tick reads herdr again, so an agent's state shows without waiting for a Sync", async () => {
    const ctx = await serving();
    const args = ["acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high"];
    expect((await post(ctx, "/api/dispatch", { args })).status).toBe(200);
    await settled();
    const implementer = async () => (await (await get(ctx, "/api/board")).json()).dispatches[0].implementer;
    const agent = [...ctx.world.agentStates.keys()].find((name) => name !== "lead")!;
    ctx.world.agentStates.set(agent, "blocked");
    expect(await implementer()).not.toBe("blocked");

    ctx.world.calls.length = 0;
    await ctx.world.tick(10_000);
    expect(await implementer()).toBe("blocked");
    expect(ctx.world.calls.filter((c) => c.startsWith("git") || c.startsWith("github"))).toEqual([]);
  });

  test("the Repos are read from config as it is now", async () => {
    const ctx = await serving();
    ctx.world.addClone("/src/docs", "git@github.com:acme/docs.git");
    await ctx.cli("repo", "add", "acme/docs", "--path", "/src/docs");
    ctx.world.calls.length = 0;

    expect((await (await get(ctx, "/api/repos")).json()).repos).toMatchObject([{ slug: "acme/api" }, { slug: "acme/web" }, { slug: "acme/docs" }]);
    expect(ctx.world.calls).toEqual([]);
  });
});

function post(ctx: ReturnType<typeof setup>, path: string, body?: unknown) {
  return ctx.world.server!.handler(new Request(`${URL}${path}`, { method: "POST", ...(body !== undefined && { body: JSON.stringify(body) }) }));
}
