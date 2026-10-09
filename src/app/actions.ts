import { sameSlug } from "../slug";
import type { BoardJson, InFlightDispatch } from "./board";

/** `nico-agent harness list --json`, as `/api/harnesses` answers it. */
export interface HarnessesJson {
  harnesses?: { name: string; models: { model: string; efforts: string[] }[]; error?: string }[];
  remembered?: { last?: { harness: string; model: string }; efforts: Record<string, string> };
}

/** What the user picked in a launch form so far; anything unset or no longer valid falls back. */
export interface Chosen {
  harness?: string;
  model?: string;
  effort?: string;
  stackOn?: string;
  base?: string;
}

/** A launch form's Harness, model and Effort, each with what it offers. */
export interface LaunchChoice {
  harnesses: string[];
  harness: string;
  models: string[];
  model: string;
  efforts: string[];
  effort: string;
}

/**
 * The Harness, model and Effort a launch form offers and shows. It starts on
 * the last launch; a chosen Harness, model and Effort are kept while valid.
 * Otherwise the Effort is the one last used with the model, or the model's
 * first. Null when no Harness has models.
 */
export function launchChoice({ harnesses = [], remembered = { efforts: {} } }: HarnessesJson, chosen: Chosen): LaunchChoice | null {
  const offered = harnesses.filter((h) => h.models.length > 0);
  const { harness: wanted = remembered.last?.harness, model: wantedModel = remembered.last?.model } = chosen;
  const harness = offered.find((h) => h.name === wanted) ?? offered[0];
  if (!harness) return null;
  const model = harness.models.find((m) => m.model === wantedModel) ?? harness.models[0]!;
  const valid = (effort: string | undefined) => (effort && model.efforts.includes(effort) ? effort : undefined);
  const effort = valid(chosen.effort) ?? valid(remembered.efforts[`${harness.name} ${model.model}`]) ?? model.efforts[0]!;
  return {
    harnesses: offered.map((h) => h.name), harness: harness.name,
    models: harness.models.map((m) => m.model), model: model.model,
    efforts: model.efforts, effort,
  };
}

/** Why a Harness offers nothing, for the top of the Board. */
export function harnessWarnings({ harnesses = [] }: HarnessesJson) {
  return harnesses.flatMap((h) => (h.error ? [h.error] : []));
}

/** A Blocker PR a Stackable issue can stack on: `value` as `--stack-on` takes it. */
export interface StackChoice {
  value: string;
  label: string;
}

/** What an issue's dispatch form offers besides the launch: the Base of a Ready issue, or the PRs a Stackable one stacks on. */
export interface DispatchTarget {
  issue: string;
  /** The Repo a Linear issue is dispatched into, as its row names it. */
  repo?: string;
  base?: { branches: string[]; selected: string };
  stack?: StackChoice[];
}

/** A Linear key, such as `BLE-27`, names no Repo; a GitHub one, `acme/api#7`, does. */
const isLinear = (issue: string) => !issue.includes("#");

/** The dispatch form of an issue in `repo`'s section: a Ready or Stackable one, else null. */
export function dispatchTarget(board: BoardJson, issue: string, repo: string): DispatchTarget | null {
  const mine = <T extends { issue: string; repo: string }>(items: T[] = []) => items.find((i) => i.repo === repo && i.issue === issue);
  const where = { issue, ...(isLinear(issue) && { repo }) };
  const ready = mine(board.issues);
  if (ready) {
    const branches = board.bases?.find((b) => b.repo === repo)?.branches;
    // origin's branches could not be listed: the dispatch starts from the Repo's default.
    return { ...where, ...(ready.base && branches && { base: { branches, selected: ready.base } }) };
  }
  const stackable = mine(board.stackable);
  if (!stackable) return null;
  const { blockers } = stackable;
  return {
    ...where,
    stack: blockers.map((b) => ({
      // A Blocker names its sole PR; several PRs need an exact URL.
      value: blockers.filter((o) => sameSlug(o.issue, b.issue)).length > 1 ? b.pr : b.issue,
      label: `${b.issue} · PR #${b.pr.match(/\/pull\/(\d+)/)?.[1] ?? "?"} · base ${b.base}`,
    })),
  };
}

export type LaunchAction = "dispatch" | "review";

/** The CLI arguments a launch form posts after its command: the issue, the launch, and the Repo, Base or PR it stacks on. */
export function launchArgs(action: LaunchAction, target: DispatchTarget, { harness, model, effort }: LaunchChoice, chosen: Chosen): string[] {
  const args = [target.issue, "--harness", harness, "--model", model, "--effort", effort];
  if (action === "review") return args;
  const { base, stack } = target;
  if (target.repo) args.push("--repo", target.repo);
  if (stack?.length) args.push("--stack-on", stack.find((s) => s.value === chosen.stackOn)?.value ?? stack[0]!.value);
  else if (base) args.push("--base", chosen.base && base.branches.includes(chosen.base) ? chosen.base : base.selected);
  return args;
}

