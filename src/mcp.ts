import { ORDERS, type Order } from "./config";
import { render } from "./output";
import { VERSION } from "./version";

/** Runs a CLI command line in-process, as `nico-agent` would. */
export type CliRunner = (argv: string[]) => Promise<{ stdout: string; exitCode: number }>;

/** The MCP revision answered: the last one with an `initialize` handshake. */
const PROTOCOL_VERSION = "2025-11-25";
/** Older handshake revisions whose tool messages are the same, echoed back to a client asking for one. */
const OLDER_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** The launch arguments `dispatch` and `review` take, as their CLI flags do. */
const LAUNCH_PROPERTIES = {
  harness: { type: "string", description: "Harness to launch, e.g. claude (see `nico-agent harness list`)" },
  model: { type: "string", description: "Model for the Harness, e.g. opus" },
  effort: { type: "string", description: "Effort level for the Harness, e.g. high" },
};
const ISSUES = { type: "array", items: { type: "string" }, minItems: 1, description: "Issues, e.g. acme/api#7 or BLE-27" };
const QUEUE_PROPERTIES = {
  spec: { type: "string", description: "The Spec, e.g. BLE-20 or acme/api#10" },
  repo: { type: "string", description: "The Repo whose Queue it is, e.g. acme/api" },
};

/** The Lead's hands (ADR-0010): each the CLI command of the same name, behind the Standing order it falls under. */
function actionTools() {
  const tool = (name: string, title: string, does: string, order: Order, inputSchema: Record<string, unknown>, except = "") => ({
    name,
    title,
    description: `${does} Falls under the \`${order}\` Standing order (it lets ${ORDERS[order].lets})${except}: while it is off the tool is refused, with a ready-made \`propose\` call in its help.`,
    inputSchema: { type: "object", ...inputSchema, additionalProperties: false },
  });
  return [
    tool("dispatch", "Dispatch", "Start an Implementer on each issue, as `nico-agent dispatch` does.", "start", {
      properties: {
        issues: ISSUES,
        ...LAUNCH_PROPERTIES,
        stackOn: { type: "string", description: "Open PR to stack on, named by its issue or its PR URL" },
        base: { type: "string", description: "Branch on origin to start from and open the PR against" },
        repo: { type: "string", description: "Repo to dispatch a Linear issue into, when several claim it" },
      },
      required: ["issues", "harness", "model", "effort"],
    }),
    tool("review", "Review", "Start a Reviewer on each In-flight issue's PR, as `nico-agent review` does.", "review", {
      properties: { issues: ISSUES, ...LAUNCH_PROPERTIES },
      required: ["issues", "harness", "model", "effort"],
    }),
    tool("close", "Close", "Close each Dispatch, removing its workspace and keeping its branch, as `nico-agent close` does.", "close", {
      properties: { issues: ISSUES, confirm: { type: "boolean", description: "Close even with no PR yet (still Implementing)" } },
      required: ["issues"],
    }),
    tool("answer", "Answer", "Submit text to an In-flight issue's Implementer while it waits on the user, as `nico-agent answer` does. Pass `text` or `relay`, not both.", "answer", {
      properties: {
        issue: { type: "string", description: "The In-flight issue whose Implementer is Asking" },
        text: { type: "string", description: "Your own answer; needs the `answer` order" },
        relay: { type: "string", description: "The user's own words to pass on: a whole message of theirs, or words they put in quotes; needs no order" },
      },
      required: ["issue"],
    }, ", except a `relay` of the user's own words, which needs no order"),
    tool("queue", "Queue", "Put a candidate Spec last in its Repo's Queue, as `nico-agent queue` does.", "start", {
      properties: QUEUE_PROPERTIES,
      required: ["spec", "repo"],
    }),
    tool("unqueue", "Unqueue", "Take a Spec out of its Repo's Queue, as `nico-agent unqueue` does.", "start", {
      properties: QUEUE_PROPERTIES,
      required: ["spec", "repo"],
    }),
    tool("advance", "Advance", "Dispatch each running Spec's next issue and start the head of each Repo's Queue while it has room, as `nico-agent advance` does.", "start", {}),
  ];
}

