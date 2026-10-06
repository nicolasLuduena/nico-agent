import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("nico-agent mcp", () => {
  test("serves the MCP handler over stdio until stdin closes, printing nothing else on stdout", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("mcp");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(world.calls).toEqual(["serve stdio"]);
    const reply = await world.stdio!("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}");
    expect(JSON.parse(reply!).result.tools).toHaveLength(3);
  });

  test("--help says how to register it as an MCP server", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("mcp", "--help", "--json");
    expect(exitCode).toBe(0);
    const help = JSON.parse(stdout);
    expect(help.usage).toBe("nico-agent mcp");
    expect(help.help).toEqual([
      "Register with Hermes: `hermes mcp add nico-agent --command nico-agent --args mcp`",
      "Register with Claude Code: `claude mcp add nico-agent -- nico-agent mcp`",
      'Or in an MCP client\'s config: {"mcpServers": {"nico-agent": {"command": "nico-agent", "args": ["mcp"]}}}',
    ]);
  });
});

describe("the MCP handler", () => {
  test("initialize answers the 2025-11-25 handshake, offering only tools", async () => {
    const { mcp, world } = setup();
    const reply = await mcp({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "hermes", version: "1.0" } },
    });
    expect(reply).toMatchObject({
      jsonrpc: "2.0", id: 1,
      result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "nico-agent" } },
    });
    expect(Object.keys(reply.result.capabilities)).toEqual(["tools"]);
    expect(await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(world.calls).toEqual([]);
  });

  test("tools/list offers exactly three tools: board, advance with an optional Spec to start, and answer", async () => {
    const { mcp } = setup();
    const reply = await mcp({ jsonrpc: "2.0", id: "list", method: "tools/list" });
    expect(reply.id).toBe("list");
    const tools = reply.result.tools;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(["board", "advance", "answer"]);
    expect(tools[0].inputSchema).toEqual({ type: "object", additionalProperties: false });
    expect(tools[1].inputSchema).toEqual({
      type: "object",
      properties: { start: { type: "string", description: expect.stringContaining("Spec") } },
      additionalProperties: false,
    });
    expect(tools[2].inputSchema).toEqual({
      type: "object",
      properties: {
        issue: { type: "string", description: expect.stringContaining("issue") },
        text: { type: "string", description: expect.stringContaining("verbatim") },
      },
      required: ["issue", "text"],
      additionalProperties: false,
    });
    for (const tool of tools) expect(tool.description).toBeString();
  });

  test("the board tool returns the Scheduler's view of `nico-agent --json`: rooms, running and Held Specs, errors and help", async () => {
    const { mcp, cli, world, configDir } = await linearRepo();
    setConfig(configDir, { scheduler: { harness: "claude", model: "opus", effort: "high" } });
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" });
    await cli("advance", "--start", "BLE-10");
    const longBody = "A".repeat(600);
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser", body: longBody }, { identifier: "BLE-21" });
    world.addLinearIssue({ identifier: "BLE-30", title: "A bug from triage", body: "It crashes." });

    const reply = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "board", arguments: {} } });
    const board = JSON.parse((await cli("--json")).stdout);
    const view = reply.result.structuredContent;
    expect(reply.result).toEqual({ content: [{ type: "text", text: JSON.stringify(view, null, 2) }], structuredContent: view, isError: false });
    expect(Object.keys(view)).toEqual(["specs", "rooms", "help"]);
    expect(view.help).toEqual(board.help);
    expect(view.specs).toEqual(board.specs.filter((s: { spec: string }) => s.spec === "BLE-10"));
    const [room] = view.rooms;
    expect(room).toMatchObject({ repo: "bleentr/pdf-diff", running: ["BLE-10"], room: board.rooms[0].room });
    expect(room.candidates).toEqual([
      { spec: "BLE-20", title: "Parser", url: "https://linear.app/bleentr/issue/BLE-20/title", issue: "BLE-21", body: `${"A".repeat(500)}…` },
      { spec: "BLE-30", title: "A bug from triage", url: "https://linear.app/bleentr/issue/BLE-30/title", issue: "BLE-30", body: "It crashes." },
    ]);
  });

  test("the board tool passes an error Board through whole", async () => {
    const { mcp, cli } = setup();
    const reply = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "board", arguments: {} } });
    const expected = (await cli("--json")).stdout;
    expect(reply.result).toEqual({ content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: false });
  });

  test("the advance tool returns what `nico-agent advance --json` prints", async () => {
    const { mcp, cli, configDir } = await linearRepo();
    setConfig(configDir, { scheduler: { harness: "claude", model: "opus", effort: "high" } });

    const reply = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "advance", arguments: {} } });
    const expected = (await cli("advance", "--json")).stdout;
    expect(JSON.parse(expected)).toEqual({ specs: [], help: ["Run `nico-agent` to see the Board"] });
    expect(reply.result).toEqual({ content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: false });
  });

  test("an AXI error from advance is a tool error carrying its help", async () => {
    const { mcp, cli, configDir } = await linearRepo();
    const reply = await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "advance", arguments: {} } });
    const expected = (await cli("advance", "--json")).stdout;
    expect(JSON.parse(expected)).toEqual({
      error: "the Scheduler defaults scheduler.harness, scheduler.model, scheduler.effort are not set",
      help: [`Set "scheduler": {"harness": "claude", "model": "opus", "effort": "high"} (your choice) in ${join(configDir, "config.json")}`],
    });
    expect(reply.result).toEqual({ content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: true });
  });

  test("advance's start argument is `--start`, refusals included", async () => {
    const { mcp, cli, world, configDir } = await linearRepo();
    setConfig(configDir, { scheduler: { harness: "claude", model: "opus", effort: "high" } });
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" });

    const reply = await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "advance", arguments: { start: "BLE-99" } } });
    const expected = (await cli("advance", "--start", "BLE-99", "--json")).stdout;
    expect(JSON.parse(expected).error).toBe("BLE-99 is not a candidate Spec: no Spec of a Repo has that name");
    expect(reply.result).toEqual({ content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: true });
  });

  test("advance starts the named Spec", async () => {
    const { mcp, world, configDir } = await linearRepo();
    setConfig(configDir, { scheduler: { harness: "claude", model: "opus", effort: "high" } });
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" });

    const reply = await mcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "advance", arguments: { start: "BLE-10" } } });
    expect(reply.result.isError).toBe(false);
    expect(reply.result.structuredContent.specs).toMatchObject([{ spec: "BLE-10", result: "started", issue: "BLE-11" }]);
  });

  test("the answer tool returns what `nico-agent answer --json` prints, passing any text as the answer", async () => {
    const { mcp, cli, world } = await dispatchedGitHub();
    world.agentStates.set("impl-api-11", "blocked");
    const text = "--confirm: no, stop and comment instead";

    const reply = await mcp({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "answer", arguments: { issue: "acme/api#11", text } } });
    expect(world.calls).toContain(`herdr agent prompt impl-api-11 ${text}`);
    expect(reply.result.isError).toBe(false);
    const view = reply.result.structuredContent;
    expect(view).toEqual({
      answered: "acme/api#11",
      agent: "impl-api-11",
      help: ["Run `nico-agent show acme/api#11` to see the Dispatch", "Run `nico-agent` to see the Board"],
    });
    expect(reply.result.content).toEqual([{ type: "text", text: `${JSON.stringify(view, null, 2)}\n` }]);
    // The Implementer now works, so the same answer again is refused.
    expect((await cli("answer", "acme/api#11", "--json", "--", text)).json().error).toContain("is not waiting on the user");
  });

  test("an answer refusal is a tool error carrying its help", async () => {
    const { mcp, cli } = await dispatchedGitHub();
    const reply = await mcp({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "answer", arguments: { issue: "acme/api#11", text: "yes" } } });
    const expected = (await cli("answer", "acme/api#11", "yes", "--json")).stdout;
    expect(JSON.parse(expected).error).toBe("acme/api#11's Implementer is not waiting on the user (it is working)");
    expect(reply.result).toEqual({ content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: true });
  });

  test("the board tool lists the Implementers asking the user, within its size bounds however long the screen", async () => {
    const { mcp, cli, world } = await dispatchedGitHub();
    world.agentStates.set("impl-api-11", "blocked");
    world.screens.set("impl-api-11", Array.from({ length: 2000 }, (_, i) => `${i} ${"y".repeat(100)}`).join("\n"));

    const reply = await mcp({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "board", arguments: {} } });
    const view = reply.result.structuredContent;
    expect(Object.keys(view)).toEqual(["specs", "rooms", "asking", "help"]);
    expect(view.asking).toEqual((await cli("--json")).json().asking);
    expect(view.asking).toMatchObject([{ issue: "acme/api#11", spec: "acme/api#10" }]);
    expect(reply.result.content[0].text.length).toBeLessThan(5000);
  });

  test("initialize echoes an older handshake revision it knows, and offers its own for any other", async () => {
    const { mcp } = setup();
    const version = async (protocolVersion: string) =>
      (await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {} } })).result.protocolVersion;
    expect(await version("2025-06-18")).toBe("2025-06-18");
    expect(await version("2024-11-05")).toBe("2024-11-05");
    expect(await version("2099-01-01")).toBe("2025-11-25");
  });

  test("ping answers empty; notifications and client responses get no reply", async () => {
    const { mcp } = setup();
    expect(await mcp({ jsonrpc: "2.0", id: 9, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
    expect(await mcp({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 3 } })).toBeNull();
    expect(await mcp({ jsonrpc: "2.0", id: 0, result: {} })).toBeNull();
  });

  test("any other tool or argument is invalid params, and nothing runs", async () => {
    const { mcp, world } = setup();
    const call = (params: unknown) => mcp({ jsonrpc: "2.0", id: 7, method: "tools/call", params });
    for (const params of [
      { name: "close", arguments: { issue: "acme/api#7" } },
      { name: "board", arguments: { start: "BLE-10" } },
      { name: "advance", arguments: { start: 10 } },
      { name: "advance", arguments: { start: "BLE-10", repo: "acme/api" } },
      { name: "advance", arguments: "BLE-10" },
      { name: "answer", arguments: { issue: "acme/api#7" } },
      { name: "answer", arguments: { issue: "acme/api#7", text: 2 } },
      { name: "answer", arguments: { issue: "acme/api#7", text: "yes", start: "BLE-10" } },
      {},
    ]) {
      expect(await call(params)).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32602, message: expect.any(String) } });
    }
    expect((await call({ name: "close" })).error.message).toBe("Unknown tool: close (the tools are board, advance, answer)");
    expect(world.calls).toEqual([]);
  });

  test("an unknown method, a bad line or a non-request get JSON-RPC errors", async () => {
    const { mcp } = setup();
    expect(await mcp({ jsonrpc: "2.0", id: 8, method: "resources/list" })).toEqual({
      jsonrpc: "2.0", id: 8, error: { code: -32601, message: "Method not found: resources/list" },
    });
    expect(await mcp("{not json")).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    expect(await mcp([{ jsonrpc: "2.0", id: 1, method: "ping" }])).toEqual({
      jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" },
    });
  });
});

/** acme/api#11 dispatched as the first issue of Spec acme/api#10, its Implementer working. */
async function dispatchedGitHub() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
  expect((await ctx.cli("dispatch", "acme/api#11", "--harness", "claude", "--model", "opus", "--effort", "high")).exitCode).toBe(0);
  ctx.world.calls.length = 0;
  return ctx;
}

/** A Repo claiming Linear team BLE, with no Scheduler defaults yet. */
async function linearRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  return ctx;
}

function setConfig(configDir: string, settings: Record<string, unknown>) {
  const file = join(configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...settings }));
}
