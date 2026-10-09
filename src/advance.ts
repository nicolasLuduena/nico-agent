import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { loadBoard, specLoadErrors } from "./board";
import { recordSighting } from "./stats";
import { ConfigError, SCHEDULER_DEFAULTS, type LaunchDefaults, loadConfig } from "./config";
import { type DispatchRequest, StepFailed, checkLaunch, closeDispatch, dispatch } from "./dispatch";
import { DispatchError, LaunchError } from "./dispatch-error";
import { linearIdentifier } from "./linear";
import { type Notice, PROPOSALS_SCOPE, notifyOnce } from "./notify";
import { nudgeLead } from "./nudge";
import { type Queues, dequeue, pruneBoardQueues, queueOf } from "./queue";
import { type RepoDecision, type SpecDecision, sameSpec } from "./spec";
import { type InFlightRow, freshPrs } from "./stage";
import { type Dispatch, STEPS, loadDispatches } from "./state";
import { type World, WorldError } from "./world";

/** What `advance` did with one issue of a running Spec, or why it did nothing with the Spec. */
export interface AdvanceRow {
  spec: string;
  repo: string;
  result: "started" | "resumed" | "skipped" | "failed";
  /** The issue started or resumed, or the one the Spec is busy with or waits on; empty when none. */
  issue: string;
  reason: string;
}

export interface AdvanceReport {
  /** One row per issue started or resumed, or per Spec stopped, in Board order; empty when there is nothing to do. */
  specs: AdvanceRow[];
  /** Repos whose Specs could not be loaded, so were not advanced. */
  errors: { repo: string; error: string }[];
  /** Dispatches Closed because their PR is ready. */
  closed: string[];
  /** What went wrong without stopping the run, such as a notification that could not be sent. */
  warnings: string[];
  help: string[];
}

/** One thing `advance` does with a running Spec; a Spec that only waits on its Implementers has none, so is not reported. */
export type SpecPlan =
  | { action: "start"; issue: string; stackOn?: string; base: string; reason: string }
  | { action: "resume"; dispatch: Dispatch }
  | { action: "skip"; issue: string; reason: string; help?: string };

/**
 * Keep running Specs moving and fill each Repo's room from its Queue
 * (ADR-0009): dispatch each one's next issues, each on the PR or Base the
 * Spec rules chose (ADR-0012), with the Scheduler defaults from config, one
 * Spec at a time. Idempotent like `dispatch` (ADR-0006).
 */
export async function advance(world: World, configDir: string): Promise<AdvanceReport> {
  const holder = takeAdvanceLock(world, configDir);
  if (holder !== null) {
    return { specs: [], errors: [], closed: [], warnings: [`another advance is running (pid ${holder}); left it to finish`], help: [] };
  }
  try {
    // The Lead is Nudged at the end of every run, even one that failed.
    const report = await advanceOnce(world, configDir).catch(async (e) => {
      // The run's own error is the one to report, not the Nudge's.
      await nudgeLead(world, configDir).catch(() => {});
      throw e;
    });
    report.warnings.push(...(await nudgeLead(world, configDir)));
    return report;
  } finally {
    unlinkSync(join(configDir, ADVANCE_LOCK));
  }
}

const ADVANCE_LOCK = "advance.lock";

/** How often `serve` runs `advance`: the Scheduler. */
export const ADVANCE_INTERVAL_MS = 10 * 60_000;

/**
 * One `advance` at a time across processes (`serve`, the CLI, the Board's
 * button), so two runs never start the same queued Spec. Takes the lock and
 * returns null, or returns the pid of the live process holding it. A lock
 * whose process is gone is taken over.
 */
function takeAdvanceLock(world: World, configDir: string): number | null {
  mkdirSync(configDir, { recursive: true });
  const file = join(configDir, ADVANCE_LOCK);
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(world.processId()));
      closeSync(fd);
      return null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    let pid = NaN;
    try { pid = Number(readFileSync(file, "utf8").trim()); } catch {}
    if (Number.isInteger(pid) && pid > 0 && world.processAlive(pid)) return pid;
    try { unlinkSync(file); } catch {}
  }
}

