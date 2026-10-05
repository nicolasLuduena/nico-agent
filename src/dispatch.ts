import { type Prompts, type Repo, fillTemplate, findRepo, loadConfig, prompts } from "./config";
import { type Harness, harnessCatalog, harnesses, launchArgs, rememberLaunch, rememberedLaunches } from "./harness";
import { linearIdentifier } from "./linear";
import { sameSlug } from "./slug";
import { freshPrs, isReviewLaunched, issueNumber, linkedPr } from "./stage";
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
import { type World, WorldError } from "./world";
import { baseChoice, canStart, stackChoice, stackOptions, type StackOption } from "./board";

const DISPATCH_HINT = "nico-agent dispatch <issue> --harness <harness> --model <model> --effort <effort>";

/** A request the user can fix; `usage` marks a malformed one (CLI exit 2). */
export class DispatchError extends Error {
  constructor(
    message: string,
    readonly help: string[],
    readonly usage = false,
  ) {
    super(message);
  }
}

export interface DispatchRequest {
  issue: string;
  harness: string;
  model: string;
  effort: string;
  /** Blocker issue reference to stack on; omitted when there is a single option. */
  stackOn?: string;
  /** Branch on origin to use as the Base; omitted for the last one used in the Repo, else the default branch. */
  base?: string;
}

export interface IssueRef {
  repo: Repo;
  number: number;
  /** `owner/repo#N` with the Repo's configured slug: the Dispatch key. */
  key: string;
}

/** Resolve `owner/repo#N` or a GitHub issue URL to a configured Repo's issue. */
export function resolveIssue(configDir: string, ref: string): IssueRef {
  const identifier = linearIdentifier(ref);
  if (identifier) {
    throw new DispatchError(`Linear issue ${identifier} is recognized; Linear dispatch and review are not supported yet`, ["Open the issue in Linear; dispatch support follows in #14"]);
  }
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
  const ref = resolveIssue(configDir, request.issue);
  const { repo, number, key } = ref;
  const templates = prompts(loadConfig(configDir));
  const existing = findDispatch(configDir, key);
  if (existing) {
    sameLaunch(existing, request);
    const leased = await leaseDispatch(configDir, key, world.processId(), (d) => isResumable(world, d));
    if (!leased) return { dispatch: findDispatch(configDir, key) ?? existing, outcome: "existing" };
    const resumedFrom = leased.failure?.step ?? STEPS.find((s) => !leased.completed.includes(s)) ?? "claim";
    return { dispatch: await runSteps(world, configDir, ref, harness, templates, leased), outcome: "resumed", resumedFrom };
  }

  const issue = await world.githubIssue(repo.slug, number);
  if (!issue) throw new DispatchError(`${key} was not found on GitHub`, [`Check the issue number on https://github.com/${repo.slug}/issues`]);
  if (issue.state !== "open") throw new DispatchError(`${key} is closed`, ["Run `nico-agent` to see the Ready issues"]);
  let stackedOn: StackOption | undefined;
  if (issue.blockers.some((b) => b.state === "open")) {
    if (!canStart(issue, await world.githubViewer())) {
      throw new DispatchError(`${key} is not Stackable`, ["Run `nico-agent` to see the Board"]);
    }
    const options = await stackOptions(world, repo.slug, issue);
    const help = options.map((o) => `Stack on ${o.pr.url} with \`--stack-on ${stackChoice(o, options)}\``);
    if (!options.length) throw new DispatchError(`${key} has open Blockers without same-Repo open PRs`, ["Run `nico-agent` to see the Board"]);
    const selected = request.stackOn ? options.filter((o) => matchesStack(request.stackOn!, repo.slug, o)) : options;
    if (selected.length !== 1) throw new DispatchError(`${key} needs a unique Blocker choice with --stack-on`, help);
    stackedOn = selected[0];
  } else if (request.stackOn) {
    throw new DispatchError(`${key} has no open Blockers to stack on`, ["Dispatch it without `--stack-on`"]);
  }
  const base = await chooseBase(world, configDir, ref, request, stackedOn);

  const name = repoName(repo);
  const now = world.now().toISOString();
  const record: Dispatch = {
    issue: key,
    title: issue.title,
    url: `https://github.com/${repo.slug}/issues/${number}`,
    repo: repo.slug,
    ...(stackedOn && { stackedOn }),
    branch: `agent/${name}-${number}`,
    base: `origin/${base}`,
    implementer: { agent: agentName("impl", name, number), harness: harness.name, model: request.model, effort: request.effort },
    completed: [],
    runner: world.processId(),
    createdAt: now,
    updatedAt: now,
  };
  // Recorded before any side effect, so a concurrent dispatch of the issue finds it.
  if (!(await addDispatch(configDir, record))) throw alreadyInFlight(key);
  rememberLaunch(configDir, harness.name, request.model, request.effort, stackedOn ? undefined : { repo: repo.slug, branch: base });
  return { dispatch: await runSteps(world, configDir, ref, harness, templates, record), outcome: "new" };
}