/** Whether the Board offers Launch review on an In-flight row: a PR is linked and no Reviewer was started. */
export function canReview(d: InFlightDispatch) {
  return d.pr !== "" && d.reviewer === "" && !d.failure && d.workspace !== "";
}

/** The ticked issues each batch action applies to, and why the others are left out. */
export interface BatchPlan {
  dispatch: DispatchTarget[];
  review: string[];
  close: string[];
  skipped: { dispatch: string[]; review: string[] };
}

/**
 * Dispatch applies to ticked issues not In flight (the Board ticks only its
 * Ready and Stackable GitHub issues besides), Review to In-flight ones with a
 * PR and no Reviewer, Close to In-flight ones. An issue no longer on the
 * Board applies to none.
 */
export function batchPlan(board: BoardJson, picked: string[]): BatchPlan {
  const plan: BatchPlan = { dispatch: [], review: [], close: [], skipped: { dispatch: [], review: [] } };
  for (const issue of picked) {
    const flight = board.dispatches?.find((d) => d.issue === issue);
    if (!flight) {
      const repo = issue.slice(0, issue.lastIndexOf("#"));
      const target = isLinear(issue) ? null : dispatchTarget(board, issue, repo);
      if (!target) continue;
      plan.dispatch.push(target);
      plan.skipped.review.push(`${issue}: ${issue} is not In flight`);
      continue;
    }
    plan.close.push(issue);
    plan.skipped.dispatch.push(`${issue}: ${issue} is already In flight`);
    const why = flight.reviewer ? "already has a Reviewer" : flight.failure ? "is Failed" : !flight.pr || !flight.workspace ? null : "";
    if (why === "") plan.review.push(issue);
    else plan.skipped.review.push(why === null ? `${issue}: no PR is linked to ${issue} yet` : `${issue}: ${issue} ${why}`);
  }
  return plan;
}

/** Close of In-flight issues: those with a PR straight away, those still Implementing (no PR) only once confirmed. */
export function closePlan(board: BoardJson, issues: string[]) {
  const flights = issues.flatMap((issue) => board.dispatches?.filter((d) => d.issue === issue) ?? []);
  return { now: flights.filter((d) => d.pr).map((d) => d.issue), confirm: flights.filter((d) => !d.pr).map((d) => d.issue) };
}

/** An action's answer, as the app shows it in place: its lines, and the CLI's help when it failed. */
export interface Outcome {
  failed: boolean;
  lines: { text: string; error: boolean }[];
  help: string[];
}

/** The CLI's JSON answer to an action: an `error`, a `results` row per issue, or what it did. */
export function outcomeOf(json: Record<string, unknown>): Outcome {
  const help = Array.isArray(json.help) ? (json.help as string[]) : [];
  if (typeof json.error === "string") return { failed: true, lines: [{ text: json.error, error: true }], help };
  if (Array.isArray(json.results)) {
    const lines = (json.results as { issue: string; result: string; error?: string }[]).map((r) =>
      ({ text: `${r.issue}: ${r.error ? `${r.result}, ${r.error}` : r.result}`, error: Boolean(r.error) }));
    const failed = lines.some((l) => l.error);
    return { failed, lines, help: failed ? help : [] };
  }
  return { failed: false, lines: [], help: [] };
}

/** A line of Advance now's report: a Spec's `result`, or `warning`, `error`, `closed`, `failed` or `empty`. */
export interface AdvanceLine {
  result: string;
  text: string;
}

/** `nico-agent advance --json`, as Advance now shows it: a line per Spec acted on, what it Closed, and what went wrong. */
export function advanceReport(json: Record<string, unknown>): { lines: AdvanceLine[]; help: string[] } {
  const help = Array.isArray(json.help) ? (json.help as string[]) : [];
  if (typeof json.error === "string") return { lines: [{ result: "failed", text: json.error }], help };
  const { specs = [], errors = [], closed = [], warnings = [] } = json as {
    specs?: { spec: string; issue: string; result: string; reason: string }[];
    errors?: { repo: string; error: string }[];
    closed?: string[];
    warnings?: string[];
  };
  const lines: AdvanceLine[] = [
    ...warnings.map((w) => ({ result: "warning", text: w })),
    ...errors.map((e) => ({ result: "error", text: `Could not load ${e.repo}: ${e.error}` })),
    ...specs.map((s) => ({ result: s.result, text: `${[s.issue && `${s.issue} of`, s.spec].filter(Boolean).join(" ")}: ${s.reason}` })),
    ...(closed.length ? [{ result: "closed", text: `Closed, their PR ready: ${closed.join(", ")}` }] : []),
  ];
  if (!lines.length) return { lines: [{ result: "empty", text: "Nothing to do: no running Spec needs a step and no queued Spec could start." }], help: [] };
  // Help says what to do about what went wrong; a clean run needs none.
  return { lines, help: lines.some((l) => ["failed", "error", "warning"].includes(l.result)) ? help : [] };
}
