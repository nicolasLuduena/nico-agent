import htmx from "htmx.org/dist/htmx.min.js" with { type: "text" };
import { type BaseChoice, type Board, type BoardIssue, type StackOption, type StackableIssue, baseChoice, loadBoard, stackChoice, stackOptions } from "./board";
import type { RepoDecision, SpecDecision } from "./spec";
import { githubSource, linearSource } from "./source";
import { type Repo, ConfigError, findRepo, loadConfig } from "./config";
import { type IssueOutcome, CloseConfirmationRequired, StepFailed, baseBranch, closeDispatch, dispatch, eachIssue, review, resolveIssue } from "./dispatch";
import { DispatchError } from "./dispatch-error";
import { type Catalog, type Remembered, harnessCatalogs, refreshHarnesses, rememberedLaunches } from "./harness";
import { type InFlightRow, type PrLookup, cachedPrs, loadInFlight } from "./stage";
import { type Dispatch, type Launch, findDispatch, loadDispatches } from "./state";
import { plural } from "./output";
import { sameSlug } from "./slug";
import { type PullRequest, type World, WorldError } from "./world";

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
      if (pathname === "/batch/dispatch" && request.method === "POST") return await postBatch(ctx, request, "dispatch");
      if (pathname === "/batch/review" && request.method === "POST") return await postBatch(ctx, request, "review");
      if (pathname === "/close" && request.method === "POST") return await postClose(ctx, request);
      if (pathname === "/harnesses/refresh" && request.method === "POST") return await postRefresh(ctx);
      if (request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405 });
      if (pathname === "/htmx.min.js") {
        return new Response(htmx, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      }
      if (pathname === "/dispatch-form") return await getLaunchForm(ctx, url.searchParams, "dispatch");
      if (pathname === "/review-form") return await getLaunchForm(ctx, url.searchParams, "review");
      if (pathname === "/in-flight") return await getInFlight(ctx);
      if (pathname === "/action-bar") return await getActionBar(ctx, url.searchParams);
      if (pathname === "/batch-form") return await getBatchForm(ctx, url.searchParams);
      if (pathname === "/batch-row") return await getBatchRow(ctx, url.searchParams);
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

/**
 * Close each issue posted. Those with a PR close straight away; those with no
 * PR yet are listed in one confirmation step, which posts them back confirmed.
 */
async function postClose(ctx: WebContext, request: Request) {
  const form = await request.formData();
  const issues = unique(form.getAll("issue").map(String));
  const confirm = form.get("confirm") === "yes";
  // A single issue's failure is an error page, as before batches.
  const outcomes = issues.length === 1
    ? [{ issue: issues[0]!, outcome: "done" as const, value: await closeOrAsk(ctx, issues[0]!, confirm) }]
    : await eachIssue(issues, (issue) => closeOrAsk(ctx, issue, confirm));
  const unconfirmed = outcomes.flatMap((o) => (o.outcome === "done" && o.value === "unconfirmed" ? [o.issue] : []));
  const reported = outcomes.filter((o) => !(o.outcome === "done" && o.value === "unconfirmed"));
  if (!unconfirmed.length && reported.every((o) => o.outcome === "done" && o.value === "closed")) {
    return new Response(null, { status: 303, headers: { location: "/" } });
  }
  const body = [
    ...(reported.length ? [renderOutcomes(reported, (closed) => (closed === "closed" ? "closed" : "skipped, not In flight"))] : []),
    ...(unconfirmed.length ? [
      `<p>${unconfirmed.map(escape).join(", ")} ${unconfirmed.length === 1 ? "has" : "have"} no PR yet. Close removes the worktree and workspace and forgets the Dispatch. The branch is kept.</p>`,
      closeForm(unconfirmed, true),
    ] : []),
    '<p><a href="/">Back to the Board</a></p>',
  ].join("\n");
  return new Response(page(unconfirmed.length ? "Confirm close" : "Close", body), { headers: HTML_HEADERS });
}

/** Close an issue, or say it awaits confirmation or was not In flight (`existing`). */
async function closeOrAsk(ctx: WebContext, issue: string, confirm: boolean) {
  try {
    return (await closeDispatch(ctx.world, ctx.configDir, issue, confirm)).outcome;
  } catch (e) {
    if (!(e instanceof CloseConfirmationRequired)) throw e;
    return "unconfirmed" as const;
  }
}

function closeForm(issues: string[], confirm = false) {
  return ['<form method="post" action="/close">',
    ...issues.map((issue) => `<input type="hidden" name="issue" value="${escape(issue)}">`),
    ...(confirm ? ['<input type="hidden" name="confirm" value="yes">'] : []),
    `<button>${confirm ? "Confirm close" : "Close"}</button>`, "</form>"].join("\n");
}

interface ServerContext extends WebContext {
  prs: PrLookup;
}

async function getBoard(ctx: ServerContext) {
  const { repos } = loadConfig(ctx.configDir);
  const board = await loadBoard(ctx.world, repos, loadDispatches(ctx.configDir), ctx.prs, rememberedLaunches(ctx.configDir).bases);
  // Discovery may run a Harness's CLI, so only when there is something to launch.
  const launchable = board.ready.length > 0 || board.stackable.length > 0 || board.inFlight.some(canLaunchReview);
  const choices = await choicesFor(ctx, launchable);
  return new Response(page("Board", renderBoard(repos, board, choices), repos.length ? REFRESH : ""), { headers: HTML_HEADERS });
}

/** The In-flight section alone, for the Board to poll. */
async function getInFlight(ctx: ServerContext) {
  const rows = await loadInFlight(ctx.world, loadDispatches(ctx.configDir), ctx.prs);
  const choices = await choicesFor(ctx, rows.some(canLaunchReview));
  // The event display rides along out of band, so one poll redraws both.
  return new Response(`${renderInFlight(rows, choices)}\n${renderEvent(rows, true)}`, { headers: HTML_HEADERS });
}

async function choicesFor(ctx: WebContext, needed: boolean): Promise<Choices> {
  return { catalogs: needed ? await harnessCatalogs(ctx.world, ctx.configDir) : [], remembered: rememberedLaunches(ctx.configDir) };
}

/** A launch form again, after a choice changed: only the chosen model's Efforts are offered. */
async function getLaunchForm(ctx: WebContext, params: URLSearchParams, action: Action) {
  const param = (name: string) => params.get(name) ?? "";
  const choices = await choicesFor(ctx, true);
  const chosen = { harness: param("harness"), model: param("model"), effort: param("effort"), stackOn: param("stackOn"), repo: param("repo") };
  let options: StackOption[] = [];
  let base: BaseChoice | undefined;
  if (action === "dispatch") {
    const ref = resolveIssue(ctx.configDir, param("issue"));
    const repo = ref.repo ?? formRepo(ctx.configDir, chosen.repo);
    if (ref.repo) {
      const issue = await ctx.world.githubIssue(ref.repo.slug, ref.number);
      if (issue) options = await stackOptions(githubSource(ctx.world, ref.repo.slug), issue);
    } else {
      const issue = await ctx.world.linearIssue(ref.identifier);
      if (issue) options = await stackOptions(linearSource(ctx.world, repo.slug), issue);
    }
    // A Stacked dispatch has no Base choice.
    if (!options.length) base = await baseChoice(ctx.world, repo, param("base") || choices.remembered.bases[repo.slug]);
  }
  return new Response(launchForm(action, param("issue"), choices, chosen, options, base), { headers: HTML_HEADERS });
}

/** The Repo a Linear issue's dispatch form names, since the issue alone doesn't. */
function formRepo(configDir: string, slug: string) {
  const repo = findRepo(loadConfig(configDir), slug);
  if (!repo) throw new DispatchError(`\`${slug}\` is not a configured Repo`, ["Dispatch a Linear issue from its row on the Board, which names its Repo"], true);
  return repo;
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
    ...(launch === dispatch && field("stackOn") && { stackOn: field("stackOn") }),
    ...(launch === dispatch && field("base") && { base: field("base") }),
    ...(launch === dispatch && field("repo") && { repo: field("repo") }),
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
  const warnings = choices.catalogs.flatMap((c) => (c.error ? [`<p class="warning">${escape(c.error)}</p>`] : []));
  const sections = repos.map((repo) => renderRepo(repo, board, choices));
  return [...warnings, renderEvent(board.inFlight), actionBar({ dispatch: 0, review: 0, close: 0 }), renderInFlight(board.inFlight, choices), ...sections].join("\n");
}

/** Where a row's track ends, by Stage: inside the tracker, in the calorimeter, out through the muon stations. */
type Reach = "implementing" | "pr-ready" | "review-launched" | "failed" | "unknown";

function reachOf(row: InFlightRow): Reach {
  if (row.dispatch.failure || row.dispatch.reviewer?.failure) return "failed";
  if (row.stage === "Implementing" || row.stage === "PR ready" || row.stage === "Review launched") {
    return row.stage.toLowerCase().replace(/[^a-z]+/g, "-") as Reach;
  }
  return "unknown";
}

/** A stable 32-bit hash, so a Dispatch's track keeps its angle and bend across polls. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const R = { tracker: 62, ecal: [70, 86], hcal: [92, 112], muon: [126, 146], failedEarly: 40, failedReview: 112 } as const;

/**
 * The In-flight Dispatches as an event display's transverse view: one track
 * per Dispatch, reaching as far out as its Stage. Rows stay the place to act;
 * the display is for reading the Board at a glance.
 */
function renderEvent(rows: InFlightRow[], oob = false) {
  const counts: Record<Reach, number> = { implementing: 0, "pr-ready": 0, "review-launched": 0, failed: 0, unknown: 0 };
  let blocked = 0;
  const angles = spread(rows.map((r) => r.dispatch.issue));
  const tracks = rows.map((row) => {
    const reach = reachOf(row);
    counts[reach]++;
    const waiting = row.implementerState === "blocked" || row.reviewerState === "blocked";
    if (waiting) blocked++;
    return renderTrack(row, reach, waiting, angles.get(row.dispatch.issue)!);
  });
  const legend = (reach: Reach, label: string) =>
    `<div class="${reach}${counts[reach] ? "" : " none"}"><dt><i></i>${label}</dt><dd>${counts[reach]}</dd></div>`;
  const time = new Date();
  const clock = time.toTimeString().slice(0, 8);
  return [
    `<figure class="event" id="event"${oob ? ' hx-swap-oob="true"' : ""}>`,
    `<svg viewBox="-200 -162 400 324" role="img" aria-label="${escape(`${plural(rows.length, "Dispatch")} in flight`)}">`,
    DETECTOR,
    ...tracks,
    '<circle class="vertex" r="2.5"/>',
    "</svg>",
    "<figcaption>",
    `<p class="lede">${rows.length ? "Each track is a Dispatch. It reaches as far out as its Stage." : "No tracks: nothing in flight."}</p>`,
    '<dl class="stages">',
    legend("implementing", "Implementing"),
    legend("pr-ready", "PR ready"),
    legend("review-launched", "Review launched"),
    legend("failed", "Failed"),
    ...(counts.unknown ? [legend("unknown", "Stage unknown")] : []),
    "</dl>",
    `<dl class="agents"><div class="blocked${blocked ? "" : " none"}"><dt><i></i>Agent blocked</dt><dd>${blocked}</dd></div></dl>`,
    `<p class="sampled">Sampled <time datetime="${time.toISOString()}">${clock}</time></p>`,
    "</figcaption>",
    "</figure>",
  ].join("\n");
}

/**
 * Each issue's track angle: its hash's home angle, nudged apart from close
 * neighbours. A Dispatch coming or going moves only the tracks beside it.
 */
function spread(issues: string[]) {
  const TAU = 2 * Math.PI;
  // The ring key runs straight down; it holds its place and tracks keep clear of it.
  const KEY = "";
  const points = [{ issue: KEY, a: Math.PI / 2 }, ...issues.map((issue) => ({ issue, a: ((hash(issue) % 3600) / 3600) * TAU }))];
  const min = Math.min(TAU / points.length, 0.5) * 0.85;
  for (let pass = 0; pass < 24 && points.length > 1; pass++) {
    points.sort((x, y) => x.a - y.a || x.issue.localeCompare(y.issue));
    let moved = false;
    points.forEach((p, i) => {
      const next = points[(i + 1) % points.length]!;
      const gap = (next.a - p.a + TAU) % TAU;
      if (gap >= min) return;
      const push = (min - gap) / (p.issue === KEY || next.issue === KEY ? 1 : 2);
      if (p.issue !== KEY) p.a = (p.a - push + TAU) % TAU;
      if (next.issue !== KEY) next.a = (next.a + push) % TAU;
      moved = true;
    });
    if (!moved) break;
  }
  return new Map(points.filter((p) => p.issue !== KEY).map((p) => [p.issue, p.a]));
}

/** The detector's fixed geometry: tracker layers, the two calorimeters, two muon stations. */
const DETECTOR = [
  '<g class="geometry" fill="none">',
  ...[14, 26, 38, 50, 62].map((r) => `<circle r="${r}"/>`),
  `<circle class="ecal" r="${(R.ecal[0] + R.ecal[1]) / 2}" stroke-width="${R.ecal[1] - R.ecal[0]}" pathLength="360" stroke-dasharray="6.5 1"/>`,
  `<circle class="hcal" r="${(R.hcal[0] + R.hcal[1]) / 2}" stroke-width="${R.hcal[1] - R.hcal[0]}" pathLength="360" stroke-dasharray="14 1.5"/>`,
  ...R.muon.map((r) => `<circle class="muon" r="${r}" stroke-width="6" pathLength="360" stroke-dasharray="26 4"/>`),
  "</g>",
  // The subdetectors named along one radius, as event displays do.
  '<g class="key" text-anchor="middle">',
  `<text y="${R.tracker - 6}">Tracker</text>`,
  `<text y="${(R.ecal[0] + R.ecal[1]) / 2}" dominant-baseline="middle">ECAL</text>`,
  `<text y="${(R.hcal[0] + R.hcal[1]) / 2}" dominant-baseline="middle">HCAL</text>`,
  `<text y="${(R.muon[0] + R.muon[1]) / 2}" dominant-baseline="middle">Muon</text>`,
  "</g>",
].join("\n");

function renderTrack(row: InFlightRow, reach: Reach, waiting: boolean, angle: number) {
  const { issue } = row.dispatch;
  const h = hash(issue);
  // A track's bend is its charge: either way, never straight.
  const bend = (((h >>> 12) % 100) / 100 - 0.5) * 0.7 + (((h >>> 12) % 100) < 50 ? -0.12 : 0.12);
  const end = reach === "implementing" ? R.tracker - 4
    : reach === "pr-ready" ? R.ecal[0]
    : reach === "review-launched" ? R.muon[1] + 6
    : reach === "failed" ? (row.dispatch.reviewer?.failure ? R.failedReview : R.failedEarly)
    : R.tracker - 4;
  const at = (r: number, a = angle) => [r * Math.cos(a), r * Math.sin(a)] as const;
  const [ex, ey] = at(end);
  // Curvature eases off beyond the tracker, where the field is weak.
  const [cx, cy] = at(Math.min(end, R.tracker) * 0.55, angle - bend * (Math.min(end, R.tracker) / end));
  const n = (v: number) => v.toFixed(1);
  const marks: string[] = [];
  if (reach === "pr-ready") {
    // An energy deposit: a tower through the electromagnetic calorimeter.
    const [ax, ay] = at(R.ecal[0]);
    const [bx, by] = at(R.ecal[1] - 1);
    marks.push(`<line class="deposit" x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}"/>`);
  }
  if (reach === "review-launched") {
    for (const r of R.muon) {
      const [ax, ay] = at(r - 3);
      const [bx, by] = at(r + 3);
      marks.push(`<line class="hit" x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}"/>`);
    }
  }
  if (reach === "failed") {
    marks.push(`<g class="burst" transform="translate(${n(ex)} ${n(ey)})">${[0, 60, 120].map((d) => `<line x1="-5" x2="5" transform="rotate(${d + (h % 60)})"/>`).join("")}</g>`);
  } else {
    marks.push(`<circle class="tip" cx="${n(ex)}" cy="${n(ey)}" r="${waiting ? 2.6 : 1.8}"/>`);
  }
  if (waiting) marks.push(`<circle class="attention" cx="${n(ex)}" cy="${n(ey)}" r="6"/>`);
  const [lx, ly] = at(end + (reach === "pr-ready" ? R.ecal[1] - R.ecal[0] + 6 : waiting ? 13 : 8));
  const label = issue.slice(issue.indexOf("/") + 1);
  // Labels stay inside the display: one that would run off the edge turns back along its track.
  const width = label.length * 6;
  let anchor = Math.cos(angle) > 0.25 ? "start" : Math.cos(angle) < -0.25 ? "end" : "middle";
  let x = lx;
  if (anchor === "start" && lx + width > 196) [anchor, x] = ["end", Math.min(lx, 196)];
  if (anchor === "end" && lx - width < -196) [anchor, x] = ["start", Math.max(lx, -196)];
  const working = row.implementerState === "working" || row.reviewerState === "working";
  return [
    `<g class="track ${reach}${waiting ? " waiting" : ""}${working ? " working" : ""}" data-issue="${escape(issue)}">`,
    `<title>${escape(`${issue} ${row.dispatch.title}: ${row.stage}`)}</title>`,
    `<path d="M0 0 Q${n(cx)} ${n(cy)} ${n(ex)} ${n(ey)}" pathLength="1"/>`,
    ...marks,
    `<text x="${n(x)}" y="${n(ly)}" text-anchor="${anchor}" dominant-baseline="middle">${escape(label)}</text>`,
    "</g>",
  ].join("");
}

const REFRESH = '<form method="post" action="/harnesses/refresh" class="refresh"><button>Refresh harnesses</button></form>';

/** A branch mark, drawn in the brand glyph's stroke. */
const BRANCH = '<svg class="icon" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="2.5" r="1.5"/><circle cx="3" cy="9.5" r="1.5"/><circle cx="9" cy="3.5" r="1.5"/><path d="M3 4v4M9 5c0 2.5-6 1.5-6 3"/></svg>';

/** A Base, as a chip with the branch mark. */
function baseChip(branch: string) {
  return `<span class="chip" title="Base">${BRANCH}${escape(branch)}</span>`;
}

/** An issue's link: its number or key set apart from its title. */
function issueLink(label: string, title: string, url: string) {
  return `<a class="title" href="${escape(url)}"><span class="num">${escape(label)}</span> ${escape(title)}</a>`;
}

/** Polled every ~5s, replacing itself; launch forms keep what the user chose across polls. */
function renderInFlight(rows: InFlightRow[], choices: Choices) {
  const list = rows.length
    ? ['<ul class="flights">', ...rows.map((row) => renderInFlightRow(row, choices)), "</ul>"].join("\n")
    : '<p class="empty">Nothing in flight.</p>';
  return [
    '<section class="in-flight" hx-get="/in-flight" hx-trigger="every 5s" hx-swap="outerHTML">',
    `<header><h2>In flight</h2><span class="count">${rows.length}</span></header>`,
    list,
    "</section>",
  ].join("\n");
}

function renderInFlightRow(row: InFlightRow, choices: Choices) {
  const { dispatch: d, stage, pr, prError } = row;
  const { harness, model, effort } = d.implementer;
  const failure = d.failure ?? d.reviewer?.failure;
  const head = [
    // Preserved across polls, so a ticked row stays ticked.
    pick(d.issue, true),
    // The Repo's name is enough to tell issues apart; the owner is in the link.
    issueLink(d.issue.slice(d.issue.indexOf("/") + 1), d.title, d.url),
    stageKey(row),
    ...(pr ? [prLink(pr)] : []),
  ];
  const meta = [
    `<span class="chip">${escape(`${harness} · ${model} · ${effort}`)}</span>`,
    ...(d.base ? [baseChip(baseBranch(d)!)] : []),
    ...(d.workspace ? [`<span class="chip" title="herdr workspace">${escape(d.workspace)}</span>`] : []),
    agentState("implementer", row.implementerState),
    ...(row.reviewerState ? [agentState("reviewer", row.reviewerState)] : []),
  ];
  const notes = [
    ...(failure ? [`<p class="error">${escape(failure.error)}</p>`] : []),
    ...[...(d.warnings ?? []), ...(prError ? [`could not look up the PR: ${prError}`] : [])].map((w) => `<p class="warning">${escape(w)}</p>`),
  ];
  const actions = [closeForm([d.issue])];
  if (d.failure) actions.push(retryForm("dispatch", d.issue, d.implementer, d.stackedOn?.pr.url));
  else if (d.reviewer?.failure) actions.push(retryForm("review", d.issue, d.reviewer));
  else if (canLaunchReview(row)) {
    // Preserved across polls, so a choice in progress isn't reset.
    const id = `review-${d.issue.replace(/[^\w-]/g, "-")}`;
    actions.push(`<div id="${escape(id)}" hx-preserve="true">\n${launchForm("review", d.issue, choices)}\n</div>`);
  }
  return [
    '<li class="flight">',
    `<div class="head">${head.join("")}</div>`,
    `<div class="meta">${meta.join("")}</div>`,
    ...(notes.length ? [`<div class="notes">${notes.join("")}</div>`] : []),
    '<div class="row-actions">',
    ...actions,
    "</div>",
    "</li>",
  ].join("\n");
}

/** Whether a row offers Launch review: a PR is linked (ADR-0003) and no Reviewer was started. */
function canLaunchReview(row: InFlightRow) {
  const d = row.dispatch;
  return row.pr !== null && !d.reviewer && !d.failure && d.workspace !== undefined;
}

/** An agent's Agent state as herdr reports it; `blocked` stands out since it waits on the user. */
function agentState(role: string, state: string) {
  return `<span class="agent ${escape(state)}"><i></i>${role} ${escape(state)}</span>`;
}

function renderRepo(repo: Repo, board: Board, choices: Choices) {
  const errors = board.errors.filter((e) => e.repo === repo.slug)
    .map((e) => `<p class="error">Could not load: ${e.source ? `${e.source}: ` : ""}${escape(e.error)}</p>`);
  const ready = board.ready.filter((i) => i.repo === repo.slug);
  const stackable = board.stackable.filter((i) => i.repo === repo.slug);
  const decision = board.specs.find((r) => r.repo === repo.slug);
  const groups = decision ? groupsOf(decision) : [];
  const grouped = new Set(groups.flatMap((s) => s.issues));
  const list = (rows: string[]) => ['<ul class="issues">', ...rows, "</ul>"].join("\n");
  const readyRow = (i: BoardIssue) => i.identifier
    // No tick box: a batch row can't name the Repo of an issue several Repos claim.
    ? `<li>${issueLink(i.identifier, i.title, i.url)}${i.base ? baseChip(i.base) : ""}\n${launchForm("dispatch", i.identifier, choices, { repo: repo.slug }, [], board.bases[i.repo])}</li>`
    : `<li>${pick(boardKey(i))}${issueLink(`#${i.number}`, i.title, i.url)}\n${launchForm("dispatch", boardKey(i), choices, {}, [], board.bases[i.repo])}</li>`;
  const stackRow = (i: StackableIssue) => i.identifier
    ? `<li>${issueLink(i.identifier, i.title, i.url)}\n${launchForm("dispatch", i.identifier, choices, { repo: repo.slug }, i.blockers)}</li>`
    : `<li>${pick(boardKey(i))}${issueLink(`#${i.number}`, i.title, i.url)}\n${launchForm("dispatch", boardKey(i), choices, {}, i.blockers)}</li>`;
  // An issue's row sits under its Spec; the rest are Specs of one, listed as before.
  const looseReady = ready.filter((i) => !grouped.has(boardKey(i)));
  const looseStackable = stackable.filter((i) => !grouped.has(boardKey(i)));
  // A Linear issue several Repos claim is In flight only in the Repo it was dispatched in.
  const flightOf = (issue: string) => board.inFlight.find((r) => sameSlug(r.dispatch.repo, repo.slug) && sameSlug(r.dispatch.issue, issue));
  const rowsOf = (spec: SpecDecision) => spec.issues.flatMap((issue) => {
    const flight = flightOf(issue);
    if (flight) return issue === spec.spec ? [] : [memberRow(flight, repo.slug)];
    const r = ready.find((i) => boardKey(i) === issue);
    if (r) return [readyRow(r)];
    const s = stackable.find((i) => boardKey(i) === issue);
    return s ? [stackRow(s)] : [];
  });
  const specSections = groups.map((spec) =>
    renderSpec(spec, specState(spec, decision!), rowsOf(spec), flightOf(spec.spec), repo.slug));
  return [
    '<section class="repo">',
    `<header><h2>${escape(repo.slug)}</h2><span class="count">${ready.length + stackable.length}</span>${decision ? roomReadout(decision) : ""}</header>`,
    ...errors,
    errors.length || ready.length ? "" : '<p class="empty">No Ready issues.</p>',
    ...specSections,
    ...(looseReady.length && specSections.length ? ["<h3>Specs of one</h3>"] : []),
    looseReady.length ? list(looseReady.map(readyRow)) : "",
    ...(looseStackable.length ? ["<h3>Stackable</h3>", list(looseStackable.map(stackRow))] : []),
    "</section>",
  ].filter(Boolean).join("\n");
}

/** An issue as the CLI names it: `BLE-27` or `owner/repo#N`. */
function boardKey(issue: BoardIssue) {
  return issue.identifier ?? `${issue.repo}#${issue.number}`;
}

/**
 * The Specs a Repo section groups rows under, running ones first, then Held,
 * then candidates. A Spec of one that is neither running nor Held stays a
 * plain row, since its row says all there is.
 */
function groupsOf(decision: RepoDecision) {
  const order: SpecState[] = ["running", "held", "candidate", "waiting", "not-startable"];
  const rank = (s: SpecDecision) => order.indexOf(specState(s, decision));
  return decision.specs
    .filter((s) => s.running || s.held || s.issues.length !== 1 || s.issues[0] !== s.spec)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

type SpecState = "held" | "running" | "candidate" | "waiting" | "not-startable";

const SPEC_STATES: Record<SpecState, string> = { held: "Held", running: "Running", candidate: "Candidate", waiting: "Waiting", "not-startable": "Not startable" };

/** A Spec's state for the Board, Held first since a Held Spec may be running too. */
function specState(spec: SpecDecision, decision: RepoDecision): SpecState {
  if (spec.held) return "held";
  if (spec.running) return "running";
  if (decision.candidates.includes(spec.spec)) return "candidate";
  return spec.waiting ? "waiting" : "not-startable";
}

/** The Repo's Specs as the Scheduler sees them: a slot per Spec that may run, filled while one does. */
function roomReadout({ repo, specs, room, candidates }: RepoDecision) {
  const running = specs.filter((s) => s.running).length;
  const slots = [...Array(running).fill('<i class="taken"></i>'), ...Array(room).fill("<i></i>")].join("");
  const figure = (label: string, n: number) => `<span>${label} <b>${n}</b></span>`;
  return [
    `<div class="room" role="group" aria-label="Specs of ${escape(repo)}">`,
    `<span class="slots" aria-hidden="true">${slots}</span>`,
    figure("Running", running), figure("Room", room), figure("Candidates", candidates.length),
    "</div>",
  ].join("");
}

/** A Spec's group: its state, what it does next or why not, and its issues' rows in sub-issue order. */
function renderSpec(spec: SpecDecision, state: SpecState, rows: string[], ownFlight: InFlightRow | undefined, repo: string) {
  const note = spec.held?.reason ?? spec.waiting?.reason ?? spec.next?.reason ?? spec.reason ??
    (state === "not-startable" ? "None of its issues is Ready" : undefined);
  const key = repoKey(spec.spec, repo);
  const title = spec.url ? issueLink(key, spec.title, spec.url) : `<span class="title"><span class="num">${escape(key)}</span> ${escape(spec.title)}</span>`;
  return [
    `<div class="spec ${state}">`,
    // A Spec of one In flight is its own issue, so its Stage sits in its heading.
    `<header><span class="spec-state">${SPEC_STATES[state]}</span>${title}${ownFlight ? stageKey(ownFlight) : ""}</header>`,
    ...(note ? [`<p class="spec-note${spec.held ? " error" : ""}">${escape(note)}</p>`] : []),
    ...(rows.length ? ['<ul class="issues">', ...rows, "</ul>"] : []),
    "</div>",
  ].join("\n");
}

/** An In-flight issue of a Spec, read-only: its row to act on is In flight, and hovering lights its track. */
function memberRow(row: InFlightRow, repo: string) {
  const { dispatch: d, pr } = row;
  return `<li class="member" data-issue="${escape(d.issue)}">${issueLink(repoKey(d.issue, repo), d.title, d.url)}${stageKey(row)}${pr ? prLink(pr) : ""}</li>`;
}

/** An issue's key within the section of `repo`: `#N` for one of its GitHub issues; another repo's and a Linear key in full. */
function repoKey(issue: string, repo: string) {
  const hash = issue.lastIndexOf("#");
  return hash > 0 && sameSlug(issue.slice(0, hash), repo) ? issue.slice(hash) : issue;
}

function prLink(pr: PullRequest) {
  return `<a class="pr" href="${escape(pr.url)}">PR #${pr.number}</a>`;
}

/** A Stage as its track's legend key. */
function stageKey({ dispatch: d, stage }: InFlightRow) {
  const failed = d.failure ?? d.reviewer?.failure;
  return `<span class="stage ${failed ? "failed" : stage.toLowerCase().replace(/[^a-z]+/g, "-")}">${escape(stage)}</span>`;
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
 * used with the model, or the model's first. A Ready issue's form also offers
 * origin's branches as the Base, starting on `base.selected`.
 */
function launchForm(
  action: Action,
  issue: string,
  choices: Choices,
  chosen: Chosen = {},
  stack: StackOption[] = [],
  base?: BaseChoice,
) {
  const fields = launchFields(action, issue, choices, chosen, stack, rerender(action), base);
  if (!fields) return NO_HARNESS;
  return [`<form method="post" action="/${action}" class="dispatch">`, ...fields, `<button>${BUTTONS[action]}</button>`, "</form>"].join("\n");
}

const NO_HARNESS = '<p class="empty">No Harness has models to launch with.</p>';

interface Chosen {
  harness?: string;
  model?: string;
  effort?: string;
  stackOn?: string;
  base?: string;
  /** The Repo of a Linear issue's dispatch. */
  repo?: string;
}

/** A launch form's fields, `rerenderAttributes` on the Harness and model; null when no Harness has models. */
function launchFields(
  action: Action,
  issue: string,
  { catalogs, remembered }: Choices,
  chosen: Chosen,
  stack: StackOption[],
  rerenderAttributes: string,
  base?: BaseChoice,
) {
  const offered = catalogs.filter((c) => c.models.length > 0);
  const { harness: wanted = remembered.last?.harness, model: wantedModel = remembered.last?.model } = chosen;
  const catalog = offered.find((c) => c.harness.name === wanted) ?? offered[0];
  if (!catalog) return null;
  const model = catalog.models.find((m) => m.model === wantedModel) ?? catalog.models[0]!;
  const valid = (effort: string | undefined) => (effort && model.efforts.includes(effort) ? effort : undefined);
  const effort =
    valid(chosen.effort) ?? valid(remembered.efforts[`${catalog.harness.name} ${model.model}`]) ?? model.efforts[0];
  const select = (name: string, options: string[], selected: string | undefined, attributes = "") =>
    `<select name="${name}"${attributes}>${options
      .map((o) => `<option${o === selected ? " selected" : ""}>${escape(o)}</option>`)
      .join("")}</select>`;
  return [
    `<input type="hidden" name="issue" value="${escape(issue)}">`,
    ...(chosen.repo ? [`<input type="hidden" name="repo" value="${escape(chosen.repo)}">`] : []),
    ...(stack.length ? [stackSelect(stack, chosen.stackOn)] : []),
    ...(base ? [`<label>Base ${select("base", base.branches, base.selected)}</label>`] : []),
    select("harness", offered.map((c) => c.harness.name), catalog.harness.name, ` ${rerenderAttributes}`),
    select("model", catalog.models.map((m) => m.model), model.model, ` ${rerenderAttributes}`),
    select("effort", model.efforts, effort),
  ];
}

function stackSelect(options: StackOption[], chosen?: string) {
  return `<label>Stack on <select name="stackOn">${options.map((o, i) => {
    const value = stackChoice(o, options);
    const selected = chosen ? chosen === value : i === 0;
    return `<option value="${escape(value)}"${selected ? " selected" : ""}>${escape(o.blocker)} · PR #${o.pr.number} · base ${escape(o.pr.headBranch)}</option>`;
  }).join("")}</select></label>`;
}

/** Retry re-posts the failed launch's own request, which resumes it from its failed step (ADR-0006). */
function retryForm(action: Action, issue: string, { harness, model, effort }: Launch, stackOn?: string) {
  const hidden = Object.entries({ issue, harness, model, effort, ...(stackOn && { stackOn }) }).map(
    ([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`,
  );
  return [`<form method="post" action="/${action}" class="dispatch">`, ...hidden, "<button>Retry</button>", "</form>"].join("\n");
}

