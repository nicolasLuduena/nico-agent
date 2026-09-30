import htmx from "htmx.org/dist/htmx.min.js" with { type: "text" };
import { type Board, loadBoard } from "./board";
import { type Repo, CONFIG_ERROR_HELP, ConfigError, loadConfig } from "./config";
import { DispatchError, dispatch } from "./dispatch";
import { HARNESSES } from "./harness";
import { loadDispatches } from "./state";
import { type World, WorldError } from "./world";

export interface WebContext {
  world: World;
  configDir: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

/** The web app: server-rendered pages over the same core operations as the CLI. */
export function webHandler(ctx: WebContext) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname === "/dispatch" && request.method === "POST") return postDispatch(ctx, request);
    if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405 });
    if (pathname === "/htmx.min.js") {
      return new Response(htmx, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    }
    if (pathname !== "/") return new Response(page("Not found", `<p class="error">No page at ${escape(pathname)}</p>`), { status: 404, headers: HTML_HEADERS });
    let repos: Repo[];
    try {
      repos = loadConfig(ctx.configDir).repos;
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      const body = `<p class="error">${escape(e.message)}</p>\n<p>${escape(CONFIG_ERROR_HELP)}</p>`;
      return new Response(page("Board", body), { status: 500, headers: HTML_HEADERS });
    }
    const board = await loadBoard(ctx.world, repos, loadDispatches(ctx.configDir));
    return new Response(page("Board", renderBoard(repos, board)), { headers: HTML_HEADERS });
  };
}

/** The dispatch form's target: dispatch, then back to the Board. */
async function postDispatch(ctx: WebContext, request: Request) {
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  try {
    await dispatch(ctx.world, ctx.configDir, {
      issue: field("issue"),
      harness: field("harness"),
      model: field("model"),
      effort: field("effort"),
    });
  } catch (e) {
    const failure = failureOf(e);
    if (!failure) throw e;
    const body = [`<p class="error">${escape(failure.message)}</p>`, ...failure.help.map((h) => `<p>${escape(h)}</p>`)].join("\n");
    return new Response(page("Dispatch failed", `${body}\n<p><a href="/">Back to the Board</a></p>`), {
      status: failure.status,
      headers: HTML_HEADERS,
    });
  }
  return new Response(null, { status: 303, headers: { location: "/" } });
}

function failureOf(e: unknown) {
  if (e instanceof DispatchError) return { message: e.message, help: e.help, status: e.usage ? 400 : 409 };
  if (e instanceof ConfigError) return { message: e.message, help: [CONFIG_ERROR_HELP], status: 500 };
  if (e instanceof WorldError) return { message: e.message, help: [], status: 502 };
  return null;
}

function renderBoard(repos: Repo[], board: Board) {
  if (repos.length === 0) {
    return '<p class="empty">No Repos configured. Run <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code> to add one.</p>';
  }
  const sections = repos.map((repo) =>
    ['<section class="repo">', `<h2>${escape(repo.slug)}</h2>`, renderRepo(repo, board), "</section>"].join("\n"),
  );
  return [...sections, renderInFlight(board)].join("\n");
}

function renderInFlight(board: Board) {
  const list = board.inFlight.length
    ? [
        "<ul>",
        ...board.inFlight.map((d) => {
          const { harness, model, effort } = d.implementer;
          const link = `<a href="${escape(d.url)}">${escape(d.issue)} ${escape(d.title)}</a>`;
          return `<li>${link} · ${escape(`${harness} ${model} ${effort}`)} · workspace ${escape(d.workspace)}</li>`;
        }),
        "</ul>",
      ].join("\n")
    : '<p class="empty">Nothing in flight.</p>';
  return ['<section class="in-flight">', "<h2>In flight</h2>", list, "</section>"].join("\n");
}

function renderRepo(repo: Repo, board: Board) {
  const error = board.errors.find((e) => e.repo === repo.slug);
  if (error) return `<p class="error">Could not load: ${escape(error.error)}</p>`;
  const issues = board.ready.filter((i) => i.repo === repo.slug);
  if (issues.length === 0) return '<p class="empty">No Ready issues.</p>';
  return [
    "<ul>",
    ...issues.map(
      (i) => `<li><a href="${escape(i.url)}">#${i.number} ${escape(i.title)}</a>\n${dispatchForm(`${i.repo}#${i.number}`)}</li>`,
    ),
    "</ul>",
  ].join("\n");
}

function dispatchForm(issue: string) {
  const select = (name: string, options: string[]) =>
    `<select name="${name}">${options.map((o) => `<option>${escape(o)}</option>`).join("")}</select>`;
  // Only claude for now, so its models and Efforts are the only choices.
  const harness = HARNESSES[0]!;
  return [
    '<form method="post" action="/dispatch" class="dispatch">',
    `<input type="hidden" name="issue" value="${escape(issue)}">`,
    select("harness", HARNESSES.map((h) => h.name)),
    select("model", harness.models),
    select("effort", harness.efforts),
    "<button>Dispatch</button>",
    "</form>",
  ].join("\n");
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
form.dispatch { display: inline-flex; gap: 0.25rem; margin-left: 0.5rem; }
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
