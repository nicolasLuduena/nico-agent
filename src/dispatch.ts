import { type Placeholder, type Prompts, type Repo, fillTemplate, findRepo, loadConfig, prompts } from "./config";
import { type Harness, type McpWiring, harnessCatalog, harnesses, launchArgs, rememberLaunch, rememberedLaunches } from "./harness";
import { linearIdentifier } from "./linear";
import { paneCommand, saveVariant } from "./opencode";
import { githubBranch, sameSlug } from "./slug";
import { freshPrs, isReviewLaunched, linkedPr, linkedPrs } from "./stage";
import {
  type Dispatch,
  type Launch,
  type ReviewStep,
  type Step,
  REVIEW_STEPS,
  STEPS,
  addDispatch,
  findDispatch,
  leaseDispatch,
  removeDispatch,
  saveDispatch,
} from "./state";
import { type LinearIssue, type World, WorldError, isResearch } from "./world";
import { type BlockerPrs, baseChoice, blockerPrs, matchesSelector } from "./board";
import { canStart, githubSource, isLinearClosed, linearSource } from "./source";
import { type StackTarget, chooseStackTarget } from "./stack";

import { DispatchError, LaunchError } from "./dispatch-error";

const DISPATCH_HINT = "nico-agent dispatch <issue> --harness <harness> --model <model> --effort <effort>";

export interface DispatchRequest {
  issue: string;
  harness: string;
  model: string;
  effort: string;
  /** Open PR in the Repo to stack on, by its issue or URL; omitted when a single Blocker PR is the only option. */
  stackOn?: string;
  /** Branch on origin to use as the Base; omitted for the last one used in the Repo, else the default branch. */
  base?: string;
  /** Repo to dispatch a Linear issue into; omitted when a single Repo claims it. */
  repo?: string;
  /** Started by `advance`: its Base is the Scheduler's, not the user's choice, so it is not remembered. */
  scheduled?: boolean;
}

/**
 * An issue in the Repo it is dispatched into. `key` is the Dispatch key:
 * `owner/repo#N` with the Repo's configured slug for a GitHub issue, the
 * identifier (`BLE-27`) for a Linear one.
 */
export type IssueRef = GitHubRef | LinearRef;
export type GitHubRef = { repo: Repo; key: string; number: number; identifier?: undefined };
export type LinearRef = { repo: Repo; key: string; identifier: string; number?: undefined };

/** An issue reference as given: a GitHub issue knows its Repo, a Linear one only once dispatched or fetched. */
export type ParsedIssue = GitHubRef | { repo?: undefined; key: string; identifier: string; number?: undefined };

/**
 * Resolve `owner/repo#N` or a GitHub issue URL to a configured Repo's issue,
 * or recognize a Linear identifier or issue URL.
 */
export function resolveIssue(configDir: string, ref: string): ParsedIssue {
  const identifier = linearIdentifier(ref);
  if (identifier) return { identifier, key: identifier };
  const match =
    ref.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/) ??
    ref.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i);
  if (!match) {
    throw new DispatchError(`\`${ref}\` is not an issue reference`, ["Pass `owner/repo#N` or a GitHub issue URL"], true);
  }
  const [, slug, digits] = match as unknown as [string, string, string];
  const repo = findRepo(loadConfig(configDir), slug);
  if (!repo) {
    throw new DispatchError(`${slug} is not a configured Repo`, [`Run \`nico-agent repo add ${slug} --path <clone>\` first`]);
  }
  const number = Number(digits);
  return { repo, number, key: `${repo.slug}#${number}` };
}

/** A step of a Dispatch failed; the Dispatch is kept, Failed at `step`, to be resumed by the same `command`. */
export class StepFailed extends DispatchError {
  constructor(
    readonly dispatch: Dispatch,
    readonly step: string,
    message: string,
    help: string[],
    command: "dispatch" | "review" = "dispatch",
  ) {
    super(message, [
      ...help,
      `Run \`nico-agent show ${dispatch.issue}\` to see the Dispatch`,
      `Run the same \`nico-agent ${command}\` again to resume from ${step}`,
    ]);
  }
}

export interface DispatchResult {
  dispatch: Dispatch;
  /** `new`, `existing` for a no-op re-run, or `resumed` from the step that had failed or was cut short. */
  outcome: "new" | "existing" | "resumed";
  resumedFrom?: Step | "claim";
}

/**
 * Dispatch an issue: fetch the clone, create a worktree workspace on its
 * Base (see `chooseBase`), start the Implementer in an `implementer` tab, prompt it
 * (see `implementPrompt`) and Claim the issue. Idempotent (ADR-0006): the
 * same request again returns the existing Dispatch, or resumes it from the
 * step that failed.
 */