/** A Board row's checkbox, belonging to the action bar's form wherever it sits. */
function pick(issue: string, preserve = false) {
  const id = preserve ? ` id="pick-${escape(issue.replace(/[^\w-]/g, "-"))}" hx-preserve="true"` : "";
  return `<input type="checkbox" class="pick" name="issue" value="${escape(issue)}" form="batch" autocomplete="off"${id} aria-label="Select ${escape(issue)}"> `;
}

type Counts = Record<Action | "close", number>;

/**
 * Dispatch, Review and Close for the ticked issues, each with how many it
 * applies to. Ticking re-renders it with fresh counts.
 */
function actionBar(counts: Counts) {
  const button = (action: keyof Counts, label: string, attributes = "") =>
    `<button name="action" value="${action}"${attributes}${counts[action] ? "" : " disabled"}>${label} ${counts[action]}</button>`;
  return [
    `<div class="actions" hx-get="/action-bar" hx-trigger="change[target.classList.contains('pick')] from:body" hx-include=".pick:checked" hx-swap="outerHTML">`,
    '<form id="batch" method="get" action="/batch-form">',
    button("dispatch", "Dispatch"),
    button("review", "Review"),
    button("close", "Close", ' formmethod="post" formaction="/close"'),
    "</form>",
    "</div>",
  ].join("\n");
}