async function advanceOnce(world: World, configDir: string): Promise<AdvanceReport> {
  const launch = schedulerDefaults(configDir);
  const report: AdvanceReport = { specs: [], errors: [], closed: [], warnings: [], help: [] };
  const { repos } = loadConfig(configDir);
  if (!repos.length) return report;
  const dispatches = loadDispatches(configDir);
  const board = await loadBoard(world, repos, dispatches, freshPrs(world));
  await recordSighting(configDir, board.sighting, world.now());
  const failedRepos = specLoadErrors(board.errors);
  report.errors = failedRepos.map(({ repo, error }) => ({ repo, error }));
  const queued = fromQueues(await pruneBoardQueues(configDir, board), board.specs);
  // A Spec waiting on another Spec's merges frees its slot, but is still reported.
  const running = board.specs.flatMap((r) => r.specs).filter((s) => s.running || s.waiting.length)
    .map((spec) => ({ spec, plans: planSpec(spec, dispatches) }));
  if (running.some(({ plans }) => plans.some((p) => p.action === "start")) || queued.length) await checkDefaults(world, configDir, launch);
  const plans: { spec: SpecDecision; plan: SpecPlan }[] = [];
  /** Carry out a Spec's plans in order, stopping at a failed one, as a Failed Dispatch Holds its Spec. */
  const carry = async (spec: SpecDecision, specPlans: SpecPlan[]) => {
    const rows: AdvanceRow[] = [];
    for (const plan of specPlans) {
      plans.push({ spec, plan });
      const row = await carryOut(world, configDir, launch, spec, plan, report.help);
      if (!row) continue;
      report.specs.push(row);
      rows.push(row);
      if (row.result === "failed") break;
    }
    return rows;
  };
  for (const { spec, plans: specPlans } of running) await carry(spec, specPlans);
  for (const { room, specs } of queued) {
    let left = room;
    for (const spec of specs) {
      if (left === 0) break;
      const rows = await carry(spec, planSpec(spec, dispatches).map((plan) => fromQueue(plan, spec)));
      // A refused start stays queued and leaves its slot to the next queued Spec.
      if (rows.length && rows.every((row) => row.result === "skipped")) continue;
      left--;
      // Started, or Held by its failed start: either way no longer a candidate.
      if (rows.some((row) => row.result === "started" || row.result === "failed")) await dequeue(configDir, spec.repo, spec.spec);
    }
  }
  for (const row of board.inFlight.filter(prunable)) {
    await closeDispatch(world, configDir, row.dispatch.issue, true);
    report.closed.push(row.dispatch.issue);
  }
  // A condition this run could not see neither clears nor notifies anew; Proposals are `propose`'s to notify.
  const unobserved = [
    PROPOSALS_SCOPE,
    ...failedRepos.map((e) => repoScope(e.repo)),
    ...board.inFlight.filter((row) => row.implementerState === "unknown").map((row) => agentScope(row.dispatch.implementer.agent)),
  ];
  report.warnings = await notifyOnce(world, configDir, [
    ...notices(plans, report.specs, loadDispatches(configDir)),
    ...askingNotices(board.inFlight, board.specs),
  ], (scope) => !unobserved.includes(scope));
  return report;
}

/**
 * Each Repo's queued Specs, head first, with the room it has: room is counted
 * before the run, and each start takes one slot. Every queued Spec is a
 * candidate, as the Queues were just pruned.
 */
function fromQueues(queues: Queues, repos: RepoDecision[]): { room: number; specs: SpecDecision[] }[] {
  return repos.map((repo) => ({
    room: repo.room,
    specs: queueOf(queues, repo.repo)
      .map((name) => repo.specs.find((s) => sameSpec(s.spec, name)))
      .filter((s): s is SpecDecision => s !== undefined),
  })).filter(({ room, specs }) => room > 0 && specs.length > 0);
}

/** What a Notice's condition is observed through: its Repo's Specs, or its Implementer's Agent state. */
const repoScope = (repo: string) => `repo ${repo.toLowerCase()}`;
const agentScope = (agent: string) => `agent ${agent}`;

/** A queued Spec's start says it came from the Queue. */
function fromQueue(plan: SpecPlan, spec: SpecDecision): SpecPlan {
  return plan.action === "start" ? { ...plan, reason: `${spec.spec} is the head of the Queue; ${plan.reason}` } : plan;
}

