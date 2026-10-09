import { VERSION } from "./version";

/** Runs a CLI command line in-process, as `nico-agent` would. */
export type CliRunner = (argv: string[]) => Promise<{ stdout: string; exitCode: number }>;

/** The MCP revision answered: the last one with an `initialize` handshake. */
const PROTOCOL_VERSION = "2025-11-25";
/** Older handshake revisions whose tool messages are the same, echoed back to a client asking for one. */
const OLDER_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "board",
    title: "Board",
    description: "Read the Board: Ready issues, Specs, In-flight Dispatches and each Repo's room. Same JSON as `nico-agent board --json`.",
    inputSchema: { type: "object", additionalProperties: false },
  },
];

const JSON_HEADERS = { "content-type": "application/json" };
/** Hostnames a loopback client reaches `serve` by. */
const LOOPBACK = ["127.0.0.1", "localhost"];

type Id = string | number | null;

/** A JSON-RPC error answered in place of a result. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * nico-agent's MCP server over streamable HTTP (ADR-0010), answering one
 * JSON-RPC message per POST with a JSON body, never an SSE stream.
 * Hand-rolled JSON-RPC 2.0 over the 2025-11-25 handshake, whose tools run the
 * CLI's own `--json` commands, so it can do nothing the CLI can't.
 */
export function mcpHandler(runCli: CliRunner) {
  return async (request: Request): Promise<Response> => {
    if (!fromLoopback(request)) return fail(-32000, "Forbidden: only a loopback origin may connect", 403);
    if (request.method !== "POST") return fail(-32000, "Method Not Allowed: POST JSON-RPC messages to /mcp", 405, { allow: "POST" });
    // Sent after initialize; the revisions answered are the ones initialize offers.
    const revision = request.headers.get("mcp-protocol-version");
    if (revision !== null && revision !== PROTOCOL_VERSION && !OLDER_VERSIONS.includes(revision)) {
      return fail(-32000, `Bad Request: unsupported MCP-Protocol-Version ${revision}`, 400);
    }
    let message: unknown;
    try {
      message = JSON.parse(await request.text());
    } catch {
      return fail(-32700, "Parse error", 400);
    }
    if (!isObject(message)) return fail(-32600, "Invalid Request", 400);
    const { id, method, params } = message;
    // A notification or a client's response: accepted, nothing to answer.
    if (typeof method === "string" ? id === undefined : "result" in message || "error" in message) return new Response(null, { status: 202 });
    if (typeof method !== "string" || (typeof id !== "string" && typeof id !== "number")) return fail(-32600, "Invalid Request", 400);
    try {
      return reply(id, { result: await respond(runCli, method, params) });
    } catch (e) {
      if (e instanceof RpcError) return reply(id, { error: { code: e.code, message: e.message } });
      return reply(id, { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  };
}

/**
 * Whether the request reached `serve` as a loopback host and, when a browser
 * sent it, from a page of that same origin: a page elsewhere, or one whose
 * name was rebound to 127.0.0.1, may not reach the tools.
 */
function fromLoopback(request: Request) {
  const url = new URL(request.url);
  if (!LOOPBACK.includes(url.hostname)) return false;
  const origin = request.headers.get("origin");
  return origin === null || LOOPBACK.some((host) => origin === `${url.protocol}//${host}${url.port && `:${url.port}`}`);
}

function reply(id: Id, body: { result: unknown } | { error: { code: number; message: string } }, status = 200, headers = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, ...body }), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** A JSON-RPC error answering a message that could not be read as a request, so it has no id. */
function fail(code: number, message: string, status: number, headers = {}) {
  return reply(null, { error: { code, message } }, status, headers);
}

async function respond(runCli: CliRunner, method: string, params: unknown) {
  switch (method) {
    case "initialize":
      return initialize(params);
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return await callTool(runCli, params);
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

function initialize(params: unknown) {
  const asked = isObject(params) ? params.protocolVersion : undefined;
  return {
    protocolVersion: typeof asked === "string" && OLDER_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: "nico-agent", title: "nico-agent", version: VERSION },
    instructions: "Read the Board with `board`.",
  };
}

/** Runs the tool as its CLI command with `--json`; a CLI failure is a tool error, its `help` included. */
async function callTool(runCli: CliRunner, params: unknown) {
  const { stdout, exitCode } = await runCli(toolArgv(params));
  return { content: [{ type: "text", text: stdout }], structuredContent: JSON.parse(stdout), isError: exitCode !== 0 };
}

function toolArgv(params: unknown): string[] {
  if (!isObject(params) || typeof params.name !== "string") throw new RpcError(-32602, "tools/call needs a tool name");
  const { name, arguments: args = {} } = params;
  if (!isObject(args)) throw new RpcError(-32602, `${name}'s arguments must be an object`);
  if (name !== "board") throw new RpcError(-32602, `Unknown tool: ${name} (the tools are ${TOOLS.map((t) => t.name).join(", ")})`);
  const extra = Object.keys(args)[0];
  if (extra) throw new RpcError(-32602, `board takes no arguments (got ${extra})`);
  return ["board", "--json"];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