/**
 * The action bar for the ticked issues: Dispatch applies to the ones not In
 * flight (the Board ticks only Ready and Stackable ones besides), Review to
 * In-flight ones with a PR, Close to In-flight ones.
 */
async function getActionBar(ctx: ServerContext, params: URLSearchParams) {
  const counts: Counts = { dispatch: 0, review: 0, close: 0 };
  for (const issue of unique(params.getAll("issue"))) {
    const record = findDispatch(ctx.configDir, issue);
    if (!record) {
      counts.dispatch++;
      continue;
    }
    counts.close++;
    if (await canReview(ctx, record)) counts.review++;
  }
  return new Response(actionBar(counts), { headers: HTML_HEADERS });
}

/** Whether the Board offers Launch review for an In-flight issue (see `canLaunchReview`); a failed PR lookup counts as no PR. */
async function canReview(ctx: ServerContext, record: Dispatch) {
  if (record.reviewer || record.failure || !record.workspace) return false;
  return (await ctx.prs(record).catch(() => null)) !== null;
}

/**
 * Why `issue` doesn't fit `action`, or when it does the Blockers it could
 * stack on, else the Base choice starting on `base` (as the single-issue form).
 */
async function fitFor(ctx: ServerContext, action: Action, issue: string, base?: string): Promise<{ skip: string } | { stack: StackOption[]; base?: BaseChoice }> {
  let ref;
  try {
    ref = resolveIssue(ctx.configDir, issue);
  } catch (e) {
    if (!(e instanceof DispatchError)) throw e;
    return { skip: e.message };
  }
  const record = findDispatch(ctx.configDir, ref.key);
  if (action === "review") {
    if (!record) return { skip: `${ref.key} is not In flight` };
    if (record.reviewer) return { skip: `${ref.key} already has a Reviewer` };
    if (record.failure) return { skip: `${ref.key} is Failed at ${record.failure.step}` };
    if (!(await canReview(ctx, record))) return { skip: `no PR is linked to ${ref.key} yet` };
    return { stack: [] };
  }
  if (record) return { skip: `${ref.key} is already In flight` };
  if (!ref.repo) return { skip: `${ref.key} is a Linear issue; dispatch it from its row, which names its Repo` };
  const found = await ctx.world.githubIssue(ref.repo.slug, ref.number);
  const stack = found ? await stackOptions(githubSource(ctx.world, ref.repo.slug), found) : [];
  // A Stacked dispatch has no Base choice.
  if (stack.length) return { stack };
  return { stack, base: await baseChoice(ctx.world, ref.repo, base || rememberedLaunches(ctx.configDir).bases[ref.repo.slug]) };
}

