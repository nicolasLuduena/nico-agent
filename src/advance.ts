import { join } from "node:path";
import { loadBoard } from "./board";
import { ConfigError, SCHEDULER_DEFAULTS, type SchedulerDefaults, loadConfig } from "./config";
import { DispatchError, type DispatchRequest, StepFailed, checkLaunch, dispatch } from "./dispatch";
import { linearIdentifier } from "./linear";
import type { RepoDecision, SpecDecision } from "./spec";
import { freshPrs } from "./stage";
import { type Dispatch, STEPS, loadDispatches } from "./state";
import { type World, WorldError } from "./world";

/** What `advance` did with one running Spec. */
export interface AdvanceRow {
  spec: string;
  repo: string;
  result: "started" | "resumed" | "skipped" | "failed";
  /** The issue started or resumed, or the one the Spec is busy with or waits on; empty when none. */
  issue: string;
  reason: string;
}

export interface AdvanceReport {
  /** One row per running Spec, in Board order; empty when no Spec is running. */
  specs: AdvanceRow[];
  /** Repos whose Specs could not be loaded, so were not advanced. */
  errors: { repo: string; error: string }[];
  help: string[];
}

/**
 * What `advance` does with a running Spec. The one place that decides it, so
 * holds (#41) change only this.
 */
export type SpecPlan =
  | { action: "start"; issue: string; stackOn?: string; base: string; reason: string }
  | { action: "resume"; dispatch: Dispatch }
  | { action: "skip"; issue: string; reason: string; help?: string };

const SHOW_HELP = "Run `nico-agent show <issue>` to see a Dispatch";

export interface AdvanceOptions {
  /** A candidate Spec to start too, the Scheduler's one judgment call; refused unless its Repo has room. */
  start?: string;
}

/**
 * Keep running Specs moving (ADR-0008): dispatch each one's next issue on the
 * PR the Spec rules chose, with the Scheduler defaults from config, one Spec
 * at a time. Idempotent like `dispatch` (ADR-0006).
 */
export async function advance(world: World, configDir: string, { start }: AdvanceOptions = {}): Promise<AdvanceReport> {
  const launch = schedulerDefaults(configDir);
  const report: AdvanceReport = { specs: [], errors: [], help: [] };
  const { repos } = loadConfig(configDir);
  if (!repos.length && start === undefined) return report;
  const dispatches = loadDispatches(configDir);
  const board = await loadBoard(world, repos, dispatches, freshPrs(world));
  report.errors = board.errors.filter((e) => e.source !== "git").map(({ repo, error }) => ({ repo, error }));
  const started = start === undefined ? undefined : startable(board.specs, start);
  // A Spec waiting on another Spec's merges frees its slot, but is still reported.
  const plans = board.specs.flatMap((r) => r.specs).filter((s) => s.running || s.waiting || s === started)
    .map((spec) => ({ spec, plan: planSpec(spec, dispatches) }));
  if (plans.some(({ plan }) => plan.action === "start")) await checkDefaults(world, configDir, launch);
  for (const { spec, plan } of plans) report.specs.push(await carryOut(world, configDir, launch, spec, plan, report.help));
  return report;
}

/** The candidate Spec named `name`, refusing one that is not a candidate, already running, or whose Repo is full. */
function startable(repos: RepoDecision[], name: string): SpecDecision {
  const named = (s: SpecDecision) => s.spec.toLowerCase() === name.toLowerCase();
  const repo = repos.find((r) => r.specs.some(named));
  const spec = repo?.specs.find(named);
  const notCandidate = (why: string) => new DispatchError(`${name} is not a candidate Spec: ${why}`, ["Run `nico-agent` to see the candidate Specs of each Repo"]);
  const help = ["Run `nico-agent advance` to keep the running Specs moving", "Run `nico-agent` to see the Board"];
  if (!repo || !spec) throw notCandidate("no Spec of a Repo has that name");
  if (spec.held) throw new DispatchError(`${spec.spec} is Held: ${spec.held.reason}`, ["Run `nico-agent` to see the Board"]);
  if (spec.running) throw new DispatchError(`${spec.spec} is already running`, help);
  if (!repo.candidates.includes(spec.spec)) throw notCandidate(spec.waiting ? "it has already started" : "none of its issues is Ready");
  if (repo.room === 0) {
    const running = repo.specs.filter((s) => s.running).map((s) => s.spec);
    throw new DispatchError(`${repo.repo} has no room for ${spec.spec}; its running Specs: ${running.join(", ")}`, help);
  }
  return spec;
}

