import { type RunContext, run } from "./cli";
import { VERSION } from "./version";

/** The MCP revision answered: the last one with an `initialize` handshake. */
const PROTOCOL_VERSION = "2025-11-25";
/** Older handshake revisions whose tool messages are the same, echoed back to a client asking for one. */
const OLDER_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "board",
    title: "Board",
    description:
      "Read the Board: Ready issues, Specs (running, Held, next issue) and each Repo's room and candidate Specs. Same JSON as `nico-agent --json`.",
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "advance",
    title: "Advance",
    description:
      "Dispatch each running Spec's next issue with the Scheduler defaults (Held Specs are skipped), and start the given Spec too when its Repo has room. Same JSON as `nico-agent advance --json`.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", description: "candidate Spec to start too, named as on the Board (e.g. BLE-10); refused unless its Repo has room" },
      },
      additionalProperties: false,
    },
  },
];

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
 * The Scheduler's MCP server (ADR-0008): one stdin line in, one stdout line
 * out, or null when the line is a notification or a response. Hand-rolled
 * JSON-RPC 2.0 over the 2025-11-25 handshake, with exactly two tools that run
 * the CLI's own `--json` commands, so it can do nothing the CLI's Board and
 * `advance` can't.
 */
export function mcpHandler(ctx: RunContext) {
  return async (line: string): Promise<string | null> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return reply(null, { error: { code: -32700, message: "Parse error" } });
    }
    if (!isObject(message)) return reply(null, { error: { code: -32600, message: "Invalid Request" } });
    const { id, method, params } = message;
    if (typeof method !== "string" || id === undefined) return null;
    if (typeof id !== "string" && typeof id !== "number") return reply(null, { error: { code: -32600, message: "Invalid Request" } });
    try {
      return reply(id, { result: await answer(ctx, method, params) });
    } catch (e) {
      if (e instanceof RpcError) return reply(id, { error: { code: e.code, message: e.message } });
      return reply(id, { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  };
}

function reply(id: Id, body: { result: unknown } | { error: { code: number; message: string } }) {
  return JSON.stringify({ jsonrpc: "2.0", id, ...body });
}

async function answer(ctx: RunContext, method: string, params: unknown) {
  switch (method) {
    case "initialize":
      return initialize(params);
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return await callTool(ctx, params);
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
    instructions:
      "Read the Board with `board`; call `advance` to dispatch each running Spec's next issue, with `start` to also start a candidate Spec when its Repo has room.",
  };
}

/** Runs the tool as its CLI command with `--json`; an AXI error is a tool error, its `help` included. */
async function callTool(ctx: RunContext, params: unknown) {
  const argv = toolArgv(params);
  const { stdout, exitCode } = await run(argv, ctx);
  return { content: [{ type: "text", text: stdout }], structuredContent: JSON.parse(stdout), isError: exitCode !== 0 };
}

function toolArgv(params: unknown): string[] {
  if (!isObject(params) || typeof params.name !== "string") throw new RpcError(-32602, "tools/call needs a tool name");
  const { name, arguments: args = {} } = params;
  if (!isObject(args)) throw new RpcError(-32602, `${name}'s arguments must be an object`);
  const extra = Object.keys(args).find((key) => name !== "advance" || key !== "start");
  if (name === "board") {
    if (extra) throw new RpcError(-32602, `board takes no arguments (got ${extra})`);
    return ["--json"];
  }
  if (name !== "advance") throw new RpcError(-32602, `Unknown tool: ${name} (the tools are ${TOOLS.map((t) => t.name).join(", ")})`);
  if (extra) throw new RpcError(-32602, `advance takes only start (got ${extra})`);
  if (args.start === undefined) return ["advance", "--json"];
  if (typeof args.start !== "string") throw new RpcError(-32602, "advance's start must be a string, a Spec named as on the Board");
  // `--start=<spec>` keeps a Spec name starting with `-` a value.
  return ["advance", `--start=${args.start}`, "--json"];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