/** One form with a row per ticked issue that fits the action, each filled in like its own launch form. */
async function getBatchForm(ctx: ServerContext, params: URLSearchParams) {
  const action = batchAction(params.get("action"));
  const choices = await choicesFor(ctx, true);
  const rows: string[] = [];
  const skipped: string[] = [];
  for (const issue of unique(params.getAll("issue"))) {
    const fit = await fitFor(ctx, action, issue);
    if ("skip" in fit) skipped.push(`<li>${escape(issue)}: skipped, ${escape(fit.skip)}</li>`);
    else rows.push(batchRow(action, issue, choices, {}, fit));
  }
  const noHarness = rows.length > 0 && !choices.catalogs.some((c) => c.models.length > 0);
  const form = rows.length && !noHarness
    ? [`<form method="post" action="/batch/${action}" class="batch">`, ...rows, `<button>${BUTTONS[action]} ${rows.length}</button>`, "</form>"]
    : [noHarness ? NO_HARNESS : '<p class="empty">None of the ticked issues fit.</p>'];
  const body = [...form, ...(skipped.length ? ['<ul class="skipped">', ...skipped, "</ul>"] : []), '<p><a href="/">Back to the Board</a></p>'];
  return new Response(page(`${BUTTONS[action]} ${plural(rows.length, "issue")}`, body.join("\n")), { headers: HTML_HEADERS });
}

