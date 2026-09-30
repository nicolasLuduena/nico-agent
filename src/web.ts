import htmx from "htmx.org/dist/htmx.min.js" with { type: "text" };
import { type Board, loadBoard } from "./board";
import { type Repo, CONFIG_ERROR_HELP, ConfigError, loadConfig } from "./config";
import type { World } from "./world";

export interface WebContext {
  world: World;
  configDir: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

/** The web app: server-rendered pages over the same core operations as the CLI. */
export function webHandler(ctx: WebContext) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
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
    const board = await loadBoard(ctx.world, repos);
    return new Response(page("Board", renderBoard(repos, board)), { headers: HTML_HEADERS });
  };
}

function renderBoard(repos: Repo[], board: Board) {
  if (repos.length === 0) {
    return '<p class="empty">No Repos configured. Run <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code> to add one.</p>';
  }
  return repos
    .map((repo) => ['<section class="repo">', `<h2>${escape(repo.slug)}</h2>`, renderRepo(repo, board), "</section>"].join("\n"))
    .join("\n");
}

function renderRepo(repo: Repo, board: Board) {
  const error = board.errors.find((e) => e.repo === repo.slug);
  if (error) return `<p class="error">Could not load: ${escape(error.error)}</p>`;
  const issues = board.ready.filter((i) => i.repo === repo.slug);
  if (issues.length === 0) return '<p class="empty">No Ready issues.</p>';
  return [
    "<ul>",
    ...issues.map((i) => `<li><a href="${escape(i.url)}">#${i.number} ${escape(i.title)}</a></li>`),
    "</ul>",
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
