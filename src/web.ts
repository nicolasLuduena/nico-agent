import { statSync } from "node:fs";
import { join } from "node:path";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm" with { type: "file" };
import sileroVad from "./app/models/silero-vad.onnx" with { type: "file" };
import smartTurn from "./app/models/smart-turn-v3.2-cpu.onnx" with { type: "file" };
import { HEARING_FILES } from "./app/hearing";
import { type PreviewLookup, cachedPreviews } from "./preview";
import { type CliRunner, isToolCall, mcpHandler, partnerServer, withJson } from "./mcp";
import { PARTNER_TABS, isTab, loadPartners, partnerMcpPath } from "./partner";
import { type EventName, Events } from "./events";
import { loadConfig, standingOrders } from "./config";
import { leadStatus } from "./lead";
import { RECORDS } from "./records";
import { frontVoice } from "./front-voice";
import { speaker } from "./speech";
import { transcriptionSession } from "./transcription";
import { stopwatch } from "./voice-timing";
import type { Sockets, World } from "./world";

export interface WebContext {
  world: World;
  configDir: string;
  /** Runs a CLI command line in-process, for the MCP tools and the app's `/api`. */
  runCli: CliRunner;
  /** The app's SSE stream; `serve` shares it to send its ticks. */
  events?: Events;
  /** `lookAtLead` over `events`; `serve` shares it to look again on its ticks. */
  look?: () => Promise<void>;
  /** Sync `serve`'s Local state now, joining a Sync that runs (ADR-0015); `POST /api/sync` asks for it. */
  sync?: () => Promise<void>;
}

/**
 * A look at what the Lead panel shows besides the Board: each call sends
 * `conversation-entry`, `proposal-changed`, `lead-state`, or the drawer's
 * `intent-changed`, `notes-changed` or `orders-changed`, `voice-changed`, or
 * `partner-changed` for a Partner or its Thread, for what changed
 * since the last, whoever changed it (the app, the Lead through MCP, the CLI,
 * an editor, or herdr for the Lead's Agent state).
 */
export function lookAtLead({ world, configDir }: { world: World; configDir: string }, events: Events) {
  /** When a file last changed, as its size and time; the conversation only grows. */
  const file = (name: string) => () => {
    try {
      const { size, mtimeMs } = statSync(join(configDir, name));
      return `${size} ${mtimeMs}`;
    } catch {
      return "";
    }
  };
  const watched: [EventName, () => string | Promise<string>][] = [
    ["conversation-entry", file("conversation.jsonl")],
    ["proposal-changed", file("proposals.json")],
    ["voice-changed", file("voice-on.json")],
    ["lead-state", async () => {
      const status = await leadStatus(world, configDir);
      if (!status) return "";
      const { lead, state, record: { agent: { harness, model, effort } } } = status;
      return JSON.stringify([lead, state, harness, model, effort]);
    }],
    ["intent-changed", file(RECORDS.intent.file)],
    ["notes-changed", file(RECORDS.notes.file)],
    ["orders-changed", () => JSON.stringify(standingOrders(loadConfig(configDir)))],
    // The Partners' records and each one's Thread; their Agent states come with `/api/partners`, refetched on every tick.
    ["partner-changed", () => [file("partners.json")(), ...Object.values(loadPartners(configDir)).map((p) => file(p.thread)())].join(" ")],
  ];
  // A look that fails (herdr gone, say) is a sample of its own, never a failed request or tick.
  const sample = () => Promise.all(watched.map(async ([, look]) => {
    try {
      return await look();
    } catch (e) {
      return `failed: ${String(e)}`;
    }
  }));
  // Taken now, so the first change is told even if it comes before the first look.
  let seen = sample();
  return async () => {
    // Each look samples after the one before it, so two at once (a tick and a post) never tell one change twice.
    const last = seen;
    const now = last.then(sample);
    seen = now;
    const [before, after] = [await last, await now];
    watched.forEach(([name], i) => {
      if (after[i] !== before[i]) events.emit(name);
    });
  };
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** What the page hears speech with (see src/app/hearing.ts), by its URL path: the file embedded in the binary, and its type. */
const HEARING: Record<string, { file: string; type: string }> = {
  [HEARING_FILES.vad]: { file: sileroVad, type: "application/octet-stream" },
  [HEARING_FILES.turn]: { file: smartTurn, type: "application/octet-stream" },
  // Its type lets the browser compile it as it downloads.
  [HEARING_FILES.wasm]: { file: ortWasm, type: "application/wasm" },
};

/**
 * What `serve` answers besides the app's page at `/`: the app's JSON API over
 * the CLI (ADR-0006), its SSE stream, issues' hover cards, the models the
 * page hears speech with, and the MCP server.
 */
export function webHandler(context: WebContext) {
  // Hovering an issue again shows its card without asking its Source.
  const previews = cachedPreviews(context.world);
  const mcp = mcpHandler(context.runCli);
  // Each Partner's own server, scoped to its Thread (ADR-0014).
  const partnerMcp = Object.fromEntries(PARTNER_TABS.map((tab) => [partnerMcpPath(tab), mcpHandler(context.runCli, partnerServer(tab))]));
  const events = context.events ?? new Events();
  const look = context.look ?? lookAtLead(context, events);
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/mcp") return await mcp(request);
    const partner = partnerMcp[pathname];
    if (partner) return await partner(request);
    if (pathname === SYNC_PATH && request.method === "POST") return await syncNow(context, request);
    if (pathname.startsWith("/api/") && request.method === "POST") return await postApi(context, request, pathname);
    if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405 });
    const read = API_READS[pathname];
    if (read) return await cliJson(context, [...read, ...readArgs(pathname, url.searchParams)]);
    if (pathname === "/preview") return await getPreview(previews, url.searchParams);
    const hearing = HEARING[pathname];
    if (hearing) return new Response(Bun.file(hearing.file), { headers: { "content-type": hearing.type } });
    return new Response(`No page at ${pathname}\n`, { status: 404 });
  };
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/events" && request.method === "GET") return events.stream(request.signal);
    if (pathname === TALK_PATH && request.method === "POST") return talk(events, request);
    const changes = await changesBoard(request, pathname);
    // A Partner's tool writes its Thread, which the app hears of on the next look.
    const writesThread = pathname.startsWith("/mcp/partner/") && request.method === "POST" && await isToolCall(request);
    try {
      return await handle(request);
    } finally {
      if (writesThread) void look();
      // Even a failed action may have changed something, such as a Dispatch's recorded failure.
      if (changes) {
        events.emit("board-changed");
        // Not awaited: the answer need not wait on herdr for the Lead's state.
        void look();
      }
    }
  };
}