export async function dispatch(world: World, configDir: string, request: DispatchRequest): Promise<DispatchResult> {
  const harness = await chooseLaunch(world, configDir, request);
  const parsed = resolveIssue(configDir, request.issue);
  if (parsed.repo && request.repo) {
    throw new DispatchError(`${parsed.key} is a GitHub issue; its Repo is in its reference`, ["Dispatch it without `--repo`"]);
  }
  const { key } = parsed;
  const templates = prompts(loadConfig(configDir));
  const existing = findDispatch(configDir, key);
  if (existing) {
    sameLaunch(existing, request);
    const ref = dispatchedRef(configDir, parsed, existing);
    const leased = await leaseDispatch(configDir, key, world.processId(), (d) => isResumable(world, d));
    if (!leased) return { dispatch: findDispatch(configDir, key) ?? existing, outcome: "existing" };
    const resumedFrom = leased.failure?.step ?? STEPS.find((s) => !leased.completed.includes(s)) ?? "claim";
    return { dispatch: await runSteps(world, configDir, ref, harness, templates, leased), outcome: "resumed", resumedFrom };
  }
  if (!parsed.repo) return newLinearDispatch(world, configDir, parsed.identifier, harness, templates, request);

  const ref = parsed;
  const { repo, number } = ref;
  const issue = await world.githubIssue(repo.slug, number);
  if (!issue) throw new DispatchError(`${key} was not found on GitHub`, [`Check the issue number on https://github.com/${repo.slug}/issues`]);
  if (issue.state !== "open") throw new DispatchError(`${key} is closed`, ["Run `nico-agent` to see the Ready issues"]);
  if (issue.hasSubIssues) throw new DispatchError(`${key} is a Spec; dispatch its issues instead`, ["Run `nico-agent` to see the Ready issues"]);
  let blockers: BlockerPrs[] = [];
  if (issue.blockers.some((b) => b.state === "open")) {
    if (!canStart(issue, await world.githubViewer())) {
      throw new DispatchError(`${key} is not Stackable`, ["Run `nico-agent` to see the Board"]);
    }
    blockers = await blockerPrs(githubSource(world, repo.slug), issue);
  }
  const stackedOn = await chooseStackTarget(world, key, repo.slug, blockers, request.stackOn,
    () => new DispatchError(`${key} has open Blockers without same-Repo open PRs`, ["Run `nico-agent` to see the Board"]));
  const base = await chooseBase(world, configDir, ref, request, stackedOn);
  const url = `https://github.com/${repo.slug}/issues/${number}`;
  return startDispatch(world, configDir, ref, harness, templates, request, { title: issue.title, url, research: isResearch(issue), branch: githubBranch(repo.slug, number), base, stackedOn });
}

/**
 * Dispatch a Linear issue (ADR-0004) into the Repo whose Linear selector
 * claims it, or the requested one among several: on Linear's own
 * `branchName`, so its GitHub integration links the PR.
 */
async function newLinearDispatch(world: World, configDir: string, identifier: string, harness: Harness, templates: Prompts, request: DispatchRequest) {
  const issue = await world.linearIssue(identifier);
  if (!issue) throw new DispatchError(`${identifier} was not found on Linear`, ["Check the identifier in Linear"]);
  if (isLinearClosed(issue.state)) throw new DispatchError(`${identifier} is closed`, ["Run `nico-agent` to see the Ready issues"]);
  if (issue.hasSubIssues) throw new DispatchError(`${identifier} is a Spec; dispatch its issues instead`, ["Run `nico-agent` to see the Ready issues"]);
  // Linear has one assignee, so the Claim would replace someone else.
  if (issue.assignee !== null && issue.assignee !== await world.linearViewer()) {
    throw new DispatchError(`${identifier} is assigned to someone else on Linear`, ["Run `nico-agent` to see the Ready issues"]);
  }
  const ref: IssueRef = { repo: claimingRepo(configDir, issue, request.repo), identifier, key: identifier };
  const blockers = await blockerPrs(linearSource(world, ref.repo.slug), issue);
  const stackedOn = await chooseStackTarget(world, identifier, ref.repo.slug, blockers, request.stackOn,
    () => new DispatchError(`${identifier} has unresolved Blockers without open PRs in ${ref.repo.slug}`, [
      "Dispatch it once its Blockers are done, or once each has an open PR in the Repo",
      "Run `nico-agent` to see the Board",
    ]));
  const base = await chooseBase(world, configDir, ref, request, stackedOn);
  return startDispatch(world, configDir, ref, harness, templates, request, { title: issue.title, url: issue.url, research: isResearch(issue), branch: issue.branchName, base, stackedOn });
}

