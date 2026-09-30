import { type Prompts, type Repo, fillTemplate, findRepo, loadConfig, prompts } from "./config";
import { type Harness, harnessCatalog, harnesses, launchArgs } from "./harness";
import { sameSlug } from "./slug";
import { type Dispatch, type Step, STEPS, addDispatch, findDispatch, leaseDispatch, saveDispatch } from "./state";
import { type World, WorldError } from "./world";

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
}

export interface IssueRef {
  repo: Repo;
  number: number;
  /** `owner/repo#N` with the Repo's configured slug: the Dispatch key. */
  key: string;
}

/** Resolve `owner/repo#N` or a GitHub issue URL to a configured Repo's issue. */
export function resolveIssue(configDir: string, ref: string): IssueRef {
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

/** A step of a Dispatch failed; the Dispatch is kept, Failed at `step`, to be resumed. */
export class StepFailed extends DispatchError {
  constructor(
    readonly dispatch: Dispatch,
    readonly step: Step,
    message: string,
    help: string[],
  ) {
    super(message, [
      ...help,
      `Run \`nico-agent show ${dispatch.issue}\` to see the Dispatch`,
      `Run the same \`nico-agent dispatch\` again to resume from ${step}`,
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
 * Dispatch an issue: fetch the clone, create a worktree workspace on the
 * default branch, start the Implementer in an `implementer` tab, prompt it
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

  const name = repoName(repo);
  const now = world.now().toISOString();
  const record: Dispatch = {
    issue: key,
    title: issue.title,
    url: `https://github.com/${repo.slug}/issues/${number}`,
    repo: repo.slug,
    branch: `agent/${name}-${number}`,
    implementer: { agent: agentName("impl", name, number), harness: harness.name, model: request.model, effort: request.effort },
    completed: [],
    runner: world.processId(),
    createdAt: now,
    updatedAt: now,
  };
  // Recorded before any side effect, so a concurrent dispatch of the issue finds it.
  if (!(await addDispatch(configDir, record))) throw alreadyInFlight(key);
  return { dispatch: await runSteps(world, configDir, ref, harness, templates, record), outcome: "new" };
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
 * Whether a re-run may take over a Dispatch: nobody is running its steps (its
 * runner exited, or was killed mid-step) and something is left to do.
 */
function isResumable(world: World, dispatch: Dispatch) {
  if (dispatch.runner !== undefined && world.processAlive(dispatch.runner)) return false;
  return dispatch.failure !== undefined || dispatch.completed.length < STEPS.length || dispatch.claimed === undefined;
}

/**
 * Run the steps `record` has not completed, saving it after each one, as the
 * runner of a Dispatch that holds its lease. A failing step is recorded and
 * reported as StepFailed; what earlier steps created is kept for inspection
 * and reuse. The lease is released however the run ends.
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
  const save = () => {
    record.updatedAt = world.now().toISOString();
    return saveDispatch(configDir, record);
  };
  const { agent } = record.implementer;
  let ready: boolean | undefined;
  const steps: Record<Step, () => Promise<void>> = {
    fetch: async () => {
      await world.gitFetch(repo.path);
      record.base = `origin/${await world.gitDefaultBranch(repo.path)}`;
    },
    worktree: async () => {
      const label = `${repoName(repo)}#${number}`;
      const worktree = await world.herdrWorktreeCreate({ cwd: repo.path, branch: record.branch, base: record.base!, label });
      record.worktree = worktree.path;
      record.workspace = worktree.workspace;
    },
    tab: async () => {
      const tab = await world.herdrTabCreate({ workspace: record.workspace!, cwd: record.worktree!, label: "implementer" });
      record.implementer.tab = tab.tab;
      record.implementer.pane = tab.pane;
    },
    "agent start": async () => {
      const { model, effort } = record.implementer;
      ({ ready } = await world.herdrAgentStart({
        name: agent,
        kind: harness.kind,
        pane: record.implementer.pane!,
        args: launchArgs(harness, model, effort),
      }));
    },
    // After a failure `ready` is unknown: the user may have answered the agent by hand.
    "agent ready": async () => {
      if (!ready) await awaitReady(world, harness, agent, record.worktree!);
    },
    prompt: async () => {
      const { text, botSuffix, warning } = await implementPrompt(world, templates, ref.repo, harness, record);
      await prompt(world, agent, text);
      record.botSuffix = botSuffix;
      if (warning) warn(record, warning);
    },
  };

  try {
    for (const step of STEPS) {
      if (record.completed.includes(step)) continue;
      try {
        await steps[step]();
      } catch (e) {
        record.failure = { step, error: e instanceof Error ? e.message : String(e) };
        delete record.runner;
        await save();
        // Anything but a World or Dispatch failure is a bug: kept as the failure, but still thrown.
        if (!(e instanceof DispatchError || e instanceof WorldError)) throw e;
        throw new StepFailed(record, step, e.message, e instanceof DispatchError ? e.help : []);
      }
      record.completed.push(step);
      delete record.failure;
      await save();
    }
    if (record.claimed === undefined) await claim(world, repo, number, record);
  } finally {
    if (record.runner !== undefined) {
      delete record.runner;
      await save();
    }
  }
  return record;
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
  const values = { sigil: harness.sigil, issueUrl: record.url };
  const text = fillTemplate(templates.implement, values);
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
  if (harness === request.harness && model === request.model && effort === request.effort) return;
  throw new DispatchError(`${existing.issue} is already In flight with ${harness} ${model} ${effort}`, [
    `Run \`nico-agent show ${existing.issue}\` to see the Dispatch`,
  ]);
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