/**
 * What `serve` answers on WebSockets: on `/api/voice` the app's talk button
 * streams audio and hears transcripts back, the Front voice answers each one
 * or hands it to the Lead, and, with Voice on, the app hears the Front voice
 * and the Lead speak each entry it writes, as `events` tells of new ones.
 * The Lead waits for a pause in what the user and the Front voice say.
 * Talking over either (`hush`) stops both.
 */
export function webSockets(context: Pick<WebContext, "world" | "configDir" | "runCli" | "events">): Sockets {
  const timing = stopwatch(context);
  const speech = speaker(context);
  const front = frontVoice({ ...context, say: (text, tab) => speech.line(text, tab) });
  const transcription = transcriptionSession({ ...context, timing, front, hold: speech.hold, playing: speech.playing });
  context.events?.on("conversation-entry", () => {
    speech.changed();
    timing.changed();
  });
  // A Partner's reply is spoken to the pages on its tab.
  context.events?.on("partner-changed", () => speech.changed());
  // serve's tick, every few seconds, logs the spoken messages the Lead never answered.
  context.events?.on("board-changed", () => timing.expire());
  return {
    "/api/voice": (request) => {
      if (fromAnotherSite(request)) return apiError(403, "only the app itself can listen");
      return (peer) => {
        const talk = transcription(peer);
        speech.join(peer);
        return {
          message(data) {
            const command = typeof data === "string" ? parseJson(data) as { type?: unknown; entry?: unknown; line?: unknown; at?: unknown; tab?: unknown } | null : null;
            // The tab the page shows: its Front voice hears what is said next, and only its speech is heard.
            if (command?.type === "tab" && isTab(command.tab)) speech.tab(peer, command.tab);
            if (command?.type === "hush") {
              front.hush();
              return speech.hush();
            }
            if (command?.type === "played") {
              if (typeof command.at !== "number") return;
              if (typeof command.entry === "number") timing.played(command.entry, new Date(command.at));
              if (typeof command.line === "number") timing.playedLine(command.line, new Date(command.at));
              return;
            }
            talk.message(data);
          },
          close() {
            speech.leave(peer);
            talk.close();
          },
        };
      };
    },
  };
}

/** Where `nico-agent voice talk` asks `serve` to start the open page's talk button. */
export const TALK_PATH = "/api/voice/talk";

/** Press the talk button of the page that connected last, as a tap; refused when no page is open. */
function talk(events: Events, request: Request) {
  if (fromAnotherSite(request)) return apiError(403, "only the app itself or the CLI can start the microphone");
  if (!events.command("listen")) {
    const { origin } = new URL(request.url);
    return apiError(422, "no app is open to listen", [`Open ${origin}/ in a browser, allow the microphone and click once on the page; then run \`nico-agent voice talk\` again`]);
  }
  return new Response(JSON.stringify({
    listen: "sent",
    help: ["The app's talk button listens hands-free; run `nico-agent voice talk` again to send at once, or to end the session"],
  }), { headers: JSON_HEADERS });
}

/** Where the app's Sync button asks `serve` to sync its Local state now. */
const SYNC_PATH = "/api/sync";

/** Sync now, answering once the Sync ends; a Sync already running is joined, not run again. */
async function syncNow(ctx: WebContext, request: Request) {
  if (fromAnotherSite(request)) return apiError(403, "only the app itself can sync");
  if (!ctx.sync) return apiError(404, "no Local state to sync here", ["Run `nico-agent serve`, which syncs it"]);
  await ctx.sync();
  return new Response(JSON.stringify({ sync: "done", help: ["Read /api/board, /api/stats, /api/partners or /api/repos for the synced state"] }), { headers: JSON_HEADERS });
}

