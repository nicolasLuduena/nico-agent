import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ADVANCE_INTERVAL_MS as TEN_MINUTES } from "../src/advance";
import { RateLimited } from "../src/world";
import { events, setup } from "./harness";

describe("serve", () => {
  test("serves the web Board on 127.0.0.1:42069", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const { stdout, exitCode } = await cli("serve");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'url: "http://127.0.0.1:42069/"',
        'mcp: "http://127.0.0.1:42069/mcp"',
        "help[2]:",
        "  Open the url in a browser to see the Board; stop the server with Ctrl-C",
        "  Register the MCP server with Claude Code: `claude mcp add --transport http nico-agent http://127.0.0.1:42069/mcp`",
        "",
      ].join("\n"),
    );
    expect(world.calls).toContain("serve 127.0.0.1:42069");
    // `/` is the app's page, bundled by Bun; the build smoke test serves it.
    expect(Object.keys(world.server!.pages)).toEqual(["/"]);

    const response = await world.server!.handler(new Request("http://127.0.0.1:42069/api/board"));
    expect((await response.json()).issues).toMatchObject([{ issue: "acme/api#7", title: "Add retries" }]);

    const mcp = await world.server!.handler(
      new Request("http://127.0.0.1:42069/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "board" } }) }),
    );
    expect(JSON.parse(await mcp.text()).result.structuredContent.issues).toMatchObject([{ issue: "acme/api#7" }]);
  });

  test("--port overrides the port", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("serve", "--port", "8080");
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith('url: "http://127.0.0.1:8080/"\n');
    expect(world.calls).toEqual(["serve 127.0.0.1:8080"]);
  });

  test("a port that is not a number from 1 to 65535 is a usage error", async () => {
    const { cli, world } = setup();
    for (const port of ["http", "0", "70000", "80.5"]) {
      const { stdout, exitCode } = await cli("serve", "--port", port);
      expect(exitCode).toBe(2);
      expect(stdout).toBe(
        [`error: the port must be a number from 1 to 65535 (got \`${port}\`)`, "help[1]:", "  Usage: `nico-agent serve [--port <port>]`", ""].join("\n"),
      );
    }
    expect(world.calls).toEqual([]);
  });

  test("a port already in use is an error suggesting another port", async () => {
    const { cli, world } = setup();
    world.failServe("port 42069 is already in use");
    const { stdout, exitCode } = await cli("serve");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      ["error: port 42069 is already in use", "help[1]:", "  Run `nico-agent serve --port <port>` with a free port", ""].join("\n"),
    );
  });
});

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const NUDGE = "herdr agent prompt lead Read your Inbox";

function nudges(calls: string[]) {
  return calls.filter((c) => c.startsWith(NUDGE)).map(() => NUDGE);
}