const TOOLS = [
  {
    name: "board",
    title: "Board",
    description: "Read the Board: Ready issues, Specs, In-flight Dispatches and each Repo's room. Same JSON as `nico-agent board --json`.",
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "inbox",
    title: "Inbox",
    description: "Read your Inbox: the user's messages and answers to your questions you have not seen yet, each returned once. Every call also returns `orient`: the Intent, the Notes, your open questions and the last exchanges; read it before acting when you can't recall your last words.",
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "recall",
    title: "Recall",
    description: "Search the whole conversation with the user for text (ignoring case), optionally from `since` until `until`. Returns the matching entries with their ids and times.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to find" },
        since: { type: "string", description: "Only entries from this date or time on, e.g. 2026-09-01" },
        until: { type: "string", description: "Only entries up to this date (through its end) or time, e.g. 2026-09-30" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "say",
    title: "Say",
    description: "Reply to the user: your words go into the conversation the user reads with `nico-agent lead log`.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "What to tell the user" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "ask",
    title: "Ask",
    description: "Ask the user a question, with optional choices. It returns the question's id; the answer arrives in your Inbox naming that id.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question" },
        choices: { type: "array", items: { type: "string" }, description: "Answers the user can pick from" },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  ...actionTools(),
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
    instructions: [
      "Read the Board with `board` and your Inbox with `inbox`; reply with `say`, ask the user with `ask`, and search the conversation with `recall`.",
      "Act with `dispatch`, `review`, `close`, `answer`, `queue`, `unqueue` and `advance`, each under the Standing order its description names; one refused because its order is off gives you a `propose` call to make instead.",
    ].join(" "),
  };
}

/**
 * What a tool runs: a read tool, its CLI argv; an action tool, the CLI command
 * (without `--json`) as a Proposal would record it, the Standing order it
 * falls under, and for an answer relaying the user, the words relayed.
 */
type ToolRun = { argv: string[] } | { action: string[]; order: Order; relay?: string };

/**
 * Runs the tool as its CLI command with `--json`; a CLI failure is a tool
 * error, its `help` included. An action tool first reads its Standing order,
 * fresh, and is refused with nothing run while the order is off.
 */
async function callTool(runCli: CliRunner, params: unknown) {
  const run = toolRun(params);
  if ("argv" in run) return await cliResult(runCli, run.argv);
  const json = withJson(run.action);
  if (run.relay !== undefined) {
    const log = await runCli(["lead", "log", "--json"]);
    if (log.exitCode !== 0) return toolResult(log.stdout, true);
    const { entries } = JSON.parse(log.stdout) as { entries: { who: string; text: string }[] };
    if (entries.some((e) => e.who === "user" && saidBy(e.text, run.relay!))) return await cliResult(runCli, json);
    return refusal("relay must be the user's own words, as written in the conversation", [
      "Relay a whole message of the user's, or words they put in quotes, exactly as written (see `recall`)",
      "Pass your own words as `text` instead; that needs the `answer` Standing order",
    ]);
  }
  const listed = await runCli(["orders", "--json"]);
  if (listed.exitCode !== 0) return toolResult(listed.stdout, true);
  const { orders } = JSON.parse(listed.stdout) as { orders: Record<Order, boolean> };
  if (orders[run.order]) return await cliResult(runCli, json);
  const proposal = JSON.stringify({ action: run.action, reason: "<why, in a sentence the user can decide on>" });
  return refusal(`the \`${run.order}\` Standing order is off, so ${run.action[0]} needs the user's approval`, [
    `The \`${run.order}\` order lets ${ORDERS[run.order].lets}; the user has not turned it on`,
    `Propose it instead: call \`propose\` with ${proposal}`,
  ]);
}

async function cliResult(runCli: CliRunner, argv: string[]) {
  const { stdout, exitCode } = await runCli(argv);
  return toolResult(stdout, exitCode !== 0);
}

function toolResult(text: string, isError: boolean) {
  return { content: [{ type: "text", text }], structuredContent: JSON.parse(text), isError };
}

/** A tool refused before anything ran, shaped as a CLI failure printed with `--json`. */
function refusal(error: string, help: string[]) {
  return toolResult(render({ data: { error }, help }, true), true);
}

/** Whether the user wrote `words`: the whole of `text`, or a span of it they put in quotes. */
function saidBy(text: string, words: string) {
  const relay = words.trim();
  if (!relay) return false;
  if (text.trim() === relay) return true;
  return [...text.matchAll(/"([^"]+)"|“([^”]+)”/g)].some((m) => (m[1] ?? m[2])!.trim() === relay);
}

/** `action` with `--json`, ahead of any `--` so it stays a flag. */
function withJson(action: string[]) {
  const end = action.indexOf("--");
  return end === -1 ? [...action, "--json"] : [...action.slice(0, end), "--json", ...action.slice(end)];
}