/**
 * What needs the user after this run: each Held Spec, and each failed
 * Dispatch. A Spec Held by a Failed Dispatch is that failure, so the user
 * hears of it once, with how to resume it.
 */
function notices(plans: { spec: SpecDecision; plan: SpecPlan }[], rows: AdvanceRow[], dispatches: Dispatch[]): Notice[] {
  const failedAt = (issue: string, repo: string, fallback: string): Notice[] => {
    const { step = "dispatch", error = fallback } = dispatches.find((d) => d.issue === issue)?.failure ?? {};
    const help = [...new Set([holdHelp(issue, dispatches), showHelp(issue)])];
    return [{ key: `failed ${issue} ${step}`, scope: repoScope(repo), title: `${issue}'s Dispatch failed at ${step}`, body: [error, ...help].join("\n") }];
  };
  const held = plans.flatMap(({ spec, plan }): Notice[] => {
    if (!spec.held || plan.action !== "skip") return [];
    const { issue, reason } = spec.held;
    if (dispatches.some((d) => d.issue === issue && d.failure)) return failedAt(issue, spec.repo, reason);
    return [{ key: `held ${spec.spec} ${issue} ${reason}`, scope: repoScope(spec.repo), title: `${spec.spec} is Held`, body: [reason, plan.help].filter(Boolean).join("\n") }];
  });
  const failed = rows.filter((r) => r.result === "failed").flatMap((r) => failedAt(r.issue, r.repo, r.reason));
  return [...held, ...failed];
}

/** Each Implementer waiting on the user, as herdr reported it before this run. */
function askingNotices(inFlight: InFlightRow[], repos: RepoDecision[]): Notice[] {
  const specs = repos.flatMap((r) => r.specs);
  return inFlight.filter((row) => row.implementerState === "blocked").map(({ dispatch: { issue, implementer } }) => {
    const spec = specs.find((s) => s.issues.includes(issue))?.spec;
    const of = spec && spec !== issue ? ` (Spec ${spec})` : "";
    return {
      key: `asking ${issue}`,
      scope: agentScope(implementer.agent),
      title: `${issue} is Asking`,
      body: `The Implementer of ${issue}${of} is waiting on you.\nAnswer it in herdr (agent ${implementer.agent}), or run \`nico-agent answer ${issue} <text>\``,
    };
  });
}

/** How to see the Dispatch of `issue`, or of any issue when none is named. */
function showHelp(issue?: string) {
  return issue ? `Run \`nico-agent show ${issue}\` to see the Dispatch` : "Run `nico-agent show <issue>` to see a Dispatch";
}

/**
 * A Dispatch is done with its workspace once its PR is ready and its
 * Implementer neither works nor waits on the user; the branch and the PR
 * stay, and the Spec finds the PR by its branch (ADR-0003).
 */
function prunable(row: InFlightRow) {
  return row.stage === "PR ready" && row.implementerState !== "working" && row.implementerState !== "blocked";
}

/**
 * A running Spec resumes its unfinished Dispatches, as `dispatch` would
 * (ADR-0006), and starts its next issues; with neither, it waits on its
 * Implementers, or is skipped with each waiting issue's reason, or its own.
 */
export function planSpec(spec: SpecDecision, dispatches: Dispatch[]): SpecPlan[] {
  if (spec.held) return [{ action: "skip", issue: spec.held.issue, reason: `Held: ${spec.held.reason}`, help: holdHelp(spec.held.issue, dispatches) }];
  const plans: SpecPlan[] = [
    ...dispatches.filter((d) => spec.issues.includes(d.issue) && !isFinished(d)).map((dispatch) => ({ action: "resume" as const, dispatch })),
    ...spec.next.map(({ issue, stackOn, base, reason }) => ({ action: "start" as const, issue, base, reason, ...(stackOn && { stackOn: stackOn.url }) })),
  ];
  if (plans.length || spec.implementing.length) return plans;
  if (spec.waiting.length) return spec.waiting.map(({ issue, reason }) => ({ action: "skip", issue, reason }));
  return [{ action: "skip", issue: "", reason: spec.reason ?? "" }];
}

