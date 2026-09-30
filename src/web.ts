import htmx from "htmx.org/dist/htmx.min.js" with { type: "text" };
import { type Board, loadBoard } from "./board";
import { type Repo, ConfigError, loadConfig } from "./config";
import { DispatchError, StepFailed, dispatch, review } from "./dispatch";
import { type Catalog, type Remembered, harnessCatalogs, refreshHarnesses, rememberedLaunches } from "./harness";
import { type InFlightRow, type PrLookup, cachedPrs, loadInFlight } from "./stage";
import { type Launch, loadDispatches } from "./state";
import { type World, WorldError } from "./world";

export interface WebContext {
  world: World;
  configDir: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

/** The web app: server-rendered pages over the same core operations as the CLI. */
export function webHandler(context: WebContext) {
  // One cache for the server's life, so polling the In-flight section asks GitHub only every ~30s.
  const ctx: ServerContext = { ...context, prs: cachedPrs(context.world) };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname === "/dispatch" && request.method === "POST") return await postLaunch(ctx, request, dispatch);
      if (pathname === "/review" && request.method === "POST") return await postLaunch(ctx, request, review);
      if (pathname === "/harnesses/refresh" && request.method === "POST") return await postRefresh(ctx);
      if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405 });
      if (pathname === "/htmx.min.js") {
        return new Response(htmx, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      if (pathname === "/dispatch-form") return await getLaunchForm(ctx, url.searchParams, "dispatch");
      if (pathname === "/review-form") return await getLaunchForm(ctx, url.searchParams, "review");
      if (pathname === "/in-flight") return await getInFlight(ctx);
      if (pathname !== "/") return new Response(page("Not found", `<p class="error">No page at ${escape(pathname)}</p>`), { status: 404, headers: HTML_HEADERS });
      return await getBoard(ctx);
    } catch (e) {
      const failure = failureOf(e);
      if (!failure) throw e;
      const help = failure.help.map((h) => `<p>${escape(h)}</p>`);
      const back = pathname === "/" ? [] : ['<p><a href="/">Back to the Board</a></p>'];
      const body = [`<p class="error">${escape(failure.message)}</p>`, ...help, ...back].join("\n");
      return new Response(page(failure.title, body), { status: failure.status, headers: HTML_HEADERS });
    }
  };
}

interface ServerContext extends WebContext {
  prs: PrLookup;
}

async function getBoard(ctx: ServerContext) {
  const { repos } = loadConfig(ctx.configDir);
  const board = await loadBoard(ctx.world, repos, loadDispatches(ctx.configDir), ctx.prs);
  // Discovery may run a Harness's CLI, so only when there is something to launch.
  const launchable = board.ready.length > 0 || board.inFlight.some(canLaunchReview);
  const choices = await choicesFor(ctx, launchable);
  return new Response(page("Board", renderBoard(repos, board, choices)), { headers: HTML_HEADERS });
}

/** The In-flight section alone, for the Board to poll. */
async function getInFlight(ctx: ServerContext) {
  const rows = await loadInFlight(ctx.world, loadDispatches(ctx.configDir), ctx.prs);
  const choices = await choicesFor(ctx, rows.some(canLaunchReview));
  return new Response(renderInFlight(rows, choices), { headers: HTML_HEADERS });
}

async function choicesFor(ctx: WebContext, needed: boolean): Promise<Choices> {
  return { catalogs: needed ? await harnessCatalogs(ctx.world, ctx.configDir) : [], remembered: rememberedLaunches(ctx.configDir) };
}

/** A launch form again, after a choice changed: only the chosen model's Efforts are offered. */
async function getLaunchForm(ctx: WebContext, params: URLSearchParams, action: Action) {
  const param = (name: string) => params.get(name) ?? "";
  const choices = await choicesFor(ctx, true);
  const chosen = { harness: param("harness"), model: param("model"), effort: param("effort") };
  return new Response(launchForm(action, param("issue"), choices, chosen), { headers: HTML_HEADERS });
}

/** A launch form's target: dispatch or review, then back to the Board. */
async function postLaunch(ctx: WebContext, request: Request, launch: typeof dispatch | typeof review) {
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  await launch(ctx.world, ctx.configDir, {
    issue: field("issue"),
    harness: field("harness"),
    model: field("model"),
    effort: field("effort"),
  });
  return new Response(null, { status: 303, headers: { location: "/" } });
}