function toolRun(params: unknown): ToolRun {
  if (!isObject(params) || typeof params.name !== "string") throw new RpcError(-32602, "tools/call needs a tool name");
  const { name, arguments: args = {} } = params;
  if (!isObject(args)) throw new RpcError(-32602, `${name}'s arguments must be an object`);
  switch (name) {
    case "board":
      onlyArguments(name, args);
      return { argv: ["board", "--json"] };
    case "inbox":
      onlyArguments(name, args);
      return { argv: ["lead", "inbox", "--json"] };
    case "recall": {
      onlyArguments(name, args, ["query", "since", "until"]);
      const query = text(name, args, "query");
      const range = (["since", "until"] as const).flatMap((key) => {
        const value = args[key];
        if (value === undefined) return [];
        if (typeof value !== "string") throw new RpcError(-32602, `recall's ${key} must be a string`);
        return [`--${key}`, value];
      });
      return { argv: ["lead", "recall", "--json", ...range, "--", query] };
    }
    case "say":
      onlyArguments(name, args, ["text"]);
      return { argv: ["lead", "say", "--json", "--", text(name, args, "text")] };
    case "ask": {
      onlyArguments(name, args, ["question", "choices"]);
      const question = text(name, args, "question");
      const { choices = [] } = args;
      if (!Array.isArray(choices) || !choices.every((c) => typeof c === "string" && c)) {
        throw new RpcError(-32602, "ask's choices must be a list of non-empty strings");
      }
      return { argv: ["lead", "ask", "--json", "--", question, ...choices] };
    }
    case "dispatch": {
      onlyArguments(name, args, ["issues", "harness", "model", "effort", "stackOn", "base", "repo"]);
      const optional = ([["stackOn", "--stack-on"], ["base", "--base"], ["repo", "--repo"]] as const).flatMap(([key, flag]) =>
        args[key] === undefined ? [] : [flag, text(name, args, key)]);
      return { action: ["dispatch", ...launch(name, args), ...optional, "--", ...issues(name, args)], order: "start" };
    }
    case "review":
      onlyArguments(name, args, ["issues", "harness", "model", "effort"]);
      return { action: ["review", ...launch(name, args), "--", ...issues(name, args)], order: "review" };
    case "close": {
      onlyArguments(name, args, ["issues", "confirm"]);
      const { confirm = false } = args;
      if (typeof confirm !== "boolean") throw new RpcError(-32602, "close's confirm must be true or false");
      return { action: ["close", ...(confirm ? ["--confirm"] : []), "--", ...issues(name, args)], order: "close" };
    }
    case "answer": {
      onlyArguments(name, args, ["issue", "text", "relay"]);
      const issue = text(name, args, "issue");
      if ((args.text === undefined) === (args.relay === undefined)) throw new RpcError(-32602, "answer takes text or relay, exactly one");
      if (args.relay !== undefined) {
        const relay = text(name, args, "relay");
        return { action: ["answer", "--", issue, relay], order: "answer", relay };
      }
      return { action: ["answer", "--", issue, text(name, args, "text")], order: "answer" };
    }
    case "queue":
    case "unqueue":
      onlyArguments(name, args, ["spec", "repo"]);
      return { action: [name, "--repo", text(name, args, "repo"), "--", text(name, args, "spec")], order: "start" };
    case "advance":
      onlyArguments(name, args);
      return { action: ["advance"], order: "start" };
    default:
      throw new RpcError(-32602, `Unknown tool: ${name} (the tools are ${TOOLS.map((t) => t.name).join(", ")})`);
  }
}

/** The `--harness`, `--model` and `--effort` flags from their required arguments. */
function launch(name: string, args: Record<string, unknown>) {
  return ["--harness", text(name, args, "harness"), "--model", text(name, args, "model"), "--effort", text(name, args, "effort")];
}

/** The required `issues` argument: a non-empty list of non-empty strings. */
function issues(name: string, args: Record<string, unknown>): string[] {
  const { issues } = args;
  if (!Array.isArray(issues) || !issues.length || !issues.every((i) => typeof i === "string" && i.trim())) {
    throw new RpcError(-32602, `${name} needs issues, a list of one or more issues`);
  }
  return issues;
}

function onlyArguments(name: string, args: Record<string, unknown>, known: string[] = []) {
  const extra = Object.keys(args).find((key) => !known.includes(key));
  if (extra) throw new RpcError(-32602, `${name} takes ${known.length ? known.join(" and ") : "no arguments"} (got ${extra})`);
}

/** The required string argument `key`, which must not be blank. */
function text(name: string, args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new RpcError(-32602, `${name} needs ${key}, a non-empty string`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