/**
 * A running Spec resumes its unfinished Dispatch, as `dispatch` would
 * (ADR-0006); else starts its next issue; else is skipped with the reason.
 */
export function planSpec(spec: SpecDecision, dispatches: Dispatch[]): SpecPlan {
  if (spec.held) return { action: "skip", issue: spec.held.issue, reason: `Held: ${spec.held.reason}`, help: clearHoldHelp(spec, dispatches) };
  const unfinished = dispatches.find((d) => spec.issues.includes(d.issue) && !isFinished(d));
  if (unfinished) return { action: "resume", dispatch: unfinished };
  if (spec.next) {
    const { issue, stackOn, base, reason } = spec.next;
    return { action: "start", issue, base, reason, ...(stackOn && { stackOn: stackOn.url }) };
  }
  if (spec.waiting) return { action: "skip", issue: spec.waiting.issue, reason: spec.waiting.reason };
  return { action: "skip", issue: spec.implementing ?? "", reason: spec.reason ?? "" };
}

/** How the user clears a Spec's hold: resume the Failed Dispatch with its own launch, or Close it or the orphaned one. */
function clearHoldHelp(spec: SpecDecision, dispatches: Dispatch[]) {
  const issue = spec.held!.issue;
  const d = dispatches.find((d) => d.issue === issue);
  if (!d) return SHOW_HELP;
  if (!d.failure) return `Run \`nico-agent close ${issue}\` to Close the orphaned Dispatch, or retarget its Stack`;
  const { harness, model, effort } = d.implementer;
  const resume = `nico-agent dispatch ${issue} --harness ${harness} --model ${model} --effort ${effort}${linearIdentifier(issue) ? ` --repo ${d.repo}` : ""}`;
  return `Run \`${resume}\` to resume the Failed Dispatch, or \`nico-agent close ${issue}\` to Close it`;
}

/** Every step done and the Claim decided: nothing left for a re-run to do. */
function isFinished(d: Dispatch) {
  return d.failure === undefined && STEPS.every((s) => d.completed.includes(s)) && d.claimed !== undefined;
}

async function carryOut(world: World, configDir: string, launch: SchedulerDefaults, spec: SpecDecision, plan: SpecPlan, help: string[]): Promise<AdvanceRow> {
  const row = { spec: spec.spec, repo: spec.repo };
  if (plan.action === "skip") {
    if (plan.help) addHelp(help, plan.help);
    return { ...row, result: "skipped", issue: plan.issue, reason: plan.reason };
  }
  // A resumed Dispatch keeps its own launch and stacking, so `dispatch` sees the same request again.
  const request: DispatchRequest = plan.action === "start"
    ? { issue: plan.issue, ...launch, ...(plan.stackOn ? { stackOn: plan.stackOn } : { base: plan.base }) }
    : { issue: plan.dispatch.issue, harness: plan.dispatch.implementer.harness, model: plan.dispatch.implementer.model, effort: plan.dispatch.implementer.effort };
  if (linearIdentifier(request.issue)) request.repo = spec.repo;
  const issue = request.issue;
  try {
    const { outcome, resumedFrom } = await dispatch(world, configDir, request);
    addHelp(help, SHOW_HELP);
    if (outcome === "existing") return { ...row, result: "skipped", issue, reason: `${issue} is already In flight (no-op)` };
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
async function checkDefaults(world: World, configDir: string, launch: SchedulerDefaults) {
  try {
    await checkLaunch(world, configDir, launch);
  } catch (e) {
    if (!(e instanceof DispatchError)) throw e;
    const key = /^unknown Harness/.test(e.message) ? "harness" : /^unknown model/.test(e.message) ? "model" : "effort";
    throw new DispatchError(`scheduler.${key} in ${join(configDir, "config.json")}: ${e.message}`, e.help);
  }
}

/** The Scheduler defaults from config; each must be set, as the Scheduler never chooses them. */
export function schedulerDefaults(configDir: string): SchedulerDefaults {
  const { scheduler = {} } = loadConfig(configDir);
  const missing = SCHEDULER_DEFAULTS.filter((key) => scheduler[key] === undefined);
  if (missing.length) {
    throw new ConfigError(
      `the Scheduler defaults ${missing.map((key) => `scheduler.${key}`).join(", ")} ${missing.length > 1 ? "are" : "is"} not set`,
      `Set "scheduler": {"harness": "claude", "model": "opus", "effort": "high"} (your choice) in ${join(configDir, "config.json")}`,
    );
  }
  return scheduler as SchedulerDefaults;
}