/** Whether a browser says another site's page sent `request`: only the app's own page may act or listen. */
function fromAnotherSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  return Boolean(site && site !== "same-origin" && site !== "none");
}

/**
 * Whether a request may change the Board: any post, but on `/mcp` only a
 * tool call, and never a Partner's, which writes only its Thread (an action tool, or a read the Board cannot tell apart cheaply).
 */
async function changesBoard(request: Request, pathname: string) {
  if (request.method !== "POST") return false;
  // A Sync tells what it changed itself, with `state-changed`.
  if (pathname.startsWith("/mcp/partner/") || pathname === SYNC_PATH) return false;
  return pathname !== "/mcp" || await isToolCall(request);
}

/** The Board's and the Lead panel's actions, by their `/api` path: each the CLI command of the same words. */
const API_ACTIONS: Record<string, string[]> = {
  "/api/dispatch": ["dispatch"],
  "/api/review": ["review"],
  "/api/close": ["close"],
  "/api/queue": ["queue"],
  "/api/unqueue": ["unqueue"],
  "/api/move": ["move"],
  "/api/advance": ["advance"],
  // The user's own words to an Asking Implementer, from its toast: as a Lead's `relay`, they need no Standing order.
  "/api/answer": ["answer"],
  "/api/harness/refresh": ["harness", "refresh"],
  "/api/say": ["say"],
  "/api/proposals/approve": ["proposals", "approve"],
  "/api/proposals/decline": ["proposals", "decline"],
  "/api/lead/start": ["lead", "start"],
  "/api/lead/stop": ["lead", "stop"],
  "/api/intent/set": ["intent", "set"],
  "/api/notes/set": ["notes", "set"],
  "/api/orders/set": ["orders", "set"],
  "/api/voice/on": ["voice", "on"],
  "/api/voice/off": ["voice", "off"],
  "/api/partner/start": ["partner", "start"],
  "/api/partner/say": ["partner", "say"],
  "/api/partner/hand-off": ["partner", "hand-off"],
  "/api/partner/end": ["partner", "end"],
};

/** What the app reads, with GET, by its `/api` path: each the CLI command of the same words. */
const API_READS: Record<string, string[]> = {
  "/api/board": ["board"],
  "/api/harnesses": ["harness", "list"],
  "/api/lead/log": ["lead", "log"],
  "/api/lead/status": ["lead", "status"],
  // Decided Proposals too, so a card keeps its outcome.
  "/api/proposals": ["proposals", "--all"],
  "/api/intent": ["intent"],
  "/api/notes": ["notes"],
  "/api/orders": ["orders"],
  "/api/voice/state": ["voice"],
  "/api/stats": ["stats"],
  "/api/peek": ["peek"],
  "/api/partners": ["partner", "list"],
  "/api/repos": ["repo", "list"],
  "/api/partner/log": ["partner", "log"],
  "/api/partner/diff": ["partner", "diff"],
  "/api/partner/prs": ["partner", "prs"],
};

/** The query parameters a read passes on as the CLI flags of the same names; others are ignored. */
const API_READ_PARAMS: Record<string, string[]> = {
  "/api/stats": ["days", "repo"],
};

/** The query parameters a read passes on as the CLI's argument, after `--`: the first one set. */
const API_READ_ARG: Record<string, string[]> = {
  "/api/peek": ["issue", "repo"],
  "/api/partner/log": ["tab"],
  "/api/partner/diff": ["tab"],
};

/** `?days=7&repo=acme/api` on `/api/stats` as `--days 7 --repo acme/api`; `?issue=acme/api%237` on `/api/peek` as `-- acme/api#7`, `?repo=acme/api` as `-- acme/api`. */
function readArgs(pathname: string, params: URLSearchParams) {
  const flags = (API_READ_PARAMS[pathname] ?? []).flatMap((name) => {
    const value = params.get(name);
    return value === null ? [] : [`--${name}`, value];
  });
  const arg = (API_READ_ARG[pathname] ?? []).map((name) => params.get(name)).find(Boolean);
  return arg ? [...flags, "--", arg] : flags;
}

const API_HELP = `Post {"args": [...]} to one of ${Object.keys(API_ACTIONS).join(", ")}`;

/**
 * A Board action: the body `{"args": [...]}` holds the CLI's arguments, and the
 * answer is the CLI's JSON, `help` included (ADR-0006). The status follows the
 * exit code: 400 for a usage error, 422 for a refused or failed action.
 */
async function postApi(ctx: WebContext, request: Request, pathname: string) {
  const command = API_ACTIONS[pathname];
  if (!command) {
    const read = pathname in API_READS || pathname === "/api/events";
    return apiError(read ? 405 : 404, read ? `${pathname} is read with GET` : `no action at ${pathname}`);
  }
  if (fromAnotherSite(request)) return apiError(403, "only the app itself can act");
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

function apiError(status: number, error: string, help = [API_HELP]) {
  return new Response(JSON.stringify({ error, help }), { status, headers: JSON_HEADERS });
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
