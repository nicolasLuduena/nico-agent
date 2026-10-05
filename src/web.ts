import htmx from "htmx.org/dist/htmx.min.js" with { type: "text" };
import { type BaseChoice, type Board, type StackOption, baseChoice, loadBoard, stackChoice, stackOptions } from "./board";
import { type Repo, ConfigError, loadConfig } from "./config";
import { type IssueOutcome, CloseConfirmationRequired, DispatchError, StepFailed, baseBranch, closeDispatch, dispatch, eachIssue, review, resolveIssue } from "./dispatch";
import { type Catalog, type Remembered, harnessCatalogs, refreshHarnesses, rememberedLaunches } from "./harness";
import { type InFlightRow, type PrLookup, cachedPrs, loadInFlight } from "./stage";
import { type Dispatch, type Launch, findDispatch, loadDispatches } from "./state";
import { plural } from "./output";
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
  const chosen = { harness: param("harness"), model: param("model"), effort: param("effort"), stackOn: param("stackOn") };
  let options: StackOption[] = [];
  let base: BaseChoice | undefined;
  if (action === "dispatch") {
    const ref = resolveIssue(ctx.configDir, param("issue"));
    const issue = await ctx.world.githubIssue(ref.repo.slug, ref.number);
    if (issue) options = await stackOptions(ctx.world, ref.repo.slug, issue);
    // A Stacked dispatch has no Base choice.
    if (!options.length) base = await baseChoice(ctx.world, ref.repo, param("base") || choices.remembered.bases[ref.repo.slug]);
  }
  return new Response(launchForm(action, param("issue"), choices, chosen, options, base), { headers: HTML_HEADERS });
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
  return [...refresh, ...warnings, actionBar({ dispatch: 0, review: 0, close: 0 }), ...sections, renderInFlight(board.inFlight, choices)].join("\n");
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
    // Preserved across polls, so a ticked row stays ticked.
    `${pick(d.issue, true)}<a href="${escape(d.url)}">${escape(d.issue)} ${escape(d.title)}</a>`,
    escape(`${harness} ${model} ${effort}`),
    ...(d.base ? [`base ${escape(baseBranch(d)!)}`] : []),
    ...(d.workspace ? [`workspace ${escape(d.workspace)}`] : []),
    failure ? `<span class="error">${escape(`${stage}: ${failure.error}`)}</span>` : escape(stage),
    ...(pr ? [`<a href="${escape(pr.url)}">PR #${pr.number}</a>`] : []),
    `implementer ${agentState(row.implementerState)}`,
    ...(row.reviewerState ? [`reviewer ${agentState(row.reviewerState)}`] : []),
  ];
  const notes = [...(d.warnings ?? []), ...(prError ? [`could not look up the PR: ${prError}`] : [])];
  const extra = notes.map((w) => `<p class="warning">${escape(w)}</p>`);
  extra.push(closeForm([d.issue]));
  if (d.failure) extra.push(retryForm("dispatch", d.issue, d.implementer, d.stackedOn?.pr.url));
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
  const errors = board.errors.filter((e) => e.repo === repo.slug);
  const errorHtml = errors.map((e) => `<p class="error">Could not load: ${e.source ? `${e.source}: ` : ""}${escape(e.error)}</p>`).join("\n");
  const issues = board.ready.filter((i) => i.repo === repo.slug);
  const ready = issues.length === 0 ? (errorHtml || '<p class="empty">No Ready issues.</p>') : [
    ...(errorHtml ? [errorHtml] : []),
    "<ul>",
    ...issues.map(
      (i) => i.identifier
        ? `<li><a href="${escape(i.url)}">${i.identifier} ${escape(i.title)}</a>${i.base ? ` · base ${escape(i.base)}` : ""}</li>`
        : `<li>${pick(`${i.repo}#${i.number}`)}<a href="${escape(i.url)}">#${i.number} ${escape(i.title)}</a>\n${launchForm("dispatch", `${i.repo}#${i.number}`, choices, {}, [], board.bases[i.repo])}</li>`,
    ),
    "</ul>",
  ].join("\n");
  const stackable = board.stackable.filter((i) => i.repo === repo.slug);
  if (!stackable.length) return ready;
  return [ready, "<h3>Stackable</h3>", "<ul>", ...stackable.map((i) =>
    `<li>${pick(`${i.repo}#${i.number}`)}<a href="${escape(i.url)}">#${i.number} ${escape(i.title)}</a>\n${launchForm("dispatch", `${i.repo}#${i.number}`, choices, {}, i.blockers)}</li>`), "</ul>"].join("\n");
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
  const found = await ctx.world.githubIssue(ref.repo.slug, ref.number);
  const stack = found ? await stackOptions(ctx.world, ref.repo.slug, found) : [];
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
.actions { position: sticky; top: 0; background: #fff; padding: 0.5rem 0; }
.actions form { display: flex; gap: 0.25rem; }
fieldset.row { display: flex; gap: 0.25rem; align-items: center; margin-bottom: 0.5rem; }
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