/** The Repo a Linear issue is dispatched into: `choice`, which must claim it, else the only Repo that does. */
function claimingRepo(configDir: string, issue: LinearIssue, choice?: string): Repo {
  const { repos } = loadConfig(configDir);
  const claiming = repos.filter((r) => r.linear && matchesSelector(issue, r.linear));
  const help = claiming.map((r) => `Dispatch into ${r.slug} with \`--repo ${r.slug}\``);
  const addRepo = "Run `nico-agent repo add <owner/name> --path <clone> --linear-team <team>` to add a Repo that claims it";
  if (choice) {
    const repo = claiming.find((r) => sameSlug(r.slug, choice));
    if (repo) return repo;
    throw new DispatchError(`${choice} does not claim ${issue.identifier} through its Linear selector`, help.length ? help : [addRepo]);
  }
  if (claiming.length === 1) return claiming[0]!;
  if (!claiming.length) throw new DispatchError(`${issue.identifier} matches no Repo's Linear selector`, [addRepo]);
  throw new DispatchError(`${issue.identifier} matches several Repos; choose one with --repo`, help);
}

/** Record a new Dispatch, then run its steps. */
async function startDispatch(
  world: World,
  configDir: string,
  ref: IssueRef,
  harness: Harness,
  templates: Prompts,
  request: DispatchRequest,
  { title, url, research, branch, base, stackedOn }: { title: string; url: string; research: boolean; branch: string; base: string; stackedOn?: StackTarget },
): Promise<DispatchResult> {
  const { repo, key } = ref;
  const now = world.now().toISOString();
  const record: Dispatch = {
    issue: key,
    title,
    url,
    repo: repo.slug,
    ...(stackedOn && { stackedOn }),
    branch,
    base: `origin/${base}`,
    implementer: { agent: agentName("impl", repoName(repo), ref), harness: harness.name, model: request.model, effort: request.effort },
    ...(research && { research }),
    completed: [],
    runner: world.processId(),
    createdAt: now,
    updatedAt: now,
  };
  // Recorded before any side effect, so a concurrent dispatch of the issue finds it.
  if (!(await addDispatch(configDir, record))) throw alreadyInFlight(key);
  rememberLaunch(configDir, harness.name, request.model, request.effort, stackedOn || request.scheduled ? undefined : { repo: repo.slug, branch: base });
  return { dispatch: await runSteps(world, configDir, ref, harness, templates, record), outcome: "new" };
}

/** The issue of an existing Dispatch, in the Repo it was dispatched into. */
function dispatchedRef(configDir: string, parsed: ParsedIssue, dispatch: Dispatch): IssueRef {
  if (parsed.repo) return parsed;
  const repo = findRepo(loadConfig(configDir), dispatch.repo);
  if (!repo) {
    throw new DispatchError(`${dispatch.repo}, which ${parsed.key} was dispatched into, is no longer a configured Repo`, [
      `Run \`nico-agent repo add ${dispatch.repo} --path <clone>\` to add it back`,
    ]);
  }
  return { repo, identifier: parsed.identifier, key: parsed.key };
}

/** A Dispatch with no PR yet is still Implementing, so closing it needs confirmation. */
export class CloseConfirmationRequired extends DispatchError {
  constructor(readonly issue: string) {
    super(`${issue} has no PR yet; closing requires confirmation`, [
      `Run \`nico-agent close ${issue} --confirm\` to remove its workspace and forget the Dispatch`,
    ]);
  }
}

/**
 * Remove a Dispatch's workspace before forgetting it, holding the same lease as
 * launches. Once it has a PR, whatever its state, no confirmation is needed.
 */
export async function closeDispatch(world: World, configDir: string, issue: string, confirm = false) {
  const { key } = resolveIssue(configDir, issue);
  if (!findDispatch(configDir, key)) return { issue: key, outcome: "existing" as const };
  const record = await leaseDispatch(configDir, key, world.processId(),
    (d) => d.runner === undefined || !world.processAlive(d.runner));
  if (!record) {
    if (!findDispatch(configDir, key)) return { issue: key, outcome: "existing" as const };
    throw new DispatchError(`${key} is busy with another nico-agent`, ["Try again once it is done"]);
  }
  try {
    if (!confirm) {
      const [linked, branch] = await Promise.all([
        linkedPrs(world, record),
        world.githubBranchPullRequests(record.repo, record.branch),
      ]);
      if (!linkedPr([...linked, ...branch], record.repo)) throw new CloseConfirmationRequired(key);
    }
    if (record.workspace) await world.herdrWorktreeRemove(record.workspace);
    await removeDispatch(configDir, key);
    return { issue: key, outcome: "closed" as const };
  } catch (e) {
    delete record.runner;
    await saveDispatch(configDir, record);
    throw e;
  }
}