/** One row of the batch form again, after its Harness or model changed. */
async function getBatchRow(ctx: ServerContext, params: URLSearchParams) {
  const action = batchAction(params.get("action"));
  const param = (name: string) => params.get(name) ?? "";
  const fit = await fitFor(ctx, action, param("issue"), param("base"));
  const chosen = { harness: param("harness"), model: param("model"), effort: param("effort"), stackOn: param("stackOn") };
  return new Response(batchRow(action, param("issue"), await choicesFor(ctx, true), chosen, "skip" in fit ? { stack: [] } : fit), { headers: HTML_HEADERS });
}

/** A dispatch row always posts a `stackOn` and a `base`, so the rows' fields line up by position. */
function batchRow(action: Action, issue: string, choices: Choices, chosen: Chosen, { stack, base }: { stack: StackOption[]; base?: BaseChoice }) {
  const rerenderRow = `hx-get="/batch-row" hx-vals='{"action":"${action}"}' hx-include="closest fieldset" hx-target="closest fieldset" hx-swap="outerHTML"`;
  const fields = launchFields(action, issue, choices, chosen, stack, rerenderRow, base) ?? [NO_HARNESS];
  const blank = (name: string) => `<input type="hidden" name="${name}" value="">`;
  const padding = action === "dispatch" ? [...(stack.length ? [] : [blank("stackOn")]), ...(base ? [] : [blank("base")])] : [];
  return ['<fieldset class="row">', `<legend>${escape(issue)}</legend>`, ...fields, ...padding, "</fieldset>"].join("\n");
}

