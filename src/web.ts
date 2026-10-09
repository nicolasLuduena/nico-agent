import { type PreviewLookup, cachedPreviews } from "./preview";
import { type CliRunner, isToolCall, mcpHandler, withJson } from "./mcp";
import { Events } from "./events";
import type { World } from "./world";

export interface WebContext {
  world: World;
  configDir: string;
  /** Runs a CLI command line in-process, for the MCP tools and the app's `/api`. */
  runCli: CliRunner;
  /** The app's SSE stream; `serve` shares it to send its ticks. */
  events?: Events;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/**
 * What `serve` answers besides the app's page at `/`: the app's JSON API over
 * the CLI (ADR-0006), its SSE stream, issues' hover cards, and the MCP server.
 */
export function webHandler(context: WebContext) {
  // Hovering an issue again shows its card without asking its Source.
  const previews = cachedPreviews(context.world);
  const mcp = mcpHandler(context.runCli);
  const events = context.events ?? new Events();
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/mcp") return await mcp(request);
    if (pathname.startsWith("/api/") && request.method === "POST") return await postApi(context, request, pathname);
    if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405 });
    if (pathname === "/api/board") return await cliJson(context, ["board"]);
    if (pathname === "/api/harnesses") return await cliJson(context, ["harness", "list"]);
    if (pathname === "/preview") return await getPreview(previews, url.searchParams);
    return new Response(`No page at ${pathname}\n`, { status: 404 });
  };
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/events" && request.method === "GET") return events.stream(request.signal);
    const changes = await changesBoard(request, pathname);
    try {
      return await handle(request);
    } finally {
      // Even a failed action may have changed something, such as a Dispatch's recorded failure.
      if (changes) events.emit("board-changed");
    }
  };
}

/**
 * Whether a request may change the Board: any post, but on `/mcp` only a
 * tool call (an action tool, or a read the Board cannot tell apart cheaply).
 */
async function changesBoard(request: Request, pathname: string) {
  if (request.method !== "POST") return false;
  return pathname !== "/mcp" || await isToolCall(request);
}

/** The Board's actions, by their `/api` path: each the CLI command of the same words. */
const API_ACTIONS: Record<string, string[]> = {
  "/api/dispatch": ["dispatch"],
  "/api/review": ["review"],
  "/api/close": ["close"],
  "/api/queue": ["queue"],
  "/api/unqueue": ["unqueue"],
  "/api/move": ["move"],
  "/api/advance": ["advance"],
  "/api/harness/refresh": ["harness", "refresh"],
};

/** What the app reads, with GET. */
const API_READS = ["/api/board", "/api/harnesses", "/api/events"];

const API_HELP = `Post {"args": [...]} to one of ${Object.keys(API_ACTIONS).join(", ")}`;

/**
 * A Board action: the body `{"args": [...]}` holds the CLI's arguments, and the
 * answer is the CLI's JSON, `help` included (ADR-0006). The status follows the
 * exit code: 400 for a usage error, 422 for a refused or failed action.
 */
async function postApi(ctx: WebContext, request: Request, pathname: string) {
  const command = API_ACTIONS[pathname];
  if (!command) {
    const read = API_READS.includes(pathname);
    return apiError(read ? 405 : 404, read ? `${pathname} is read with GET` : `no action at ${pathname}`);
  }
  // A browser says when another site's page sends the request; only the app's own page may act.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return apiError(403, "only the app itself can act on the Board");
  const text = await request.text();
  // No body is no arguments; a body that is not a JSON object is refused.
  const body: unknown = text.trim() ? parseJson(text) : {};
  const args = body !== null && typeof body === "object" ? (body as { args?: unknown }).args : null;
  if (!(args === undefined || (Array.isArray(args) && args.every((a) => typeof a === "string")))) {
    return apiError(400, 'the body must be {"args": [...]}, the CLI\'s arguments');
  }
  return cliJson(ctx, [...command, ...(args ?? [])]);
}

/** `text` as JSON, or null when it is not. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function apiError(status: number, error: string) {
  return new Response(JSON.stringify({ error, help: [API_HELP] }), { status, headers: JSON_HEADERS });
}

/**
 * `argv` run as `nico-agent <argv> --json`, its output the answer. The Board
 * answers 200 even when no Repo could be loaded: its `errors` say why.
 */
async function cliJson(ctx: WebContext, argv: string[]) {
  const { stdout, exitCode } = await ctx.runCli(withJson(argv));
  const status = exitCode === 0 || argv[0] === "board" ? 200 : exitCode === 2 ? 400 : 422;
  return new Response(stdout, { status, headers: JSON_HEADERS });
}

/** An issue's hover card, by its URL, as the Board's links carry it. */
async function getPreview(previews: PreviewLookup, params: URLSearchParams) {
  const card = await previews(params.get("url") ?? "");
  if (card === null) return new Response('<div class="card"><p class="error">Not a GitHub or Linear issue URL</p></div>', { status: 400, headers: HTML_HEADERS });
  return new Response(card, { headers: HTML_HEADERS });
}