/** How one issue of a batch went: done with `value`, or failed or skipped with the error. */
export type IssueOutcome<T> =
  | { issue: string; outcome: "done"; value: T }
  | { issue: string; outcome: "failed" | "skipped"; error: DispatchError | WorldError };

/**
 * Run `action` on each issue in turn, each on its own: an issue refused before
 * any side effect is skipped, one whose step or outside call failed is failed,
 * and either way the rest still run. One at a time, since issues of a Repo
 * share its clone.
 */
export async function eachIssue<T>(issues: string[], action: (issue: string) => Promise<T>): Promise<IssueOutcome<T>[]> {
  const outcomes: IssueOutcome<T>[] = [];
  for (const issue of issues) {
    try {
      outcomes.push({ issue, outcome: "done", value: await action(issue) });
    } catch (e) {
      if (!(e instanceof DispatchError || e instanceof WorldError)) throw e;
      const skipped = e instanceof DispatchError && !(e instanceof StepFailed);
      outcomes.push({ issue, outcome: skipped ? "skipped" : "failed", error: e });
    }
  }
  return outcomes;
}

export interface ReviewResult {
  dispatch: Dispatch;
  /** `new`, `existing` for a no-op re-run, or `resumed` from the step that had failed or was cut short. */
  outcome: "new" | "existing" | "resumed";
  resumedFrom?: ReviewStep;
}

/**
 * Launch a Reviewer on an In-flight issue's PR: a `reviewer` tab in the
 * Dispatch's workspace, prompted to review the PR against its base branch
 * for the issue's spec. Only once a PR is linked (ADR-0003); idempotent like
 * dispatch.
 */
export async function review(world: World, configDir: string, request: DispatchRequest): Promise<ReviewResult> {
  const harness = await chooseLaunch(world, configDir, request);
  const parsed = resolveIssue(configDir, request.issue);
  const { key } = parsed;
  const templates = prompts(loadConfig(configDir));
  const existing = findDispatch(configDir, key);
  if (!existing) throw new DispatchError(`${key} is not In flight`, [`Run \`${DISPATCH_HINT}\` to dispatch it first`]);
  const ref = dispatchedRef(configDir, parsed, existing);
  const show = `Run \`nico-agent show ${key}\` to see the Dispatch`;
  const isFree = (d: Dispatch) => d.runner === undefined || !world.processAlive(d.runner);

  if (existing.reviewer) {
    const { harness: h, model, effort } = existing.reviewer;
    if (h !== request.harness || model !== request.model || effort !== request.effort) {
      throw new DispatchError(`${key} already has a Reviewer with ${h} ${model} ${effort}`, [show]);
    }
    const leased = await leaseDispatch(configDir, key, world.processId(), (d) => isFree(d) && !isReviewLaunched(d));
    if (!leased) return { dispatch: findDispatch(configDir, key) ?? existing, outcome: "existing" };
    const resumedFrom = leased.reviewer!.failure?.step ?? REVIEW_STEPS.find((s) => !leased.reviewer!.completed.includes(s))!;
    return { dispatch: await runReview(world, configDir, ref, harness, templates, leased), outcome: "resumed", resumedFrom };
  }

  // The web offers no Launch review then; the CLI refuses the same way.
  if (existing.failure) {
    throw new DispatchError(`${key} is Failed at ${existing.failure.step}`, [
      "Run the same `nico-agent dispatch` again to resume it",
      show,
    ]);
  }
  if (!existing.workspace || !existing.worktree) {
    throw new DispatchError(`${key} has no workspace to review in yet`, [
      `Run the same \`nico-agent dispatch\` again to resume it`,
      show,
    ]);
  }
  const pr = await freshPrs(world)(existing);
  if (!pr) {
    throw new DispatchError(`no PR is linked to ${key} yet`, [
      "Run the same `nico-agent review` again once the Implementer has opened a PR that closes the issue",
      show,
    ]);
  }
  const leased = await leaseDispatch(configDir, key, world.processId(), (d) => isFree(d) && !d.reviewer && !d.failure);
  if (!leased) {
    const now = findDispatch(configDir, key);
    if (now?.reviewer) return review(world, configDir, request);
    throw new DispatchError(`${key} is busy with another nico-agent`, ["Try again once it is done", show]);
  }
  leased.reviewer = {
    agent: agentName("rev", repoName(ref.repo), ref),
    harness: harness.name,
    model: request.model,
    effort: request.effort,
    prUrl: pr.url,
    prBase: pr.baseBranch,
    completed: [],
  };
  return { dispatch: await runReview(world, configDir, ref, harness, templates, leased), outcome: "new" };
}

