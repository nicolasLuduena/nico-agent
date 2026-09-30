import htmx from "htmx.org/dist/htmx.min.js" with { type: "text" };
import { type Board, loadBoard } from "./board";
import { type Repo, ConfigError, loadConfig } from "./config";
import { DispatchError, StepFailed, dispatch } from "./dispatch";
import { type Catalog, harnessCatalogs, refreshHarnesses } from "./harness";
import { type Dispatch, loadDispatches, stageOf } from "./state";
import { type World, WorldError } from "./world";

export interface WebContext {
  world: World;
  configDir: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

/** The web app: server-rendered pages over the same core operations as the CLI. */
export function webHandler(ctx: WebContext) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname === "/dispatch" && request.method === "POST") return await postDispatch(ctx, request);
      if (pathname === "/harnesses/refresh" && request.method === "POST") return await postRefresh(ctx);
      if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405 });
      if (pathname === "/htmx.min.js") {
        return new Response(htmx, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      if (pathname === "/dispatch-form") return await getDispatchForm(ctx, url.searchParams);
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

async function getBoard(ctx: WebContext) {
  const { repos } = loadConfig(ctx.configDir);
  const board = await loadBoard(ctx.world, repos, loadDispatches(ctx.configDir));
  // Discovery may run a Harness's CLI, so only when there is something to dispatch.
  const catalogs = board.ready.length ? await harnessCatalogs(ctx.world, ctx.configDir) : [];
  return new Response(page("Board", renderBoard(repos, board, catalogs)), { headers: HTML_HEADERS });
}

/** The dispatch form again, after a choice changed: only the chosen model's Efforts are offered. */
async function getDispatchForm(ctx: WebContext, params: URLSearchParams) {
  const param = (name: string) => params.get(name) ?? "";
  const catalogs = await harnessCatalogs(ctx.world, ctx.configDir);
  const form = dispatchForm(param("issue"), catalogs, { harness: param("harness"), model: param("model"), effort: param("effort") });
  return new Response(form, { headers: HTML_HEADERS });
}

/** The dispatch form's target: dispatch, then back to the Board. */
async function postDispatch(ctx: WebContext, request: Request) {
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  await dispatch(ctx.world, ctx.configDir, {
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
  const failed = "Dispatch failed";
  if (e instanceof WebFailure) return e;
  if (e instanceof StepFailed) return { title: failed, message: e.message, help: e.help, status: 502 };
  if (e instanceof DispatchError) return { title: failed, message: e.message, help: e.help, status: e.usage ? 400 : 409 };
  if (e instanceof ConfigError) return { title: "Config error", message: e.message, help: [e.help], status: 500 };
  if (e instanceof WorldError) return { title: "Error", message: e.message, help: [], status: 502 };
  return null;
}

function renderBoard(repos: Repo[], board: Board, catalogs: Catalog[]) {
  if (repos.length === 0) {
    return '<p class="empty">No Repos configured. Run <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code> to add one.</p>';
  }
  const refresh = ['<form method="post" action="/harnesses/refresh" class="refresh">', "<button>Refresh harnesses</button>", "</form>"];
  const warnings = catalogs.flatMap((c) => (c.error ? [`<p class="warning">${escape(c.error)}</p>`] : []));
  const sections = repos.map((repo) =>
    ['<section class="repo">', `<h2>${escape(repo.slug)}</h2>`, renderRepo(repo, board, catalogs), "</section>"].join("\n"),
  );
  return [...refresh, ...warnings, ...sections, renderInFlight(board)].join("\n");
}

function renderInFlight(board: Board) {
  const list = board.inFlight.length
    ? [
        "<ul>",
        ...board.inFlight.map((d) => {
          const { harness, model, effort } = d.implementer;
          const link = `<a href="${escape(d.url)}">${escape(d.issue)} ${escape(d.title)}</a>`;
          const where = d.workspace ? ` · workspace ${escape(d.workspace)}` : "";
          const warnings = (d.warnings ?? []).map((w) => `\n<p class="warning">${escape(w)}</p>`).join("");
          const item = `<li>${link} · ${escape(`${harness} ${model} ${effort}`)}${where}`;
          if (!d.failure) return `${item} · ${escape(stageOf(d))}${warnings}</li>`;
          return `${item} · <span class="error">${escape(`${stageOf(d)}: ${d.failure.error}`)}</span>\n${retryForm(d)}</li>`;
        }),
        "</ul>",
      ].join("\n")
    : '<p class="empty">Nothing in flight.</p>';
  return ['<section class="in-flight">', "<h2>In flight</h2>", list, "</section>"].join("\n");
}

function renderRepo(repo: Repo, board: Board, catalogs: Catalog[]) {
  const error = board.errors.find((e) => e.repo === repo.slug);
  if (error) return `<p class="error">Could not load: ${escape(error.error)}</p>`;
  const issues = board.ready.filter((i) => i.repo === repo.slug);
  if (issues.length === 0) return '<p class="empty">No Ready issues.</p>';
  return [
    "<ul>",
    ...issues.map(
      (i) => `<li><a href="${escape(i.url)}">#${i.number} ${escape(i.title)}</a>\n${dispatchForm(`${i.repo}#${i.number}`, catalogs)}</li>`,
    ),
    "</ul>",
  ].join("\n");
}

/** Changing the Harness or model re-renders the form, so only Efforts valid for the chosen model are offered. */
const RERENDER = 'hx-get="/dispatch-form" hx-include="closest form" hx-target="closest form" hx-swap="outerHTML"';

/**
 * The dispatch form of an issue, offering each Harness that has models. The
 * chosen Harness, model and Effort are kept while valid; otherwise the first
 * valid one is chosen.
 */
function dispatchForm(issue: string, catalogs: Catalog[], chosen: { harness?: string; model?: string; effort?: string } = {}) {
  const offered = catalogs.filter((c) => c.models.length > 0);
  const catalog = offered.find((c) => c.harness.name === chosen.harness) ?? offered[0];
  if (!catalog) return '<p class="empty">No Harness has models to dispatch with.</p>';
  const model = catalog.models.find((m) => m.model === chosen.model) ?? catalog.models[0]!;
  const effort = chosen.effort && model.efforts.includes(chosen.effort) ? chosen.effort : model.efforts[0];
  const select = (name: string, options: string[], selected: string | undefined, attributes = "") =>
    `<select name="${name}"${attributes}>${options
      .map((o) => `<option${o === selected ? " selected" : ""}>${escape(o)}</option>`)
      .join("")}</select>`;
  return [
    '<form method="post" action="/dispatch" class="dispatch">',
    `<input type="hidden" name="issue" value="${escape(issue)}">`,
    select("harness", offered.map((c) => c.harness.name), catalog.harness.name, ` ${RERENDER}`),
    select("model", catalog.models.map((m) => m.model), model.model, ` ${RERENDER}`),
    select("effort", model.efforts, effort),
    "<button>Dispatch</button>",
    "</form>",
  ].join("\n");
}

/** Retry re-posts the Dispatch's own request, which resumes it from its failed step (ADR-0006). */
function retryForm(d: Dispatch) {
  const { harness, model, effort } = d.implementer;
  const hidden = Object.entries({ issue: d.issue, harness, model, effort }).map(
    ([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`,
  );
  return ['<form method="post" action="/dispatch" class="dispatch">', ...hidden, "<button>Retry</button>", "</form>"].join("\n");
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
