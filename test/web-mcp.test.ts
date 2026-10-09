import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

/** One JSON-RPC message POSTed to /mcp as an MCP client would, with the response's status and parsed body. */
async function post(web: ReturnType<typeof setup>["web"], message: unknown, headers: Record<string, string> = {}) {
  const body = typeof message === "string" ? message : JSON.stringify(message);
  const response = await web("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body,
  });
  return { ...response, json: () => JSON.parse(response.body) };
}

describe("MCP over HTTP at /mcp", () => {
  test("initialize answers the 2025-11-25 handshake, offering only tools", async () => {
    const { web, world } = setup();
    const response = await post(web, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-code", version: "2.0" } },
    });
    expect(response.status).toBe(200);
    expect(response.type).toBe("application/json");
    const reply = response.json();
    expect(reply).toMatchObject({
      jsonrpc: "2.0", id: 1,
      result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "nico-agent" } },
    });
    expect(Object.keys(reply.result.capabilities)).toEqual(["tools"]);
    expect(world.calls).toEqual([]);
  });

  test("initialize echoes an older handshake revision it knows, and offers its own for any other", async () => {
    const { web } = setup();
    const version = async (protocolVersion: string) =>
      (await post(web, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {} } })).json().result.protocolVersion;
    expect(await version("2025-06-18")).toBe("2025-06-18");
    expect(await version("2024-11-05")).toBe("2024-11-05");
    expect(await version("2099-01-01")).toBe("2025-11-25");
  });

  test("tools/list offers exactly one tool, board, taking no arguments", async () => {
    const { web } = setup();
    const reply = (await post(web, { jsonrpc: "2.0", id: "list", method: "tools/list" })).json();
    expect(reply.id).toBe("list");
    expect(reply.result.tools).toEqual([
      { name: "board", title: "Board", description: expect.stringContaining("nico-agent board --json"), inputSchema: { type: "object", additionalProperties: false } },
    ]);
  });

  test("the board tool returns what `nico-agent board --json` prints, as structured content and text", async () => {
    const { web, cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const reply = (await post(web, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "board", arguments: {} } })).json();
    const expected = (await cli("board", "--json")).stdout;
    expect(JSON.parse(expected).issues).toEqual([{ issue: "acme/api#7", title: "Add retries", base: "main" }]);
    expect(reply).toEqual({
      jsonrpc: "2.0", id: 2,
      result: { content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: false },
    });
  });

  test("a CLI failure inside the tool is a tool error carrying its help", async () => {
    const { web, cli, configDir } = setup();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{not json");

    const reply = (await post(web, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "board" } })).json();
    const expected = (await cli("board", "--json")).stdout;
    expect(JSON.parse(expected)).toEqual({ error: `${join(configDir, "config.json")} is not valid JSON`, help: expect.any(Array) });
    expect(JSON.parse(expected).help.length).toBeGreaterThan(0);
    expect(reply.result).toEqual({ content: [{ type: "text", text: expected }], structuredContent: JSON.parse(expected), isError: true });
  });

  test("ping answers empty; notifications and client responses are accepted with no body", async () => {
    const { web } = setup();
    expect((await post(web, { jsonrpc: "2.0", id: 9, method: "ping" })).json()).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
    for (const message of [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 0, result: {} }]) {
      expect(await post(web, message)).toMatchObject({ status: 202, body: "" });
    }
  });

  test("any other tool or argument is invalid params, and nothing runs", async () => {
    const { web, world } = setup();
    const call = async (params: unknown) => (await post(web, { jsonrpc: "2.0", id: 7, method: "tools/call", params })).json();
    for (const params of [{ name: "advance" }, { name: "board", arguments: { start: "BLE-10" } }, { name: "board", arguments: "x" }, {}]) {
      expect(await call(params)).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32602, message: expect.any(String) } });
    }
    expect((await call({ name: "advance" })).error.message).toBe("Unknown tool: advance (the tools are board)");
    expect(world.calls).toEqual([]);
  });

  test("an unknown method, malformed JSON or a non-request get JSON-RPC errors", async () => {
    const { web } = setup();
    expect((await post(web, { jsonrpc: "2.0", id: 8, method: "resources/list" })).json()).toEqual({
      jsonrpc: "2.0", id: 8, error: { code: -32601, message: "Method not found: resources/list" },
    });
    const malformed = await post(web, "{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    for (const message of [[{ jsonrpc: "2.0", id: 1, method: "ping" }], { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: {}, method: "ping" }]) {
      const invalid = await post(web, message);
      expect(invalid.status).toBe(400);
      expect(invalid.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }
  });

  test("a method other than POST is refused, with no SSE stream offered", async () => {
    const { web } = setup();
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await web("/mcp", { method, headers: { accept: "text/event-stream" } });
      expect(response.status).toBe(405);
      expect(response.type).toBe("application/json");
      expect(JSON.parse(response.body)).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32000, message: expect.stringContaining("POST") } });
    }
  });

  test("only the loopback origin serve listens on may connect", async () => {
    const { web, handler } = setup();
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    for (const origin of ["http://127.0.0.1:42069", "http://localhost:42069"]) {
      expect((await post(web, ping, { origin })).status).toBe(200);
    }
    for (const origin of ["http://evil.example", "http://evil.example:42069", "http://127.0.0.1:8080", "https://127.0.0.1:42069", "null"]) {
      const response = await post(web, ping, { origin });
      expect(response.status).toBe(403);
      expect(response.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32000, message: expect.stringContaining("loopback") } });
    }
    // A name rebound to 127.0.0.1 reaches the server with its own Host.
    const rebound = await handler(new Request("http://evil.example:42069/mcp", { method: "POST", body: JSON.stringify(ping) }));
    expect(rebound.status).toBe(403);
    const local = await handler(new Request("http://localhost:42069/mcp", { method: "POST", body: JSON.stringify(ping) }));
    expect(local.status).toBe(200);
  });

  test("a request under an MCP-Protocol-Version it does not answer is a bad request", async () => {
    const { web } = setup();
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    for (const revision of ["2025-11-25", "2025-06-18"]) {
      expect((await post(web, ping, { "mcp-protocol-version": revision })).status).toBe(200);
    }
    const response = await post(web, ping, { "mcp-protocol-version": "2099-01-01" });
    expect(response.status).toBe(400);
    expect(response.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Bad Request: unsupported MCP-Protocol-Version 2099-01-01" } });
  });
});