/** Run the Reviewer's steps `dispatch` has not completed, as the runner holding its lease. */
async function runReview(world: World, configDir: string, ref: IssueRef, harness: Harness, templates: Prompts, dispatch: Dispatch) {
  const reviewer = { ...dispatch.reviewer!, completed: [...dispatch.reviewer!.completed] };
  const record: Dispatch = { ...dispatch, reviewer };
  const steps: Record<ReviewStep, () => Promise<void>> = {
    ...agentSteps(world, harness, () => placeOf(ref.repo, record), reviewer, "reviewer"),
    prompt: async () => {
      const values = { sigil: harness.sigil, issueUrl: record.url, baseBranch: baseBranch(record), prUrl: reviewer.prUrl, prBaseBranch: reviewer.prBase };
      await prompt(world, reviewer.agent, fillTemplate(templates.review, values));
    },
  };
  await runLeased(world, configDir, record, (save) => runPhase(record, reviewer, REVIEW_STEPS, steps, save, stepFailed(record, "review")));
  return record;
}

/** Refuse a launch whose Harness, model or Effort is unknown, before any Dispatch is made with it. */
export async function checkLaunch(world: World, configDir: string, launch: Pick<DispatchRequest, "harness" | "model" | "effort">) {
  await chooseLaunch(world, configDir, launch);
}

/**
 * The Harness of a request, once its model is one of the Harness's and its
 * Effort one that model supports. Which models and Efforts are valid comes
 * from config and discovery, so only an unknown Harness or model is a usage
 * error; an Effort the model does not support fails like a Source would.
 */
export async function chooseLaunch(world: World, configDir: string, request: Pick<DispatchRequest, "harness" | "model" | "effort">): Promise<Harness> {
  const catalog = await harnessCatalog(world, configDir, request.harness);
  if (!catalog) {
    const names = harnesses(configDir).map((h) => h.name);
    throw new LaunchError("harness", `unknown Harness \`${request.harness}\``, [`Valid Harnesses: ${names.join(", ")}`], true);
  }
  const { harness, models, error } = catalog;
  const choice = models.find((m) => m.model === request.model);
  if (!choice && error) {
    throw new DispatchError(error, [
      "Run `nico-agent harness refresh` to try again",
      `Set harnesses.${harness.name}.models and harnesses.${harness.name}.efforts in config.json to skip discovery`,
    ]);
  }
  if (!choice) {
    throw new LaunchError("model", `unknown model \`${request.model}\` for ${harness.name}`, [
      `Valid models for ${harness.name}: ${models.map((m) => m.model).join(", ")}`,
    ], true);
  }
  if (!choice.efforts.includes(request.effort)) {
    const launch = `${harness.name} ${choice.model}`;
    throw new LaunchError("effort", `Effort \`${request.effort}\` is not valid for ${launch}`, [
      `Valid Efforts for ${launch}: ${choice.efforts.join(", ")}`,
    ]);
  }
  return harness;
}

/**
 * The Base of a new Dispatch, without the remote prefix. A Stacked dispatch's
 * is the head branch of the PR it stacks on, with no choice. Otherwise it is the
 * requested branch, which origin must have, else the last one used in the
 * Repo while origin still has it, else origin's default branch.
 */
async function chooseBase(world: World, configDir: string, { repo, key }: IssueRef, request: DispatchRequest, stackedOn?: StackTarget) {
  if (stackedOn) {
    if (request.base) throw stackedBase(key);
    return stackedOn.pr.headBranch;
  }
  const { branches, selected } = await baseChoice(world, repo, request.base ?? repo.base ?? rememberedLaunches(configDir).bases[repo.slug]);
  if (request.base && selected !== request.base) {
    throw new DispatchError(`\`${request.base}\` is not a branch on origin of ${repo.slug}`, [
      `Pass \`--base\` one of origin's branches: ${branches.join(", ")}`,
    ]);
  }
  return selected;
}

function stackedBase(key: string) {
  return new DispatchError(`${key} is Stacked; its Base is the head branch of the PR it stacks on`, ["Dispatch it without `--base`"]);
}