function batchAction(action: string | null): Action {
  if (action === "dispatch" || action === "review") return action;
  throw new WebFailure("Bad request", `\`${action ?? ""}\` is not an action with a launch form`, ["Tick issues on the Board and use Dispatch or Review"], 400);
}

/** Launch every row of a batch form, each on its own, and report each issue. */
async function postBatch(ctx: WebContext, request: Request, action: Action) {
  const form = await request.formData();
  const column = (name: string) => form.getAll(name).map(String);
  const [issues, harnesses, models, efforts, stackOns, bases] = ["issue", "harness", "model", "effort", "stackOn", "base"].map(column) as string[][] as [string[], string[], string[], string[], string[], string[]];
  const rows = issues.map((issue, i) => ({ issue, harness: harnesses[i] ?? "", model: models[i] ?? "", effort: efforts[i] ?? "", stackOn: stackOns[i] ?? "", base: bases[i] ?? "" }));
  const byIssue = new Map(rows.map((r) => [r.issue, r]));
  const outcomes = await eachIssue([...byIssue.keys()], (issue) => {
    const { stackOn, base, ...request } = byIssue.get(issue)!;
    return action === "dispatch"
      ? dispatch(ctx.world, ctx.configDir, { ...request, ...(stackOn && { stackOn }), ...(base && { base }) })
      : review(ctx.world, ctx.configDir, request);
  });
  const body = [renderOutcomes(outcomes, (r) => ({
    new: action === "dispatch" ? "dispatched" : "reviewing",
    existing: action === "dispatch" ? "already In flight (no-op)" : "already launched (no-op)",
    resumed: `resumed from ${r.resumedFrom}`,
  })[r.outcome]), '<p><a href="/">Back to the Board</a></p>'].join("\n");
  return new Response(page(`${BUTTONS[action]} results`, body), { headers: HTML_HEADERS });
}

/** A list with how each issue of a batch went. */
function renderOutcomes<T>(outcomes: IssueOutcome<T>[], done: (value: T) => string) {
  const item = (o: IssueOutcome<T>) =>
    o.outcome === "done"
      ? `<li>${escape(o.issue)}: ${escape(done(o.value))}</li>`
      : `<li>${escape(o.issue)}: <span class="error">${o.outcome}, ${escape(o.error.message)}</span></li>`;
  return ["<ul>", ...outcomes.map(item), "</ul>"].join("\n");
}

function unique(items: string[]) {
  return [...new Set(items)];
}

function page(title: string, main: string, tools = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · nico-agent</title>
<script src="/htmx.min.js"></script>
<style>${STYLE}</style>
</head>
<body>
<header class="top">
<a class="brand" href="/">${GLYPH}nico-agent</a>
<h1>${escape(title)}</h1>
${tools}
</header>
<main>
${main}
</main>
<script>${LINK_TRACKS}</script>
</body>
</html>
`;
}

/** The brand: a detector seen end-on, one track leaving the vertex. */
const GLYPH = '<svg class="glyph" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="4.5"/><circle r="8"/><circle r="11"/><path class="trail" d="M0 0 Q4 -1 8.5 -7"/></svg>';

/** Hovering a track lights its row and the reverse; clicking a track brings its row into view. */
const LINK_TRACKS = `
let lit = null;
const rowOf = (issue) => [...document.querySelectorAll("li.flight .pick")].find((p) => p.value === issue)?.closest("li.flight");
const light = (issue) => {
  if (issue === lit) return;
  lit = issue;
  for (const el of document.querySelectorAll(".lit")) el.classList.remove("lit");
  if (!issue) return;
  for (const t of document.querySelectorAll("g.track, li.member")) if (t.dataset.issue === issue) t.classList.add("lit");
  rowOf(issue)?.classList.add("lit");
};
document.addEventListener("mouseover", (e) => {
  const at = e.target.closest?.("g.track, li.flight, li.member");
  light(at ? (at.dataset.issue ?? at.querySelector(".pick")?.value ?? null) : null);
});
// A poll replaces rows and tracks: light the hovered issue again, and draw out any track whose Stage moved.
let reaches = new Map();
const reachesNow = () => new Map([...document.querySelectorAll("g.track")].map((t) => [t.dataset.issue, t.classList[1]]));
document.addEventListener("htmx:oobBeforeSwap", () => { reaches = reachesNow(); });
document.addEventListener("htmx:afterSettle", () => {
  const was = lit;
  lit = null;
  light(was);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const [issue, reach] of reachesNow()) {
    if (!reaches.has(issue) || reaches.get(issue) === reach || reach === "unknown") continue;
    const path = [...document.querySelectorAll("g.track")].find((t) => t.dataset.issue === issue)?.querySelector("path");
    path?.animate([{ strokeDasharray: "1 1", strokeDashoffset: 1 }, { strokeDasharray: "1 1", strokeDashoffset: 0 }], { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }
  reaches = new Map();
});
document.addEventListener("click", (e) => {
  const track = e.target.closest?.("g.track");
  const row = track && rowOf(track.dataset.issue);
  if (!row) return;
  row.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  row.querySelector(".pick")?.focus({ preventScroll: true });
});
`;

const STYLE = `
:root {
  color-scheme: light;
  --ground: #f3f5f8; --panel: #ffffff; --panel-2: #eef1f5; --rule: #dce1e8; --rule-strong: #c2c9d3;
  --geometry: #c5ccd6; --geometry-2: #e4e8ee;
  --ink: #11151b; --ink-2: #566170; --link: #1d5bb8;
  --implementing: #c06a00; --implementing-ink: #8f4f00;
  --pr-ready: #10874a; --pr-ready-ink: #0b6b3a;
  --review: #1c6dd0; --review-ink: #1756a6;
  --failed: #d1262b; --failed-ink: #b01e22;
  --blocked: #b5129a; --blocked-ink: #ffffff;
  --unknown: #8a94a2;
  --fire: #f2a516; --fire-hover: #ffb52e; --fire-ink: #211400;
  --shadow: 0 1px 2px rgb(17 21 27 / 0.06), 0 4px 14px -6px rgb(17 21 27 / 0.08);
  --display: #0a0d12;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ground: #06080b; --panel: #0b0f14; --panel-2: #11161d; --rule: #19202a; --rule-strong: #283240;
    --geometry: #273140; --geometry-2: #141a22;
    --ink: #e3e7ed; --ink-2: #8d97a6; --link: #84b6ff;
    --implementing: #f5a524; --implementing-ink: #f5a524;
    --pr-ready: #3bd47b; --pr-ready-ink: #3bd47b;
    --review: #52b5ff; --review-ink: #52b5ff;
    --failed: #ff5757; --failed-ink: #ff6b6b;
    --blocked: #ff4fd6; --blocked-ink: #1a0015;
    --unknown: #6b7584;
    --shadow: none;
    --frame: var(--rule-strong);
  }
}
* { box-sizing: border-box; }
html { background: var(--ground); scrollbar-color: var(--rule-strong) var(--ground); }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--ground); caret-color: var(--implementing); font-variant-numeric: tabular-nums; }
::selection { background: color-mix(in srgb, var(--implementing) 30%, transparent); }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel-2); padding: 0.1em 0.35em; border-radius: 3px; }

