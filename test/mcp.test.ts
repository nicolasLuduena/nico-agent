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
    expect(JSON.parse(reply!).result.tools).toHaveLength(2);
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

  test("tools/list offers exactly two tools: board and advance with an optional Spec to start", async () => {
    const { mcp } = setup();
    const reply = await mcp({ jsonrpc: "2.0", id: "list", method: "tools/list" });
    expect(reply.id).toBe("list");
    const tools = reply.result.tools;
    expect(tools.map((t: { name: string }) => t.name)).toEqual(["board", "advance"]);
    expect(tools[0].inputSchema).toEqual({ type: "object", additionalProperties: false });
    expect(tools[1].inputSchema).toEqual({
      type: "object",
      properties: { start: { type: "string", description: expect.stringContaining("Spec") } },
      additionalProperties: false,
    });
    for (const tool of tools) expect(tool.description).toBeString();
  });

  test("the board tool returns what `nico-agent --json` prints", async () => {
    const { mcp, cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const reply = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "board", arguments: {} } });
    const expected = (await cli("--json")).stdout;
    expect(reply.result).toEqual({
      content: [{ type: "text", text: expected }],
      structuredContent: JSON.parse(expected),
      isError: false,
    });
    expect(reply.result.structuredContent.issues[0]).toMatchObject({ issue: "acme/api#7" });
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
      {},
    ]) {
      expect(await call(params)).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32602, message: expect.any(String) } });
    }
    expect((await call({ name: "close" })).error.message).toBe("Unknown tool: close (the tools are board, advance)");
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