/**
 * Whether a re-run may take over a Dispatch: nobody is running its steps (its
 * runner exited, or was killed mid-step) and something is left to do.
 */
export function isResumable(world: World, dispatch: Dispatch) {
  if (dispatch.runner !== undefined && world.processAlive(dispatch.runner)) return false;
  return dispatch.failure !== undefined || dispatch.completed.length < STEPS.length || dispatch.claimed === undefined;
}

/**
 * Run the Implementer's steps `dispatch` has not completed, then Claim the
 * issue, as the runner of a Dispatch that holds its lease.
 */
async function runSteps(
  world: World,
  configDir: string,
  ref: IssueRef,
  harness: Harness,
  templates: Prompts,
  dispatch: Dispatch,
) {
  const { repo } = ref;
  const record: Dispatch = {
    ...dispatch,
    completed: [...dispatch.completed],
    implementer: { ...dispatch.implementer },
    ...(dispatch.warnings && { warnings: [...dispatch.warnings] }),
  };
  const steps: Record<Step, () => Promise<void>> = {
    fetch: async () => {
      await world.gitFetch(repo.path, record.stackedOn?.pr.headBranch);
      // Dispatches recorded before the Base was chosen up front.
      record.base ??= `origin/${record.stackedOn?.pr.headBranch ?? await world.gitDefaultBranch(repo.path)}`;
    },
    worktree: async () => {
      const label = ref.identifier ? `${repoName(repo)}:${ref.identifier}` : `${repoName(repo)}#${ref.number}`;
      const worktree = await world.herdrWorktreeCreate({ cwd: repo.path, branch: record.branch, base: record.base!, label });
      record.worktree = worktree.path;
      record.workspace = worktree.workspace;
    },
    ...agentSteps(world, harness, () => placeOf(repo, record), record.implementer, "implementer"),
    prompt: async () => {
      const { text, botSuffix, warning } = await implementPrompt(world, templates, ref.repo, harness, record);
      await prompt(world, record.implementer.agent, text);
      record.botSuffix = botSuffix;
      if (warning) warn(record, warning);
    },
  };
  await runLeased(world, configDir, record, async (save) => {
    await runPhase(record, record, STEPS, steps, save, stepFailed(record, "dispatch"));
    if (record.claimed === undefined) await claim(world, ref, record);
  });
  return record;
}

/**
 * Run `fn` as the runner of `record`, saving it after it and releasing the
 * lease however `fn` ends.
 */
async function runLeased(world: World, configDir: string, record: Dispatch, fn: (save: () => Promise<void>) => Promise<void>) {
  const save = () => {
    record.updatedAt = world.now().toISOString();
    return saveDispatch(configDir, record);
  };
  try {
    await fn(save);
  } finally {
    if (record.runner !== undefined) {
      delete record.runner;
      await save();
    }
  }
}

/** How far an agent's steps got: the Dispatch itself for the Implementer, the Reviewer for a review, the Lead's record. */
export interface Progress<S extends string> {
  completed: S[];
  failure?: { step: S; error: string };
}

/**
 * Run the `steps` `progress` has not completed, in order, saving after each
 * one. A failing step is recorded, and reported as the error `failed` makes
 * of it; what earlier steps created is kept for inspection and reuse.
 */
export async function runPhase<S extends string>(
  record: { runner?: number },
  progress: Progress<S>,
  order: readonly S[],
  steps: Record<S, () => Promise<void>>,
  save: () => Promise<void>,
  failed: (step: S, e: DispatchError | WorldError) => Error,
) {
  for (const step of order) {
    if (progress.completed.includes(step)) continue;
    try {
      await steps[step]();
    } catch (e) {
      progress.failure = { step, error: e instanceof Error ? e.message : String(e) };
      delete record.runner;
      await save();
      // Anything but a World or Dispatch failure is a bug: kept as the failure, but still thrown.
      if (!(e instanceof DispatchError || e instanceof WorldError)) throw e;
      throw failed(step, e);
    }
    progress.completed.push(step);
    delete progress.failure;
    await save();
  }
}

function stepFailed(record: Dispatch, command: "dispatch" | "review") {
  return (step: string, e: DispatchError | WorldError) => new StepFailed(record, step, e.message, e instanceof DispatchError ? e.help : [], command);
}

/**
 * Where an agent starts: the herdr workspace, the folder it works in, the
 * folder its Harness is told to trust, and `serve`'s MCP server for the Lead.
 */
export interface AgentPlace {
  workspace: string;
  cwd: string;
  repoPath: string;
  mcp?: McpWiring;
}