header.top { display: flex; align-items: center; gap: 0.75rem; max-width: 76rem; margin: 0 auto; padding: 1.1rem 1.5rem 0.9rem; }
.brand { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 18px; font-weight: 700; color: var(--ink); letter-spacing: -0.015em; }
.brand:hover { text-decoration: none; }
.glyph { width: 22px; height: 22px; fill: none; stroke: var(--rule-strong); stroke-width: 1.4; }
.glyph .trail { stroke: var(--implementing); stroke-width: 2; stroke-linecap: round; }
header.top h1 { margin: 0; font-size: 18px; font-weight: 500; color: var(--ink-2); }
header.top h1::before { content: "/"; margin-right: 0.75rem; color: var(--rule-strong); }
header.top .refresh { margin-left: auto; }
main { max-width: 76rem; margin: 0 auto; padding: 0 1.5rem 3rem; }

button, select { font: inherit; font-size: 13px; color: var(--ink); background: var(--panel); border: 1px solid var(--rule-strong); border-radius: 4px; height: 28px; padding: 0 0.6rem; transition: border-color 120ms, background-color 120ms, color 120ms; }
select { padding: 0 0.3rem; max-width: 9.5rem; text-overflow: ellipsis; }
:is(form.dispatch, fieldset.row) select[name="base"] { width: 9.5rem; }
:is(form.dispatch, fieldset.row) select[name="harness"] { width: 6.5rem; }
:is(form.dispatch, fieldset.row) select[name="model"] { width: 7.5rem; }
:is(form.dispatch, fieldset.row) select[name="effort"] { width: 6rem; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; cursor: pointer; background: var(--panel-2); font-weight: 500; white-space: nowrap; }
button:hover:not(:disabled) { border-color: var(--ink-2); }
button:disabled { opacity: 0.6; cursor: default; }
:is(button, select, input, a):focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
form.dispatch > button:last-child, form.batch > button:last-child { background: var(--fire); border-color: var(--fire); color: var(--fire-ink); font-weight: 600; }
form.dispatch > button:last-child:hover, form.batch > button:last-child:hover { background: var(--fire-hover); border-color: var(--fire-hover); }
form[action="/review"] > button:last-child { background: var(--panel-2); border-color: var(--review); color: var(--review-ink); }
form[action="/review"] > button:last-child:hover { background: color-mix(in srgb, var(--review) 14%, var(--panel)); border-color: var(--review); }
form[action="/close"] button { color: var(--ink-2); }
form[action="/close"] button:hover { color: var(--failed-ink); border-color: var(--failed); }
label { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--ink-2); font-size: 12px; }
input[type="checkbox"] { width: 15px; height: 15px; margin: 0; accent-color: var(--implementing); cursor: pointer; flex: none; }

.empty { color: var(--ink-2); margin: 0; padding: 0.9rem 1rem; }
.error { color: var(--failed-ink); }
.warning { color: var(--implementing-ink); }
p.error, p.warning { margin: 0.25rem 0; }

