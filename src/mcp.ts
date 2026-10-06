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
    description:
      "Read the Board as the Scheduler needs it: running and Held Specs, and each Repo's room and candidate Specs (bodies cut short). A view of `nico-agent --json`.",
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
  {
    name: "answer",
    title: "Answer",
    description:
      "Relay the user's reply to an Implementer listed under `asking` on the Board, submitted as typed. Refused unless that Implementer is waiting on the user, so a question can be answered once. Same JSON as `nico-agent answer --json`.",
    inputSchema: {
      type: "object",
      properties: {
        issue: { type: "string", description: "the asking Implementer's issue, named as on the Board (e.g. acme/api#7 or BLE-27)" },
        text: { type: "string", description: "the user's words, verbatim; never your own answer" },
      },
      required: ["issue", "text"],
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
 * JSON-RPC 2.0 over the 2025-11-25 handshake, with exactly three tools that
 * run the CLI's own `--json` commands, so it can do nothing the CLI's Board,
 * `advance` and `answer` can't.
 */
export function mcpHandler(runCli: CliRunner) {
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
      return reply(id, { result: await answer(runCli, method, params) });
    } catch (e) {
      if (e instanceof RpcError) return reply(id, { error: { code: e.code, message: e.message } });
      return reply(id, { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  };
}

function reply(id: Id, body: { result: unknown } | { error: { code: number; message: string } }) {
  return JSON.stringify({ jsonrpc: "2.0", id, ...body });
}

async function answer(runCli: CliRunner, method: string, params: unknown) {
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
    instructions:
      "Read the Board with `board`; call `advance` to dispatch each running Spec's next issue, with `start` to also start a candidate Spec when its Repo has room; call `answer` only to relay the user's own reply to an Implementer listed under `asking`.",
  };
}

/** Runs the tool as its CLI command with `--json`; an AXI error is a tool error, its `help` included. */
async function callTool(runCli: CliRunner, params: unknown) {
  const argv = toolArgv(params);
  const { stdout, exitCode } = await runCli(argv);
  const json = JSON.parse(stdout);
  const view = argv[0] === "--json" ? schedulerView(json) : json;
  const text = view === json ? stdout : JSON.stringify(view, null, 2);
  return { content: [{ type: "text", text }], structuredContent: view, isError: exitCode !== 0 };
}

/** The longest candidate body `board` returns: enough to judge priority, short enough that many candidates fit one tool result. */
const BODY_LIMIT = 500;

/**
 * The Board as the Scheduler reads it. A client cuts a long tool result short
 * (Hermes past 50K characters), and the whole Board outgrows that with the
 * Ready list, the Dispatches and every candidate's full body. The Scheduler
 * only picks Specs and relays questions, so it gets the running and Held
 * ones, the rooms, and the Implementers asking the user (their questions are
 * already cut short). A Board without rooms (an error, or no Specs) passes
 * through whole.
 */
function schedulerView(board: Record<string, unknown>) {
  if (!Array.isArray(board.rooms)) return board;
  const specs = (board.specs as { running: boolean; held?: unknown }[]).filter((s) => s.running || s.held);
  const rooms = (board.rooms as { candidates: { body: string }[] }[]).map((room) => ({
    ...room,
    candidates: room.candidates.map((c) => ({ ...c, body: c.body.length > BODY_LIMIT ? `${c.body.slice(0, BODY_LIMIT)}…` : c.body })),
  }));
  return {
    specs, rooms,
    ...(board.asking !== undefined && { asking: board.asking }),
    ...(board.errors !== undefined && { errors: board.errors }),
    help: board.help,
  };
}

function toolArgv(params: unknown): string[] {
  if (!isObject(params) || typeof params.name !== "string") throw new RpcError(-32602, "tools/call needs a tool name");
  const { name, arguments: args = {} } = params;
  if (!isObject(args)) throw new RpcError(-32602, `${name}'s arguments must be an object`);
  if (name === "answer") return answerArgv(args);
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

function answerArgv(args: Record<string, unknown>) {
  const extra = Object.keys(args).find((key) => key !== "issue" && key !== "text");
  if (extra) throw new RpcError(-32602, `answer takes only issue and text (got ${extra})`);
  if (typeof args.issue !== "string" || typeof args.text !== "string") {
    throw new RpcError(-32602, "answer needs issue and text, both strings: the issue as on the Board and the user's words");
  }
  // After `--`, a text or issue starting with `-` stays an argument.
  return ["answer", "--json", "--", args.issue, args.text];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