/** A Dispatch's agents work in its worktree, trusting the Repo's clone. */
function placeOf(repo: Repo, record: Dispatch): AgentPlace {
  return { workspace: record.workspace!, cwd: record.worktree!, repoPath: repo.path };
}

/**
 * The steps that start an agent in a new `label` tab of a workspace, up to
 * where it is ready for its prompt. `place` is read as the steps run, once
 * earlier steps have made the workspace.
 */
export function agentSteps(world: World, harness: Harness, place: () => AgentPlace, launch: Launch, label: string) {
  let ready: boolean | undefined;
  return {
    tab: async () => {
      const { workspace, cwd } = place();
      const tab = await world.herdrTabCreate({ workspace, cwd, label });
      launch.tab = tab.tab;
      launch.pane = tab.pane;
    },
    "agent start": async () => {
      const { repoPath, mcp } = place();
      const values = { model: launch.model, effort: launch.effort, repoPath, ...(mcp && { mcp }) };
      if (harness.launchMode === "pane-command") {
        saveVariant(harness, launch.model, launch.effort);
        await world.herdrPaneRun(launch.pane!, paneCommand(harness, values));
        return;
      }
      ({ ready } = await world.herdrAgentStart({ name: launch.agent, kind: harness.kind!, pane: launch.pane!, args: launchArgs(harness, values) }));
    },
    // After a failure `ready` is unknown: the user may have answered the agent by hand.
    "agent ready": async () => {
      if (harness.launchMode === "pane-command") {
        // herdr has no kind to start it with, so it only gets its name once herdr sees it running.
        await world.herdrAgentDetect(launch.pane!, STARTUP_TIMEOUT_MS);
        await world.herdrAgentRename(launch.pane!, launch.agent);
      }
      if (!ready) await awaitReady(world, harness, launch.agent, place().cwd);
    },
  };
}

/**
 * Assign the issue to the user (ADR-0007): the `gh` session's user on GitHub,
 * the API key's owner on Linear. A failure is only a warning on a healthy Dispatch.
 */
async function claim(world: World, ref: IssueRef, record: Dispatch) {
  try {
    if (ref.number === undefined) await world.linearAssignSelf(ref.identifier);
    else await world.githubAssignSelf(ref.repo.slug, ref.number);
    record.claimed = true;
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    record.claimed = false;
    warn(record, `could not Claim ${record.issue}: ${e.message}`);
  }
}

function warn(record: Dispatch, warning: string) {
  record.warnings = [...(record.warnings ?? []), warning];
}

/**
 * The Implementer's prompt, from the config's templates: `research` for a
 * Research issue, else `implement`. When the bot's GitHub
 * App is installed on the Repo, checked afresh each time the prompt is sent,
 * the bot suffix is appended so the agent's PR and commits are attributed to
 * it. A failed check sends the plain prompt, with a warning.
 */
async function implementPrompt(world: World, templates: Prompts, repo: Repo, harness: Harness, record: Dispatch) {
  const values = { sigil: harness.sigil, issueUrl: record.url, baseBranch: baseBranch(record) };
  const text = fillTemplate(record.research ? templates.research : templates.implement, values) + (record.stackedOn
    ? ` as the top of the stacked PRs on top of ${record.stackedOn.pr.url} - check gh-stack if you are not aware of github's stacked PRs`
    : "");
  return withBotSuffix(world, templates.botSuffix, repo, text, values);
}

/**
 * `text` with the bot suffix appended when the bot's GitHub App is installed
 * on the Repo, checked afresh on every call; a failed check leaves it plain,
 * with a warning.
 */
export async function withBotSuffix(world: World, suffix: string, repo: Repo, text: string, values: Partial<Record<Placeholder, string>>) {
  let installed: boolean;
  try {
    installed = (await world.githubAppRepos()).some((slug) => sameSlug(slug, repo.slug));
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    const warning = `could not check the GitHub App on ${repo.slug}, so the prompt has no bot suffix: ${e.message}`;
    return { text, botSuffix: false, warning };
  }
  return { text: installed ? text + fillTemplate(suffix, values) : text, botSuffix: installed };
}

const STARTUP_TIMEOUT_MS = 30_000;

/** How long an agent past its startup questions may take to settle. */
const SETTLE_TIMEOUT_MS = 5_000;

/**
 * Get a started agent ready for its prompt. Answer yes when it is blocked only
 * on its Harness's trust question for the worktree we created: dispatching
 * into the Repo already trusts it. Any other question is the user's to answer.
 */
