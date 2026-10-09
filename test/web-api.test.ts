import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { events, setup } from "./harness";

async function withIssue() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7, title: "Add retries" });
  return ctx;
}

describe("/api/board", () => {
  test("is the Board in the `board --json` shape", async () => {
    const { cli, web } = await withIssue();
    expect((await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high")).exitCode).toBe(0);

    const { status, type, body } = await web("/api/board");
    expect(status).toBe(200);
    expect(type).toBe("application/json; charset=utf-8");
    expect(JSON.parse(body)).toEqual((await cli("board", "--json")).json());
    expect(JSON.parse(body).dispatches).toMatchObject([{ issue: "acme/api#7", stage: "Implementing", implementer: "working" }]);
  });

  test("is the Board even when no Repo could be loaded", async () => {
    const { web, world } = await withIssue();
    world.failGitHub("acme/api", "not authenticated with GitHub; run `gh auth login`");
    const { status, body } = await web("/api/board");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ ready: "0 issues (no Repo could be loaded)", errors: [{ repo: "acme/api" }] });
  });

  test("a corrupt config file is the CLI's error, with its help", async () => {
    const { configDir, web } = setup();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{bad");
    const { body } = await web("/api/board");
    expect(JSON.parse(body)).toEqual({ error: `${join(configDir, "config.json")} is not valid JSON`, help: ["Fix or delete the file and run `nico-agent repo add` again"] });
  });

  test("answers only GET", async () => {
    const { web } = await withIssue();
    expect((await web("/api/board", { method: "POST" })).status).toBe(405);
  });
});

describe("/api/peek", () => {
  test("is an In-flight issue's Implementer screen and its last meaningful line, read from herdr alone", async () => {
    const { cli, web, world } = await withIssue();
    expect((await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high")).exitCode).toBe(0);
    world.screens.set("impl-api-7", "⏺ Running the tests\n  3 pass\n\n╭───╮\n│ > │\n╰───╯\n");
    world.calls.length = 0;

    const { status, body } = await web(`/api/peek?issue=${encodeURIComponent("acme/api#7")}`);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ issue: "acme/api#7", agent: "impl-api-7", line: "3 pass" });
    expect(world.calls).toEqual(["herdr agent read impl-api-7 --source visible"]);
  });

  test("a screen herdr cannot read is the CLI's error", async () => {
    const { cli, web, world } = await withIssue();
    await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high");
    world.failHerdr("agent read", "herdr is not running");
    const { status, body } = await web(`/api/peek?issue=${encodeURIComponent("acme/api#7")}`);
    expect(status).toBe(422);
    expect(JSON.parse(body).error).toContain("herdr is not running");
  });
});

describe("/api/events", () => {
  test("sends board-changed after a Board action posted to the web app", async () => {
    const { handler, web } = await withIssue();
    const stream = await events(handler);
    expect((await web("/api/harness/refresh", { method: "POST", body: "{}" })).status).toBe(200);
    expect(await stream.next()).toEqual({ event: "board-changed", data: "{}" });
    await stream.close();
  });

  test("sends board-changed to every open stream, after an MCP tool call but not a tools/list", async () => {
    const { handler, web } = await withIssue();
    const [first, second] = [await events(handler), await events(handler)];
    const rpc = (method: string, params = {}) => web("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    expect((await rpc("tools/list")).status).toBe(200);
    expect(await first.next(50)).toBeNull();
    expect((await rpc("tools/call", { name: "queue", arguments: { repo: "acme/api", spec: "acme/api#7" } })).status).toBe(200);
    expect(await first.next()).toEqual({ event: "board-changed", data: "{}" });
    expect(await second.next()).toEqual({ event: "board-changed", data: "{}" });
    await Promise.all([first.close(), second.close()]);
  });

  test("a closed stream is no longer sent to", async () => {
    const { handler, web } = await withIssue();
    const closed = await events(handler);
    await closed.close();
    expect((await web("/api/harness/refresh", { method: "POST", body: "{}" })).status).toBe(200);
  });
});

describe("serve's other paths", () => {
  test("an unknown path is a 404, asking nothing of the World", async () => {
    const { web, world } = setup();
    const { status, body } = await web("/classic");
    expect(status).toBe(404);
    expect(body).toBe("No page at /classic\n");
    expect(world.calls).toEqual([]);
  });
});