/** How the user clears the hold `issue` puts on its Spec: resume its Failed Dispatch with its own launch, or Close the one whose Stack is built on a PR closed without merging. */
function holdHelp(issue: string, dispatches: Dispatch[]) {
  const d = dispatches.find((d) => d.issue === issue);
  if (!d) return showHelp(issue);
  if (!d.failure) return `Run \`nico-agent close ${issue}\` to Close its Dispatch, whose Stack is built on a PR closed without merging, or retarget that Stack`;
  const { harness, model, effort } = d.implementer;
  const resume = `nico-agent dispatch ${issue} --harness ${harness} --model ${model} --effort ${effort}${linearIdentifier(issue) ? ` --repo ${d.repo}` : ""}`;
  return `Run \`${resume}\` to resume the Failed Dispatch, or \`nico-agent close ${issue}\` to Close it`;
}

/** Every step done and the Claim decided: nothing left for a re-run to do. */
function isFinished(d: Dispatch) {
  return d.failure === undefined && STEPS.every((s) => d.completed.includes(s)) && d.claimed !== undefined;
}

async function carryOut(world: World, configDir: string, launch: LaunchDefaults, spec: SpecDecision, plan: SpecPlan, help: string[]): Promise<AdvanceRow | undefined> {
  const row = { spec: spec.spec, repo: spec.repo };
  if (plan.action === "skip") {
    if (plan.help) addHelp(help, plan.help);
    return { ...row, result: "skipped", issue: plan.issue, reason: plan.reason };
  }
  // A resumed Dispatch keeps its own launch and stacking, so `dispatch` sees the same request again.
  const request: DispatchRequest = plan.action === "start"
    ? { issue: plan.issue, ...launch, ...(plan.stackOn ? { stackOn: plan.stackOn } : { base: plan.base }), scheduled: true }
    : { issue: plan.dispatch.issue, harness: plan.dispatch.implementer.harness, model: plan.dispatch.implementer.model, effort: plan.dispatch.implementer.effort };
  if (linearIdentifier(request.issue)) request.repo = spec.repo;
  const issue = request.issue;
  try {
    const { outcome, resumedFrom } = await dispatch(world, configDir, request);
    // Already In flight and its runner still going: nothing to do.
    if (outcome === "existing") return undefined;
    addHelp(help, showHelp());
    if (outcome === "resumed") return { ...row, result: "resumed", issue, reason: `${issue} resumed from ${resumedFrom}` };
    return { ...row, result: "started", issue, reason: plan.action === "start" ? plan.reason : "" };
  } catch (e) {
    if (!(e instanceof DispatchError || e instanceof WorldError)) throw e;
    if (e instanceof DispatchError) addHelp(help, ...e.help.filter((h) => !h.startsWith("Run the same")));
    if (e instanceof StepFailed) addHelp(help, "Run `nico-agent advance` again to resume it");
    const failed = e instanceof StepFailed || e instanceof WorldError;
    return { ...row, result: failed ? "failed" : "skipped", issue, reason: e.message };
  }
}

function addHelp(help: string[], ...lines: string[]) {
  for (const line of lines) if (!help.includes(line)) help.push(line);
}

/** A bad Scheduler default would refuse every start alike, so it fails the run as the config's fault. */
async function checkDefaults(world: World, configDir: string, launch: LaunchDefaults) {
  try {
    await checkLaunch(world, configDir, launch);
  } catch (e) {
    if (!(e instanceof LaunchError)) throw e;
    throw new DispatchError(`scheduler.${e.key} in ${join(configDir, "config.json")}: ${e.message}`, e.help);
  }
}

/** The Scheduler defaults from config; each must be set, as the Scheduler never chooses them. */
export function schedulerDefaults(configDir: string): LaunchDefaults {
  const { scheduler = {} } = loadConfig(configDir);
  const missing = SCHEDULER_DEFAULTS.filter((key) => scheduler[key] === undefined);
  if (missing.length) {
    throw new ConfigError(
      `the Scheduler defaults ${missing.map((key) => `scheduler.${key}`).join(", ")} ${missing.length > 1 ? "are" : "is"} not set`,
      `Set "scheduler": {"harness": "claude", "model": "opus", "effort": "high"} (your choice) in ${join(configDir, "config.json")}`,
    );
  }
  return scheduler as LaunchDefaults;
}