export class CloseConfirmationRequired extends DispatchError {
  constructor(readonly issue: string) {
    super(`${issue} has an open PR or no linked PR; closing requires confirmation`, [
      `Run \`nico-agent close ${issue} --confirm\` to remove its workspace and forget the Dispatch`,
    ]);
  }
}

/** Remove a Dispatch's workspace before forgetting it, holding the same lease as launches. */
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
        world.githubLinkedPullRequests(record.repo, issueNumber(record)),
        world.githubBranchPullRequests(record.repo, record.branch),
      ]);
      const pr = linkedPr([...linked, ...branch], record.repo);
      if (!pr || pr.state === "open") throw new CloseConfirmationRequired(key);
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
  const ref = resolveIssue(configDir, request.issue);
  const { key } = ref;
  const templates = prompts(loadConfig(configDir));
  const existing = findDispatch(configDir, key);
  if (!existing) throw new DispatchError(`${key} is not In flight`, [`Run \`${DISPATCH_HINT}\` to dispatch it first`]);
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
    agent: agentName("rev", repoName(ref.repo), ref.number),
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
    ...agentSteps(world, harness, ref.repo, record, reviewer, "reviewer"),
    prompt: async () => {
      const values = { sigil: harness.sigil, issueUrl: record.url, baseBranch: baseBranch(record), prUrl: reviewer.prUrl, prBaseBranch: reviewer.prBase };
      await prompt(world, reviewer.agent, fillTemplate(templates.review, values));
    },
  };
  await runLeased(world, configDir, record, (save) => runPhase(record, reviewer, REVIEW_STEPS, steps, save, "review"));
  return record;
}

/**
 * The Harness of a request, once its model is one of the Harness's and its
 * Effort one that model supports. Which models and Efforts are valid comes
 * from config and discovery, so only an unknown Harness or model is a usage
 * error; an Effort the model does not support fails like a Source would.
 */
async function chooseLaunch(world: World, configDir: string, request: DispatchRequest): Promise<Harness> {
  const catalog = await harnessCatalog(world, configDir, request.harness);
  if (!catalog) {
    const names = harnesses(configDir).map((h) => h.name);
    throw new DispatchError(`unknown Harness \`${request.harness}\``, [`Valid Harnesses: ${names.join(", ")}`], true);
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
    throw new DispatchError(`unknown model \`${request.model}\` for ${harness.name}`, [
      `Valid models for ${harness.name}: ${models.map((m) => m.model).join(", ")}`,
    ], true);
  }
  if (!choice.efforts.includes(request.effort)) {
    const launch = `${harness.name} ${choice.model}`;
    throw new DispatchError(`Effort \`${request.effort}\` is not valid for ${launch}`, [
      `Valid Efforts for ${launch}: ${choice.efforts.join(", ")}`,
    ]);
  }
  return harness;
}

/**
 * The Base of a new Dispatch, without the remote prefix. A Stacked dispatch's
 * is its Blocker's PR head branch, with no choice. Otherwise it is the
 * requested branch, which origin must have, else the last one used in the
 * Repo while origin still has it, else origin's default branch.
 */
async function chooseBase(world: World, configDir: string, { repo, key }: IssueRef, request: DispatchRequest, stackedOn?: StackOption) {
  if (stackedOn) {
    if (request.base) throw stackedBase(key);
    return stackedOn.pr.headBranch;
  }
  const { branches, selected } = await baseChoice(world, repo, request.base ?? rememberedLaunches(configDir).bases[repo.slug]);
  if (request.base && selected !== request.base) {
    throw new DispatchError(`\`${request.base}\` is not a branch on origin of ${repo.slug}`, [
      `Pass \`--base\` one of origin's branches: ${branches.join(", ")}`,
    ]);
  }
  return selected;
}

function stackedBase(key: string) {
  return new DispatchError(`${key} is Stacked; its Base is its Blocker's PR head branch`, ["Dispatch it without `--base`"]);
}

/**
 * Whether a re-run may take over a Dispatch: nobody is running its steps (its
 * runner exited, or was killed mid-step) and something is left to do.
 */