async function awaitReady(world: World, harness: Harness, agent: string, worktree: string) {
  const screen = await world.herdrAgentRead(agent);
  // Long paths wrap, so compare with all whitespace removed.
  const flat = (text: string) => text.replace(/\s+/g, "");
  const trust = harness.trustPrompt;
  if (trust && screen.includes(trust.text) && flat(screen).includes(flat(worktree))) {
    await world.herdrAgentSendKeys(agent, trust.keys);
    await world.herdrAgentWait(agent, ["idle", "done"], STARTUP_TIMEOUT_MS);
    return;
  }
  try {
    await world.herdrAgentWait(agent, ["idle", "done"], SETTLE_TIMEOUT_MS);
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    throw new DispatchError(`${agent} is blocked during startup`, [
      `Run \`herdr agent read ${agent}\` to see what it is asking, and answer it in herdr`,
    ]);
  }
}

const PROMPT_ATTEMPTS = 3;

/**
 * Prompt until the agent starts working: a Harness still drawing its UI (just
 * after a trust answer, say) drops input without an error.
 */
export async function prompt(world: World, agent: string, text: string) {
  for (let attempt = 0; attempt < PROMPT_ATTEMPTS; attempt++) {
    if ((await world.herdrAgentPrompt(agent, text)).started) return;
  }
  throw new DispatchError(`${agent} did not start working on its prompt`, [
    `Run \`herdr agent read ${agent}\` to see its screen, and send the prompt by hand`,
  ]);
}

/** Only the same request may return or resume a Dispatch (ADR-0006); other parameters are refused. */
function sameLaunch(existing: Dispatch, request: DispatchRequest) {
  const { harness, model, effort } = existing.implementer;
  if (request.repo && !sameSlug(request.repo, existing.repo)) {
    throw new DispatchError(`${existing.issue} is already In flight in ${existing.repo}`, [
      `Run \`nico-agent show ${existing.issue}\` to see the Dispatch`,
    ]);
  }
  if (request.stackOn && (!existing.stackedOn || !matchesStack(request.stackOn, existing.repo, existing.stackedOn))) {
    throw new DispatchError(`${existing.issue} is already In flight with a different stacking choice`, [
      `Run \`nico-agent show ${existing.issue}\` to see the Dispatch`,
    ]);
  }
  if (request.base) {
    if (existing.stackedOn) throw stackedBase(existing.issue);
    const base = baseBranch(existing);
    // A record from before the Base was chosen up front has none to compare.
    if (base !== undefined && base !== request.base) {
      throw new DispatchError(`${existing.issue} is already In flight with Base ${base}`, [`Run \`nico-agent show ${existing.issue}\` to see the Dispatch`]);
    }
  }
  if (harness === request.harness && model === request.model && effort === request.effort) return;
  throw new DispatchError(`${existing.issue} is already In flight with ${harness} ${model} ${effort}`, [
    `Run \`nico-agent show ${existing.issue}\` to see the Dispatch`,
  ]);
}

/** A local issue number, issue reference/URL, Linear identifier/URL, or an exact PR URL naming what a Dispatch stacked on. */
function matchesStack(choice: string, repo: string, target: StackTarget) {
  const url = choice.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/i);
  const key = /^\d+$/.test(choice) ? `${repo}#${choice}` : url ? `${url[1]}#${url[2]}` : linearIdentifier(choice) ?? choice;
  return (target.issue !== undefined && sameSlug(key, target.issue)) || sameSlug(choice, target.pr.url);
}

/** A Dispatch's Base without the remote prefix; unset only on a record from before the fetch step chose it. */
export function baseBranch(dispatch: Dispatch) {
  return dispatch.base?.replace(/^origin\//, "");
}

function alreadyInFlight(key: string) {
  return new DispatchError(`${key} is already In flight`, [`Run \`nico-agent show ${key}\` to see the Dispatch`]);
}

/** The name part of a Repo's `owner/name` slug. */
export function repoName(repo: Repo) {
  return repo.slug.split("/")[1]!;
}

const MAX_AGENT_NAME = 32;

/** `<role>-<repo>-<n>` (or `-<ble-27>` for Linear) within herdr's `[a-z][a-z0-9_-]{0,31}`, keeping the issue's number or identifier. */
function agentName(role: string, repoName: string, ref: IssueRef) {
  const suffix = `-${ref.identifier?.toLowerCase() ?? ref.number}`;
  const room = MAX_AGENT_NAME - role.length - 1 - suffix.length;
  const repo = repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, Math.max(room, 0));
  return `${role}-${repo}${suffix}`.slice(0, MAX_AGENT_NAME);
}