/* The event display: a detector seen end-on, with a track per In-flight Dispatch. */
figure.event { border: 1px solid var(--frame, transparent); display: grid; grid-template-columns: minmax(0, 460px) minmax(0, 1fr); align-items: center; gap: 2.5rem; margin: 0 0 1rem; padding: 1.5rem 2rem 1.5rem 1.5rem; background: var(--display); border-radius: 6px; color: #dfe4eb; box-shadow: var(--shadow);
  --geometry: #303b4a; --geometry-2: #1a222d;
  --implementing: #f5a524; --pr-ready: #3bd47b; --review: #52b5ff; --failed: #ff5757; --blocked: #ff4fd6; --unknown: #6b7584; }
figure.event svg { display: block; width: 100%; height: auto; overflow: hidden; font: 600 10px system-ui, sans-serif; }
.geometry circle { stroke: var(--geometry); stroke-width: 0.7; }
.geometry .ecal, .geometry .hcal, .geometry .muon { stroke: var(--geometry-2); }
.geometry .ecal { stroke: color-mix(in srgb, var(--pr-ready) 34%, var(--geometry)); }
.geometry .hcal { stroke: color-mix(in srgb, var(--review) 28%, var(--geometry)); }
.geometry .muon { stroke: #3a4655; }
.key text { font-size: 7.5px; font-weight: 500; fill: #7d8796; paint-order: stroke; stroke: var(--display); stroke-width: 2.5px; stroke-linejoin: round; }
.vertex { fill: #f4f6f9; }
.track { --c: var(--unknown); color: var(--c); cursor: pointer; transition: opacity 160ms; }
.track.implementing { --c: var(--implementing); }
.track.pr-ready { --c: var(--pr-ready); }
.track.review-launched { --c: var(--review); }
.track.failed { --c: var(--failed); }
.track path { fill: none; stroke: var(--c); stroke-width: 1.8; stroke-linecap: round; }
.track.unknown path { stroke-dasharray: 0.03 0.03; }
.track .tip { fill: var(--c); }
.track .deposit { stroke: var(--pr-ready); stroke-width: 7; stroke-linecap: butt; }
.track .hit { stroke: var(--review); stroke-width: 5; }
.track .burst line { stroke: var(--failed); stroke-width: 1.6; stroke-linecap: round; }
.track .attention { fill: none; stroke: var(--blocked); stroke-width: 1.5; }
.track text { fill: var(--c); paint-order: stroke; stroke: var(--display); stroke-width: 3px; stroke-linejoin: round; }
.track.waiting text { fill: var(--blocked); }
svg:has(.track.lit) .track:not(.lit) { opacity: 0.22; }
.track.lit path { stroke-width: 2.4; }

figure.event figcaption { display: grid; gap: 1rem; align-content: center; min-width: 0; max-width: 30rem; }
figure.event .lede { margin: 0; max-width: 34ch; font-size: 15px; line-height: 1.4; color: #f2f4f7; }
figure.event dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.15rem 2rem; margin: 0; }
figure.event dl.agents { padding-top: 0.6rem; border-top: 1px solid #222b37; }
figure.event dl.agents > div { border-bottom: none; }
figure.event dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; padding: 0.35rem 0; border-bottom: 1px solid #1a212b; }
figure.event dt { display: inline-flex; align-items: center; gap: 0.55rem; font-size: 13px; color: #b9c1cc; }
figure.event dd { margin: 0; font-size: 18px; font-weight: 600; color: #f2f4f7; }
figure.event dt i { width: 16px; height: 2px; border-radius: 1px; background: var(--c); }
figure.event dl > div { --c: var(--unknown); }
figure.event .implementing { --c: var(--implementing); }
figure.event .pr-ready { --c: var(--pr-ready); }
figure.event .review-launched { --c: var(--review); }
figure.event .failed { --c: var(--failed); }
figure.event .blocked { --c: var(--blocked); }
figure.event .blocked dt i { width: 9px; height: 9px; border-radius: 50%; background: none; border: 1.5px solid var(--c); }
figure.event .blocked:not(.none) :is(dt, dd) { color: var(--blocked); }
figure.event .none :is(dt, dd) { color: #5d6776; }
figure.event .sampled { margin: 0; font-size: 12px; color: #7d8796; }

.actions { position: sticky; top: 0; z-index: 2; background: var(--ground); padding: 0.5rem 0 0.75rem; }
.actions form { display: flex; align-items: center; gap: 0.4rem; }
.actions form::before { content: "With selected"; color: var(--ink-2); font-size: 12px; margin-right: 0.25rem; }

section.repo, section.in-flight { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; margin-bottom: 1rem; box-shadow: var(--shadow); overflow: hidden; }
section > header { display: flex; align-items: center; gap: 0.6rem; padding: 0.65rem 1rem; border-bottom: 1px solid var(--rule); background: var(--panel-2); }
section h2 { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: -0.005em; }
.count { font-size: 12px; font-weight: 600; color: var(--ink-2); min-width: 1.5rem; text-align: center; border: 1px solid var(--rule-strong); border-radius: 3px; padding: 0 0.35rem; line-height: 18px; }
section h3 { margin: 0; padding: 0.85rem 1rem 0.35rem; font-size: 12px; font-weight: 650; color: var(--ink-2); border-top: 1px solid var(--rule); }
section > p.error { padding: 0.6rem 1rem; margin: 0; }
section ul { list-style: none; margin: 0; padding: 0; }
section li { border-top: 1px solid var(--rule); transition: background-color 120ms; }
section li:first-child { border-top: none; }
section li:hover, section li.lit { background: var(--panel-2); }

/* A Repo's Specs as the Scheduler sees them: one slot per Spec that may run, filled while one does. */
.room { display: flex; align-items: center; gap: 0.9rem; margin-left: auto; font-size: 12px; color: var(--ink-2); white-space: nowrap; }
.room b { font-weight: 650; color: var(--ink); margin-left: 0.2rem; }
.slots { display: inline-flex; gap: 3px; }
.slots i, .spec-state::before { width: 10px; height: 6px; border-radius: 1px; border: 1px solid var(--ink-2); }
.slots i.taken { background: var(--ink-2); }
.spec { --indent: calc(1rem + 6.5rem + 0.75rem); border-top: 1px solid var(--rule); }
section > header + .spec { border-top: none; }
.spec > header { display: flex; align-items: center; gap: 0.75rem; padding: 0.7rem 1rem 0.15rem; min-width: 0; }
.spec > header a.title, .spec > header span.title { flex: 0 1 auto; font-weight: 600; }
.spec-state { display: inline-flex; align-items: center; gap: 0.45rem; flex: none; width: 6.5rem; font-size: 12px; font-weight: 650; color: var(--ink-2); }
.spec-state::before { content: ""; box-sizing: border-box; }
.spec.running .spec-state { color: var(--ink); }
.spec.running .spec-state::before { background: var(--ink); border-color: var(--ink); }
.spec.held .spec-state { color: var(--failed-ink); }
.spec.held .spec-state::before { border-color: var(--failed); border-style: dashed; }
.spec.waiting .spec-state::before, .spec.not-startable .spec-state::before { border-style: dashed; border-color: var(--rule-strong); }
.spec-note { margin: 0; padding: 0 1rem 0.55rem var(--indent); font-size: 12px; color: var(--ink-2); }
.spec-note.error { color: var(--failed-ink); }
/* A Spec's issues hang from its heading, in sub-issue order. */
.spec ul.issues { margin: 0 0 0.35rem calc(var(--indent) - 1rem); border-left: 1px solid var(--rule); }
.spec ul.issues li { border-top: none; }
li.member { display: flex; align-items: center; gap: 0.75rem; padding: 0.45rem 1rem; min-height: 44px; }
li.member a.title { flex: 0 1 auto; color: var(--ink-2); }
ul.issues li { display: flex; align-items: center; gap: 0.75rem; padding: 0.45rem 1rem; min-height: 44px; }
a.title { flex: 1; min-width: 0; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a.title:hover { color: var(--link); text-decoration: none; }
.num { color: var(--ink-2); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; margin-right: 0.3rem; }
form.dispatch { display: flex; align-items: center; gap: 0.35rem; margin: 0; flex: none; }
li:not(:hover) form.dispatch select:not(:focus) { border-color: var(--rule); }

ul.flights li { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "head actions" "meta actions" "notes notes"; column-gap: 1rem; row-gap: 0.3rem; padding: 0.7rem 1rem; }
ul.flights li.lit::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 1px; background: var(--ink-2); }
.flight .head { grid-area: head; display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.flight .meta { grid-area: meta; display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; padding-left: calc(15px + 0.6rem); }
.flight .notes { grid-area: notes; padding-left: calc(15px + 0.6rem); }
.flight .row-actions { grid-area: actions; display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end; }
.flight .row-actions form { display: flex; gap: 0.35rem; margin: 0; }
.flight a.title { flex: 0 1 auto; font-weight: 500; }
a.pr { font-size: 12px; font-weight: 600; white-space: nowrap; }

.chip { display: inline-flex; align-items: center; gap: 0.3rem; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-2); background: var(--panel-2); border: 1px solid var(--rule); border-radius: 3px; padding: 0 0.4rem; line-height: 20px; white-space: nowrap; }
.chip .icon { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; flex: none; }
/* A Stage reads as its track's legend key. */
.stage { --c: var(--unknown); display: inline-flex; align-items: center; gap: 0.45rem; font-size: 12px; font-weight: 650; white-space: nowrap; color: var(--c-ink, var(--ink-2)); }
.stage::before { content: ""; width: 14px; height: 2px; border-radius: 1px; background: var(--c); }
.stage.implementing { --c: var(--implementing); --c-ink: var(--implementing-ink); }
.stage.pr-ready { --c: var(--pr-ready); --c-ink: var(--pr-ready-ink); }
.stage.review-launched { --c: var(--review); --c-ink: var(--review-ink); }
.stage.failed { --c: var(--failed); --c-ink: var(--failed-ink); }
.agent { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 12px; color: var(--ink-2); padding: 0 0.3rem; line-height: 20px; }
.agent i { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--rule-strong); }
.agent.working i { border-color: var(--ink); background: var(--ink); }
.agent.idle i { border-color: var(--ink-2); }
.agent.done i { border-color: var(--pr-ready); background: var(--pr-ready); }
.agent.unknown i { border-style: dashed; }
.agent.blocked { color: var(--blocked-ink); background: var(--blocked); border-radius: 3px; padding: 0 0.45rem; font-weight: 650; }
.agent.blocked i { border-color: var(--blocked-ink); background: var(--blocked-ink); }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }

main > ul { list-style: none; padding: 0; margin: 0 0 1rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; }
main > ul li { padding: 0.55rem 1rem; border-top: 1px solid var(--rule); }
main > ul li:first-child { border-top: none; }
main > p { margin: 0 0 0.75rem; }
form.batch { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; margin-bottom: 1rem; }
fieldset.row { display: flex; align-items: center; gap: 0.5rem; width: 100%; margin: 0; padding: 0.6rem 1rem; background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; }
fieldset.row legend { float: left; margin-right: auto; font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 0; }
@media (max-width: 760px) {
  header.top, main { padding-left: 1rem; padding-right: 1rem; }
  figure.event { grid-template-columns: 1fr; gap: 1rem; padding: 1rem; }
  figure.event svg { max-width: 300px; margin: 0 auto; }
  figure.event .key { display: none; }
  figure.event dl { gap: 0 1.25rem; }
  figure.event .lede { font-size: 14px; }
  ul.issues li { flex-wrap: wrap; }
  section.repo > header { flex-wrap: wrap; }
  .room { margin-left: 0; flex-basis: 100%; }
  .spec > header { flex-wrap: wrap; row-gap: 0.15rem; }
  .spec-state { width: auto; flex-basis: 100%; }
  .spec-note { padding-left: 1rem; }
  .spec ul.issues { margin-left: 1rem; }
  ul.issues a.title { flex-basis: calc(100% - 2rem); }
  ul.flights li { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "meta" "notes" "actions"; }
  .flight .head { flex-wrap: wrap; row-gap: 0.25rem; }
  .flight .head a.title { flex: 1 1 calc(100% - 15px - 0.6rem); white-space: normal; }
  .flight .head :is(.stage, a.pr) { margin-left: calc(15px + 0.6rem); }
  .flight .head .stage + a.pr { margin-left: 0; }
  .flight .row-actions { justify-content: flex-start; flex-wrap: wrap; padding-left: calc(15px + 0.6rem); }
  form.dispatch { flex: 1 1 100%; flex-wrap: wrap; }
  form.dispatch select, :is(form.dispatch, fieldset.row) select[name] { flex: 1 1 6rem; width: auto; max-width: none; }
  form.dispatch label { flex: 1 1 100%; }
  form.dispatch label select { flex: 1; }
  fieldset.row { flex-wrap: wrap; }
}
`;

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}