function isResumable(world: World, dispatch: Dispatch) {
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
  const { repo, number } = ref;
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
      const label = `${repoName(repo)}#${number}`;
      const worktree = await world.herdrWorktreeCreate({ cwd: repo.path, branch: record.branch, base: record.base!, label });
      record.worktree = worktree.path;
      record.workspace = worktree.workspace;
    },
    ...agentSteps(world, harness, repo, record, record.implementer, "implementer"),
    prompt: async () => {
      const { text, botSuffix, warning } = await implementPrompt(world, templates, ref.repo, harness, record);
      await prompt(world, record.implementer.agent, text);
      record.botSuffix = botSuffix;
      if (warning) warn(record, warning);
    },
  };
  await runLeased(world, configDir, record, async (save) => {
    await runPhase(record, record, STEPS, steps, save, "dispatch");
    if (record.claimed === undefined) await claim(world, repo, number, record);
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

/** How far an agent's steps got: the Dispatch itself for the Implementer, the Reviewer for a review. */
interface Progress<S extends string> {
  completed: S[];
  failure?: { step: S; error: string };
}

/**
 * Run the `steps` `progress` has not completed, in order, saving after each
 * one. A failing step is recorded and reported as StepFailed; what earlier
 * steps created is kept for inspection and reuse.
 */
async function runPhase<S extends string>(
  record: Dispatch,
  progress: Progress<S>,
  order: readonly S[],
  steps: Record<S, () => Promise<void>>,
  save: () => Promise<void>,
  command: "dispatch" | "review",
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
      throw new StepFailed(record, step, e.message, e instanceof DispatchError ? e.help : [], command);
    }
    progress.completed.push(step);
    delete progress.failure;
    await save();
  }
}

/**
 * The steps that start an agent in a new `label` tab of the Dispatch's
 * workspace, up to where it is ready for its prompt.
 */
function agentSteps(world: World, harness: Harness, repo: Repo, record: Dispatch, launch: Launch, label: string) {
  let ready: boolean | undefined;
  return {
    tab: async () => {
      const tab = await world.herdrTabCreate({ workspace: record.workspace!, cwd: record.worktree!, label });
      launch.tab = tab.tab;
      launch.pane = tab.pane;
    },
    "agent start": async () => {
      const { model, effort } = launch;
      ({ ready } = await world.herdrAgentStart({
        name: launch.agent,
        kind: harness.kind,
        pane: launch.pane!,
        args: launchArgs(harness, { model, effort, repoPath: repo.path }),
      }));
    },
    // After a failure `ready` is unknown: the user may have answered the agent by hand.
    "agent ready": async () => {
      if (!ready) await awaitReady(world, harness, launch.agent, record.worktree!);
    },
  };
}

/** Assign the issue to the user (ADR-0007); a failure is only a warning on a healthy Dispatch. */
async function claim(world: World, repo: Repo, number: number, record: Dispatch) {
  try {
    await world.githubAssignSelf(repo.slug, number);
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
 * The Implementer's prompt, from the config's templates. When the bot's GitHub
 * App is installed on the Repo, checked afresh each time the prompt is sent,
 * the bot suffix is appended so the agent's PR and commits are attributed to
 * it. A failed check sends the plain prompt, with a warning.
 */
async function implementPrompt(world: World, templates: Prompts, repo: Repo, harness: Harness, record: Dispatch) {
  const values = { sigil: harness.sigil, issueUrl: record.url, baseBranch: baseBranch(record) };
  const text = fillTemplate(templates.implement, values) + (record.stackedOn
    ? ` as the top of the stacked PRs on top of ${record.stackedOn.pr.url} - check gh-stack if you are not aware of github's stacked PRs`
    : "");
  let installed: boolean;
  try {
    installed = (await world.githubAppRepos()).some((slug) => sameSlug(slug, repo.slug));
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    const warning = `could not check the GitHub App on ${repo.slug}, so the prompt has no bot suffix: ${e.message}`;
    return { text, botSuffix: false, warning };
  }
  return { text: installed ? text + fillTemplate(templates.botSuffix, values) : text, botSuffix: installed };
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
async function prompt(world: World, agent: string, text: string) {
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

/** A local Blocker number, issue reference/URL, or an exact PR URL. */
function matchesStack(choice: string, repo: string, option: StackOption) {
  const url = choice.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/i);
  const key = /^\d+$/.test(choice) ? `${repo}#${choice}` : url ? `${url[1]}#${url[2]}` : choice;
  return sameSlug(key, option.blocker) || sameSlug(choice, option.pr.url);
}

/** A Dispatch's Base without the remote prefix; unset only on a record from before the fetch step chose it. */
export function baseBranch(dispatch: Dispatch) {
  return dispatch.base?.replace(/^origin\//, "");
}

function alreadyInFlight(key: string) {
  return new DispatchError(`${key} is already In flight`, [`Run \`nico-agent show ${key}\` to see the Dispatch`]);
}

/** The name part of a Repo's `owner/name` slug. */
function repoName(repo: Repo) {
  return repo.slug.split("/")[1]!;
}

const MAX_AGENT_NAME = 32;

/** `<role>-<repo>-<n>` within herdr's `[a-z][a-z0-9_-]{0,31}`, keeping the number. */
function agentName(role: string, repoName: string, number: number) {
  const suffix = `-${number}`;
  const room = MAX_AGENT_NAME - role.length - 1 - suffix.length;
  const repo = repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, Math.max(room, 0));
  return `${role}-${repo}${suffix}`.slice(0, MAX_AGENT_NAME);
}