describe("serve ticks", () => {
  let log: string[];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    log = [];
    spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => void log.push(args.map(String).join(" ")));
  });
  afterEach(() => spy.mockRestore());

  /** `serve` up, with an idle Lead started and the calls so far forgotten. */
  async function serving() {
    const ctx = setup();
    mkdirSync(ctx.configDir, { recursive: true });
    writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], lead: LAUNCH, scheduler: LAUNCH }));
    expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
    ctx.world.agentStates.set("lead", "idle");
    expect((await ctx.cli("serve")).exitCode).toBe(0);
    ctx.world.calls.length = 0;
    return ctx;
  }

  test("every 10 minutes serve runs advance, which Nudges the Lead once, and logs its report", async () => {
    const { world } = await serving();
    await world.tick(TEN_MINUTES - 10_000);
    expect(nudges(world.calls)).toEqual([]);
    expect(log).toEqual([]);

    await world.tick(10_000);
    expect(nudges(world.calls)).toEqual([NUDGE]);
    expect(log).toEqual(["advance: specs: []"]);

    world.agentStates.set("lead", "idle");
    await world.tick(TEN_MINUTES);
    expect(nudges(world.calls)).toEqual([NUDGE, NUDGE]);
    expect(log).toEqual(["advance: specs: []", "advance: specs: []"]);
  });

  test("the app polling the Board asks GitHub for a Repo's issues once a minute", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    expect((await cli("serve")).exitCode).toBe(0);
    world.calls.length = 0;
    const board = () => world.server!.handler(new Request("http://127.0.0.1:42069/api/board"));
    const asked = () => world.calls.filter((c) => c === "github issues acme/api").length;

    expect((await board()).status).toBe(200);
    await world.tick(10_000);
    expect((await board()).status).toBe(200);
    expect(asked()).toBe(1);

    await world.tick(50_000);
    expect((await board()).status).toBe(200);
    expect(asked()).toBe(2);
  });

  test("serve's advance reads GitHub through the Board's cache", async () => {
    const { cli, world, configDir } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ ...config, scheduler: LAUNCH }));
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    expect((await cli("serve")).exitCode).toBe(0);
    await world.tick(TEN_MINUTES - 30_000);
    world.calls.length = 0;

    expect((await world.server!.handler(new Request("http://127.0.0.1:42069/api/board"))).status).toBe(200);
    await world.tick(30_000);
    expect(log.at(-1)).toStartWith("advance:");
    expect(world.calls.filter((c) => c === "github issues acme/api")).toHaveLength(1);
  });

  test("a rate-limited GitHub shows as one warning with its reset time, and serve asks it again only after the reset", async () => {
    const { cli, world } = setup();
    for (const name of ["api", "web"]) {
      world.addClone(`/src/${name}`, `git@github.com:acme/${name}.git`);
      await cli("repo", "add", `acme/${name}`, "--path", `/src/${name}`);
      world.addIssue(`acme/${name}`, { number: 7, title: "Add retries" });
    }
    const reset = new Date(world.now().getTime() + 5 * 60_000);
    world.failGitHub("acme/api", new RateLimited(reset));
    expect((await cli("serve")).exitCode).toBe(0);
    const board = async () => (await world.server!.handler(new Request("http://127.0.0.1:42069/api/board"))).json();
    const asked = () => world.calls.filter((c) => c.startsWith("github issues")).length;

    const limited = await board();
    expect(limited.warning).toBe(`GitHub rate limit exceeded; nico-agent asks it again at ${reset.toISOString()}`);
    expect(limited.errors).toBeUndefined();
    const before = asked();

    world.failures.clear();
    await world.tick(2 * 60_000);
    expect((await board()).warning).toBe(limited.warning);
    expect(asked()).toBe(before);

    await world.tick(3 * 60_000);
    const resumed = await board();
    expect(resumed.warning).toBeUndefined();
    expect(resumed.issues).toMatchObject([{ issue: "acme/api#7" }, { issue: "acme/web#7" }]);
  });

  test("a dispatch through serve shows on the next Board at once, without waiting out the cache", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    expect((await cli("serve")).exitCode).toBe(0);
    const send = (path: string, init?: RequestInit) => world.server!.handler(new Request(`http://127.0.0.1:42069${path}`, init));
    const board = async () => (await send("/api/board")).json();
    expect((await board()).issues).toMatchObject([{ issue: "acme/api#7" }]);
    world.calls.length = 0;

    const args = ["acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high"];
    expect((await send("/api/dispatch", { method: "POST", body: JSON.stringify({ args }) })).status).toBe(200);
    world.linkPr("acme/api", 7, { number: 17 });
    const after = await board();
    expect(after.dispatches).toMatchObject([{ issue: "acme/api#7", stage: "PR ready", pr: "https://github.com/acme/api/pull/17" }]);
    expect(world.calls.filter((c) => c === "github issues acme/api")).toHaveLength(1);
  });

  test("each tick tells the app the Board may have changed", async () => {
    const { world } = await serving();
    const stream = await events(world.server!.handler);
    await world.tick(10_000);
    expect(await stream.next()).toEqual({ event: "board-changed", data: "{}" });
    expect(await stream.next(50)).toBeNull();

    await world.tick(TEN_MINUTES - 10_000);
    // One per Nudge tick, and one more for the advance tick.
    const sent = [];
    for (let event = await stream.next(50); event; event = await stream.next(50)) sent.push(event.event);
    expect(sent).toEqual(Array(TEN_MINUTES / 10_000).fill("board-changed"));
    await stream.close();
  });

  test("a tick while another advance holds the lock skips with its warning, and the next tick runs", async () => {
    const { configDir, world } = await serving();
    writeFileSync(join(configDir, "advance.lock"), "777");
    await world.tick(TEN_MINUTES);
    expect(nudges(world.calls)).toEqual([]);
    expect(log).toEqual(["advance: specs: []\nwarnings[1]: another advance is running (pid 777); left it to finish"]);

    unlinkSync(join(configDir, "advance.lock"));
    await world.tick(TEN_MINUTES);
    expect(nudges(world.calls)).toEqual([NUDGE]);
    expect(log[1]).toBe("advance: specs: []");
  });

  test("a tick that throws is logged, and serve keeps ticking", async () => {
    const { configDir, world } = await serving();
    const config = join(configDir, "config.json");
    const good = readFileSync(config, "utf8");
    writeFileSync(config, "{ not json");
    await world.tick(TEN_MINUTES);
    expect(log).toHaveLength(1);
    expect(log[0]).toStartWith("advance failed: ");

    writeFileSync(config, good);
    world.agentStates.set("lead", "idle");
    world.calls.length = 0;
    await world.tick(TEN_MINUTES);
    expect(nudges(world.calls)).toEqual([NUDGE]);
    expect(log[1]).toBe("advance: specs: []");
  });
});
