import { describe, expect, test } from "bun:test";
import { events, setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** A Repo with issues 1 and 2 Ready, and 3 and 4 dispatched, 3 with an open PR. */
async function mixed() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  for (const number of [1, 2, 3, 4]) ctx.world.addIssue("acme/api", { number });
  await ctx.cli("dispatch", "acme/api#3", ...FLAGS);
  await ctx.cli("dispatch", "acme/api#4", ...FLAGS);
  ctx.world.linkPr("acme/api", 3, { number: 13 });
  ctx.world.calls.length = 0;
  const post = async (path: string, args: string[] = []) => {
    const { status, body } = await ctx.web(path, { method: "POST", body: JSON.stringify({ args }) });
    return { status, json: JSON.parse(body) };
  };
  return { ...ctx, post };
}

describe("/api actions", () => {
  test("dispatch takes the CLI's arguments and answers with its JSON", async () => {
    const { post, world, cli } = await mixed();
    world.remoteBranches.set("/src/api", ["beta", "main"]);
    const { status, json } = await post("/api/dispatch", ["acme/api#1", ...FLAGS, "--base", "beta"]);
    expect(status).toBe(200);
    expect(json).toMatchObject({ dispatched: "acme/api#1", stage: "Implementing" });
    expect(json.help).toContain("Run `nico-agent show acme/api#1` to see the Dispatch");
    expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-1 --base origin/beta --label api#1 --no-focus");
    expect((await cli("show", "acme/api#1", "--json")).exitCode).toBe(0);
  });

  test("a failed action answers with the CLI's error and help, its status by the exit code", async () => {
    const { post, world } = await mixed();
    world.failCall("herdr worktree create --cwd /src/api --branch agent/api-2 ", "worktree already exists");
    const failed = await post("/api/dispatch", ["acme/api#2", ...FLAGS]);
    expect(failed.status).toBe(422);
    expect(failed.json).toMatchObject({ error: expect.stringContaining("worktree already exists"), stage: "Failed at worktree" });
    expect(failed.json.help.length).toBeGreaterThan(0);

    const usage = await post("/api/dispatch", ["acme/api#2", "--harness", "claude"]);
    expect(usage.status).toBe(400);
    expect(usage.json).toEqual({ error: "missing required flag --model", help: [expect.stringContaining("Usage:")] });
  });

  test("several issues each launch with the same flags, a row each", async () => {
    const { post, world } = await mixed();
    const { status, json } = await post("/api/dispatch", ["acme/api#1", "acme/api#2", "--harness", "claude", "--model", "sonnet", "--effort", "max"]);
    expect(status).toBe(200);
    expect(json.results).toMatchObject([{ issue: "acme/api#1", result: "dispatched" }, { issue: "acme/api#2", result: "dispatched" }]);
    expect(world.calls).toContain("herdr agent start impl-api-1 --kind claude --pane w3:p2 -- --model sonnet --effort max");
  });

  test("review launches a Reviewer on an In-flight issue's PR", async () => {
    const { post, world, cli } = await mixed();
    const { status, json } = await post("/api/review", ["acme/api#3", "--harness", "claude", "--model", "sonnet", "--effort", "max"]);
    expect(status).toBe(200);
    expect(json).toMatchObject({ reviewing: "acme/api#3", pr: "https://github.com/acme/api/pull/13" });
    expect(world.calls.some((c) => c.startsWith("herdr agent start rev-api-3"))).toBe(true);
    expect((await cli("show", "acme/api#3", "--json")).json().reviewer).toBeDefined();
  });

  test("close asks for --confirm while Implementing, and closes with it", async () => {
    const { post, cli } = await mixed();
    const unconfirmed = await post("/api/close", ["acme/api#4"]);
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.json).toEqual({
      error: "acme/api#4 has no PR yet; closing requires confirmation",
      help: ["Run `nico-agent close acme/api#4 --confirm` to remove its workspace and forget the Dispatch"],
    });
    expect((await cli("show", "acme/api#4")).exitCode).toBe(0);

    expect((await post("/api/close", ["acme/api#3"])).json).toMatchObject({ closed: "acme/api#3" });
    expect((await post("/api/close", ["acme/api#4", "--confirm"])).json).toMatchObject({ closed: "acme/api#4" });
    expect((await cli("show", "acme/api#3")).exitCode).toBe(1);
    expect((await cli("show", "acme/api#4")).exitCode).toBe(1);
  });

  test("queue, move and unqueue edit a Repo's Queue", async () => {
    const { post, world, cli } = await mixed();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 });
    world.addGitHubSpec("acme/api", { number: 20, title: "Search" }, { number: 21 });
    expect((await post("/api/queue", ["acme/api#10", "--repo", "acme/api"])).json).toMatchObject({ queued: "acme/api#10" });
    expect((await post("/api/queue", ["acme/api#20", "--repo", "acme/api"])).json).toMatchObject({ queue: ["acme/api#10", "acme/api#20"] });
    expect((await post("/api/move", ["acme/api#20", "up", "--repo", "acme/api"])).json).toMatchObject({ queue: ["acme/api#20", "acme/api#10"] });
    expect((await post("/api/unqueue", ["acme/api#20", "--repo", "acme/api"])).json).toMatchObject({ queue: ["acme/api#10"] });
    expect((await cli("board", "--json")).json().rooms[0].queue).toEqual(["acme/api#10"]);

    const refused = await post("/api/queue", ["acme/api#3", "--repo", "acme/api"]);
    expect(refused.status).toBe(422);
    expect(refused.json.error).toBe("acme/api#3 is not a candidate Spec of acme/api");
  });

  test("advance and harness refresh take no arguments", async () => {
    const { post } = await mixed();
    const advanced = await post("/api/advance");
    expect(advanced.status).toBe(422);
    expect(advanced.json).toMatchObject({ error: expect.stringContaining("the Scheduler defaults"), help: [expect.stringContaining('"scheduler"')] });
    expect((await post("/api/harness/refresh")).json).toMatchObject({ refreshed: expect.any(Array) });
  });

  test("harnesses are `harness list --json`, with the launch remembered", async () => {
    const { web } = await mixed();
    const { status, body } = await web("/api/harnesses");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({
      harnesses: expect.arrayContaining([expect.objectContaining({ name: "claude" })]),
      remembered: { last: { harness: "claude", model: "opus" }, efforts: { "claude opus": "high" } },
    });
  });

  test("only the Board's actions are routes, and their body must be a list of arguments", async () => {
    const { web, world } = await mixed();
    expect((await web("/api/repo/rm", { method: "POST", body: JSON.stringify({ args: ["acme/api"] }) })).status).toBe(404);
    expect((await web("/api/lead/stop", { method: "POST", body: "{}" })).status).toBe(404);
    const bad = await web("/api/dispatch", { method: "POST", body: JSON.stringify({ args: "acme/api#1" }) });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ error: "the body must be {\"args\": [...]}, the CLI's arguments", help: [expect.any(String)] });
    expect(world.calls).toEqual([]);
  });

  test("an action sends board-changed, even a failed one", async () => {
    const { handler, post } = await mixed();
    const stream = await events(handler);
    await post("/api/close", ["acme/api#4"]);
    expect(await stream.next()).toEqual({ event: "board-changed", data: "{}" });
    await stream.close();
  });
});