/** Refresh harnesses: discover again, then back to the Board. */
async function postRefresh(ctx: WebContext) {
  const failed = (await refreshHarnesses(ctx.world, ctx.configDir)).filter((c) => c.error);
  if (failed.length) {
    throw new WebFailure("Refresh failed", failed.map((c) => c.error!).join("; "), ["Run `nico-agent harness refresh` for details"], 502);
  }
  return new Response(null, { status: 303, headers: { location: "/" } });
}

class WebFailure extends Error {
  constructor(
    readonly title: string,
    message: string,
    readonly help: string[],
    readonly status: number,
  ) {
    super(message);
  }
}

function failureOf(e: unknown): { title: string; message: string; help: string[]; status: number } | null {
  const failed = "Launch failed";
  if (e instanceof WebFailure) return e;
  if (e instanceof StepFailed) return { title: failed, message: e.message, help: e.help, status: 502 };
  if (e instanceof DispatchError) return { title: failed, message: e.message, help: e.help, status: e.usage ? 400 : 409 };
  if (e instanceof ConfigError) return { title: "Config error", message: e.message, help: [e.help], status: 500 };
  if (e instanceof WorldError) return { title: "Error", message: e.message, help: [], status: 502 };
  return null;
}

function renderBoard(repos: Repo[], board: Board, choices: Choices) {
  if (repos.length === 0) {
    return '<p class="empty">No Repos configured. Run <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code> to add one.</p>';
  }
  const refresh = ['<form method="post" action="/harnesses/refresh" class="refresh">', "<button>Refresh harnesses</button>", "</form>"];
  const warnings = choices.catalogs.flatMap((c) => (c.error ? [`<p class="warning">${escape(c.error)}</p>`] : []));
  const sections = repos.map((repo) =>
    ['<section class="repo">', `<h2>${escape(repo.slug)}</h2>`, renderRepo(repo, board, choices), "</section>"].join("\n"),
  );
  return [...refresh, ...warnings, ...sections, renderInFlight(board.inFlight, choices)].join("\n");
}

/** Polled every ~5s, replacing itself; launch forms keep what the user chose across polls. */
function renderInFlight(rows: InFlightRow[], choices: Choices) {
  const list = rows.length
    ? ["<ul>", ...rows.map((row) => renderInFlightRow(row, choices)), "</ul>"].join("\n")
    : '<p class="empty">Nothing in flight.</p>';
  return ['<section class="in-flight" hx-get="/in-flight" hx-trigger="every 5s" hx-swap="outerHTML">', "<h2>In flight</h2>", list, "</section>"].join("\n");
}

function renderInFlightRow(row: InFlightRow, choices: Choices) {
  const { dispatch: d, stage, pr, prError } = row;
  const { harness, model, effort } = d.implementer;
  const failure = d.failure ?? d.reviewer?.failure;
  const parts = [
    `<a href="${escape(d.url)}">${escape(d.issue)} ${escape(d.title)}</a>`,
    escape(`${harness} ${model} ${effort}`),
    ...(d.workspace ? [`workspace ${escape(d.workspace)}`] : []),
    failure ? `<span class="error">${escape(`${stage}: ${failure.error}`)}</span>` : escape(stage),
    ...(pr ? [`<a href="${escape(pr.url)}">PR #${pr.number}</a>`] : []),
    `implementer ${agentState(row.implementerState)}`,
    ...(row.reviewerState ? [`reviewer ${agentState(row.reviewerState)}`] : []),
  ];
  const notes = [...(d.warnings ?? []), ...(prError ? [`could not look up the PR: ${prError}`] : [])];
  const extra = notes.map((w) => `<p class="warning">${escape(w)}</p>`);
  if (d.failure) extra.push(retryForm("dispatch", d.issue, d.implementer));
  else if (d.reviewer?.failure) extra.push(retryForm("review", d.issue, d.reviewer));
  else if (canLaunchReview(row)) {
    // Preserved across polls, so a choice in progress isn't reset.
    const id = `review-${d.issue.replace(/[^\w-]/g, "-")}`;
    extra.push(`<div id="${escape(id)}" hx-preserve="true">\n${launchForm("review", d.issue, choices)}\n</div>`);
  }
  return `<li>${parts.join(" · ")}${extra.map((e) => `\n${e}`).join("")}</li>`;
}

/** Whether a row offers Launch review: a PR is linked (ADR-0003) and no Reviewer was started. */
function canLaunchReview(row: InFlightRow) {
  const d = row.dispatch;
  return row.pr !== null && !d.reviewer && !d.failure && d.workspace !== undefined;
}

/** An Agent state as herdr reports it, `blocked` highlighted since it waits on the user. */
function agentState(state: string) {
  return `<span class="agent${state === "blocked" ? " blocked" : ""}">${escape(state)}</span>`;
}

function renderRepo(repo: Repo, board: Board, choices: Choices) {
  const error = board.errors.find((e) => e.repo === repo.slug);
  if (error) return `<p class="error">Could not load: ${escape(error.error)}</p>`;
  const issues = board.ready.filter((i) => i.repo === repo.slug);
  if (issues.length === 0) return '<p class="empty">No Ready issues.</p>';
  return [
    "<ul>",
    ...issues.map(
      (i) => `<li><a href="${escape(i.url)}">#${i.number} ${escape(i.title)}</a>\n${launchForm("dispatch", `${i.repo}#${i.number}`, choices)}</li>`,
    ),
    "</ul>",
  ].join("\n");
}

type Action = "dispatch" | "review";

/** Changing the Harness or model re-renders the form, so only Efforts valid for the chosen model are offered. */
const rerender = (action: Action) =>
  `hx-get="/${action}-form" hx-include="closest form" hx-target="closest form" hx-swap="outerHTML"`;

const BUTTONS: Record<Action, string> = { dispatch: "Dispatch", review: "Launch review" };

/** What the dispatch form offers, and what it starts from. */
interface Choices {
  catalogs: Catalog[];
  remembered: Remembered;
}

/**
 * The dispatch or review form of an issue, offering each Harness that has models. It
 * starts on the Harness and model last dispatched with (a review form too); a chosen Harness,
 * model and Effort are kept while valid. Otherwise the Effort is the one last
 * used with the model, or the model's first.
 */
function launchForm(
  action: Action,
  issue: string,
  { catalogs, remembered }: Choices,
  chosen: { harness?: string; model?: string; effort?: string } = {},
) {
  const offered = catalogs.filter((c) => c.models.length > 0);
  const { harness: wanted = remembered.last?.harness, model: wantedModel = remembered.last?.model } = chosen;
  const catalog = offered.find((c) => c.harness.name === wanted) ?? offered[0];
  if (!catalog) return '<p class="empty">No Harness has models to launch with.</p>';
  const model = catalog.models.find((m) => m.model === wantedModel) ?? catalog.models[0]!;
  const valid = (effort: string | undefined) => (effort && model.efforts.includes(effort) ? effort : undefined);
  const effort =
    valid(chosen.effort) ?? valid(remembered.efforts[`${catalog.harness.name} ${model.model}`]) ?? model.efforts[0];
  const select = (name: string, options: string[], selected: string | undefined, attributes = "") =>
    `<select name="${name}"${attributes}>${options
      .map((o) => `<option${o === selected ? " selected" : ""}>${escape(o)}</option>`)
      .join("")}</select>`;
  return [
    `<form method="post" action="/${action}" class="dispatch">`,
    `<input type="hidden" name="issue" value="${escape(issue)}">`,
    select("harness", offered.map((c) => c.harness.name), catalog.harness.name, ` ${rerender(action)}`),
    select("model", catalog.models.map((m) => m.model), model.model, ` ${rerender(action)}`),
    select("effort", model.efforts, effort),
    `<button>${BUTTONS[action]}</button>`,
    "</form>",
  ].join("\n");
}

/** Retry re-posts the failed launch's own request, which resumes it from its failed step (ADR-0006). */
function retryForm(action: Action, issue: string, { harness, model, effort }: Launch) {
  const hidden = Object.entries({ issue, harness, model, effort }).map(
    ([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`,
  );
  return [`<form method="post" action="/${action}" class="dispatch">`, ...hidden, "<button>Retry</button>", "</form>"].join("\n");
}

function page(title: string, main: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · nico-agent</title>
<script src="/htmx.min.js"></script>
<style>
body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
h2 { font-size: 1.1rem; margin-bottom: 0.25rem; }
.empty { color: #666; }
.error { color: #b00020; }
.warning { color: #8a5a00; margin: 0.25rem 0 0; }
.agent.blocked { color: #fff; background: #b00020; padding: 0 0.25rem; border-radius: 0.2rem; font-weight: bold; }
form.dispatch { display: inline-flex; gap: 0.25rem; margin-left: 0.5rem; }
form.refresh { margin-bottom: 1rem; }
</style>
</head>
<body>
<h1>${escape(title)}</h1>
<main>
${main}
</main>
</body>
</html>
`;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}
