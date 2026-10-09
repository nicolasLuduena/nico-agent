import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GARDENER_DEFAULTS, type LaunchDefaults, type Repo, fillTemplate, findRepo, loadConfig, prompts } from "./config";
import { type Progress, agentSteps, chooseLaunch, prompt, repoName, runPhase, withBotSuffix } from "./dispatch";
import { DispatchError, LaunchError } from "./dispatch-error";
import type { Harness } from "./harness";
import { sameSlug } from "./slug";
import type { Launch } from "./state";
import { withFileLock, writeJsonAtomic } from "./state";
import { type World, WorldError } from "./world";

/** The steps that start a Gardener, in order: a Dispatch's, on a worktree of its own. */
export const GARDEN_STEPS = ["fetch", "worktree", "tab", "agent start", "agent ready", "prompt"] as const;
export type GardenStep = (typeof GARDEN_STEPS)[number];

/** A PR the Gardener is sent to tend, and what happened to it. */
export type GardenPr =
  | { url: string; happened: "merged below"; below: string; newBase: string }
  | { url: string; happened: "conflict"; base: string };

/**
 * The local record of a Repo's Gardener (ADR-0002), like a Dispatch's: where
 * it runs, how it was launched, the PRs it was sent to, and how far its steps
 * got. It has no issue, so it is kept by its Repo, one at a time.
 */
export interface Gardener extends Progress<GardenStep> {
  repo: string;
  branch: string;
  base: string;
  worktree?: string;
  workspace?: string;
  agent: Launch;
  /** The PRs named in its prompt; empty for every PR of the Repo that needs it. */
  prs: GardenPr[];
  /** Whether the prompt carried the Bot suffix. */
  botSuffix?: boolean;
  warnings?: string[];
  /** Id of the process running the steps, while one is. */
  runner?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GardenRequest {
  repo: string;
  /** The PRs to tend, by URL or number; none for every one that needs it. */
  prs: string[];
}

export interface GardenStart {
  gardener: Gardener;
  /** `new`, `existing` for a no-op while it runs, or `resumed` from the step that failed or was cut short. */
  outcome: "new" | "existing" | "resumed";
  resumedFrom?: GardenStep;
}

const FILE = "gardeners.json";

/** Whether a Gardener with this Agent state has stopped, or is gone from herdr (undefined). */
function isFinished(state: string | undefined) {
  return state === undefined || state === "idle" || state === "done";
}

/** Every Gardener's record, by Repo. */
export function loadGardeners(configDir: string): Gardener[] {
  return Object.values(read(configDir));
}

function read(configDir: string): Record<string, Gardener> {
  try {
    return JSON.parse(readFileSync(join(configDir, FILE), "utf8")) as Record<string, Gardener>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

/** The configured Repo `slug` names, or a refusal. */
export function gardenRepo(configDir: string, slug: string): Repo {
  const repo = findRepo(loadConfig(configDir), slug);
  if (!repo) throw new DispatchError(`${slug} is not a configured Repo`, ["Run `nico-agent repo list` to see the Repos"]);
  return repo;
}

/**
 * Start a Gardener in a Repo: fetch the clone, create a worktree workspace on
 * the Repo's Base, start the agent on the `gardener` launch from config in a
 * `gardener` tab, and prompt it with the `garden` prompt naming the PRs and
 * its Bot suffix. One per Repo, idempotent (ADR-0006): while one runs a second
 * start returns it, a failed start is resumed from its step, and a finished
 * one is removed and a new one started.
 */
export async function garden(world: World, configDir: string, request: GardenRequest): Promise<GardenStart> {
  const repo = gardenRepo(configDir, request.repo);
  const launch = gardenerLaunch(configDir);
  const harness = await chooseGardenerHarness(world, configDir, launch);
  let removed = false;
  const existing = read(configDir)[repo.slug];
  if (existing && isStarted(existing)) {
    const agents = await world.herdrAgents();
    // The running one is returned as is, without asking GitHub about the PRs (ADR-0006).
    if (!isFinished(agents.find((a) => a.name === existing.agent.agent)?.state)) return { gardener: existing, outcome: "existing" };
    removed = await removeGardener(world, configDir, existing);
  }
  const fresh = async (): Promise<Gardener> => {
    const now = world.now();
    const name = repoName(repo);
    return {
      repo: repo.slug,
      branch: `gardener/${name}-${now.toISOString().replace(/\D/g, "").slice(0, 14)}`,
      base: `origin/${repo.base ?? (await world.gitDefaultBranch(repo.path))}`,
      agent: { agent: agentName(name), ...launch },
      prs: await gardenPrs(world, repo, request.prs),
      completed: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  };
  const leased = await lease(world, configDir, repo.slug, removed || !existing ? await fresh() : undefined);
  if (!leased.created) {
    const record = leased.record;
    const resumedFrom = record.failure?.step ?? GARDEN_STEPS.find((s) => !record.completed.includes(s))!;
    return { gardener: await runGardener(world, configDir, repo, harness, record), outcome: "resumed", resumedFrom };
  }
  return { gardener: await runGardener(world, configDir, repo, harness, leased.record), outcome: "new" };
}

/**
 * Remove the workspace of each Gardener whose agent has finished (its Agent
 * state idle or done, or gone from herdr) and forget it, as `advance` Closes
 * a finished Dispatch. A failed or unfinished start is kept to be resumed.
 * Returns the Repos whose Gardener was removed.
 */
export async function removeFinishedGardeners(world: World, configDir: string): Promise<string[]> {
  const started = loadGardeners(configDir).filter(isStarted);
  if (!started.length) return [];
  const states = new Map((await world.herdrAgents()).map((a) => [a.name, a.state]));
  const removed: string[] = [];
  for (const gardener of started) {
    if (!isFinished(states.get(gardener.agent.agent))) continue;
    if (await removeGardener(world, configDir, gardener)) removed.push(gardener.repo);
  }
  return removed;
}

/** Each Gardener as the Board shows it, with its Agent state; `unknown` when herdr can't be asked. */
export async function gardenerRows(world: World, configDir: string) {
  const gardeners = loadGardeners(configDir);
  if (!gardeners.length) return [];
  const states = await world.herdrAgents().then(
    (agents) => new Map(agents.map((a) => [a.name, a.state])),
    (e) => {
      if (!(e instanceof WorldError)) throw e;
      return new Map<string, string>();
    },
  );
  return gardeners.map((g) => ({ gardener: g, state: states.get(g.agent.agent) ?? "unknown" }));
}

/** Whether every step ran and none failed, so the agent was prompted. */
function isStarted(gardener: Gardener) {
  return gardener.completed.length === GARDEN_STEPS.length && !gardener.failure;
}

/** The `gardener` launch from config, each choice it leaves unset taken from GARDENER_DEFAULTS. */
function gardenerLaunch(configDir: string): LaunchDefaults {
  const { gardener = {} } = loadConfig(configDir);
  return { ...GARDENER_DEFAULTS, ...gardener };
}

/** The launch's Harness, once valid; a bad choice is named as the config's fault, or the defaults'. */
async function chooseGardenerHarness(world: World, configDir: string, launch: LaunchDefaults): Promise<Harness> {
  try {
    return await chooseLaunch(world, configDir, launch);
  } catch (e) {
    if (!(e instanceof LaunchError)) throw e;
    const set = loadConfig(configDir).gardener?.[e.key] !== undefined;
    const where = `gardener.${e.key} ${set ? "in" : "defaults to"} ${set ? join(configDir, "config.json") : `\`${GARDENER_DEFAULTS[e.key]}\``}`;
    throw new DispatchError(`${where}: ${e.message}`, [
      ...e.help,
      `Set "gardener": {"harness": ..., "model": ..., "effort": ...} in ${join(configDir, "config.json")}`,
    ]);
  }
}

/** The PRs as the `garden` prompt names them, each with what happened to it. */
export function describePrs(repo: string, prs: GardenPr[]) {
  if (!prs.length) return `every open PR of ${repo} that conflicts with its base, or whose PR below it merged`;
  return prs.map((pr) => pr.happened === "merged below"
    ? `${pr.url} (the PR below it, ${pr.below}, merged; its new base is ${pr.newBase})`
    : `${pr.url} (it conflicts with its base ${pr.base})`).join("; ");
}

/** Run the steps `record` has not completed, as the runner holding its lease. */
async function runGardener(world: World, configDir: string, repo: Repo, harness: Harness, record: Gardener) {
  const steps: Record<GardenStep, () => Promise<void>> = {
    fetch: async () => {
      await world.gitFetch(repo.path);
    },
    worktree: async () => {
      const worktree = await world.herdrWorktreeCreate({ cwd: repo.path, branch: record.branch, base: record.base, label: `${repoName(repo)}:gardener` });
      record.worktree = worktree.path;
      record.workspace = worktree.workspace;
    },
    ...agentSteps(world, harness, () => ({ workspace: record.workspace!, cwd: record.worktree!, repoPath: repo.path }), record.agent, "gardener"),
    prompt: async () => {
      const templates = prompts(loadConfig(configDir));
      const values = { sigil: harness.sigil, repo: repo.slug, prs: describePrs(repo.slug, record.prs) };
      const { text, botSuffix, warning } = await withBotSuffix(world, templates.gardenBotSuffix, repo, fillTemplate(templates.garden, values), values);
      await prompt(world, record.agent.agent, text);
      record.botSuffix = botSuffix;
      if (warning) record.warnings = [...(record.warnings ?? []), warning];
    },
  };
  const save = () => saveGardener(world, configDir, record);
  try {
    await runPhase(record, record, GARDEN_STEPS, steps, save, (step, e) =>
      new DispatchError(`the Gardener of ${repo.slug} failed at ${step}: ${e.message}`, [
        ...(e instanceof DispatchError ? e.help : []),
        "Run `nico-agent --json` to see the Gardeners",
        `Run \`nico-agent garden ${repo.slug}\` again to resume from ${step}`,
      ]));
  } finally {
    if (record.runner !== undefined) {
      delete record.runner;
      await save();
    }
  }
  return record;
}

/** Remove a Gardener's worktree and workspace and forget it; false when another process holds it. */
async function removeGardener(world: World, configDir: string, gardener: Gardener): Promise<boolean> {
  const held = await withFileLock(configDir, FILE, () => {
    const now = read(configDir)[gardener.repo];
    return now?.runner !== undefined && now.runner !== world.processId() && world.processAlive(now.runner);
  });
  if (held) return false;
  if (gardener.workspace) await world.herdrWorktreeRemove(gardener.workspace);
  await withFileLock(configDir, FILE, () => {
    const all = read(configDir);
    delete all[gardener.repo];
    writeJsonAtomic(join(configDir, FILE), all);
  });
  return true;
}

/**
 * Take over the Repo's Gardener record for this process: the existing one,
 * or `fresh` when there is none (or it was just removed). Refused while
 * another live process runs its steps.
 */
async function lease(world: World, configDir: string, slug: string, fresh?: Gardener): Promise<{ record: Gardener; created: boolean }> {
  return withFileLock(configDir, FILE, () => {
    const all = read(configDir);
    const existing = all[slug];
    if (existing?.runner !== undefined && existing.runner !== world.processId() && world.processAlive(existing.runner)) {
      throw new DispatchError(`the Gardener of ${slug} is busy with another nico-agent`, ["Try again once it is done"]);
    }
    const record = existing ?? fresh;
    if (!record) throw new Error(`no Gardener of ${slug} to lease`);
    record.runner = world.processId();
    all[slug] = record;
    writeJsonAtomic(join(configDir, FILE), all);
    return { record, created: !existing };
  });
}

async function saveGardener(world: World, configDir: string, record: Gardener) {
  record.updatedAt = world.now().toISOString();
  await withFileLock(configDir, FILE, () => {
    const all = read(configDir);
    all[record.repo] = record;
    writeJsonAtomic(join(configDir, FILE), all);
  });
}

const MAX_AGENT_NAME = 32;

/** `garden-<repo>` within herdr's `[a-z][a-z0-9_-]{0,31}`: herdr names are unique, so one per Repo. */
function agentName(repoName: string) {
  return `garden-${repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`.slice(0, MAX_AGENT_NAME);
}

/** Whether `url` is a PR of the Repo `slug`, and its number. */
export function prNumber(slug: string, url: string): number | null {
  const match = url.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/i);
  if (match) return sameSlug(match[1]!, slug) ? Number(match[2]) : null;
  return /^#?\d+$/.test(url) ? Number(url.replace("#", "")) : null;
}

/**
 * The PRs of `repo` named by URL or number, each with what happened to it:
 * the PR its base branch was the head of merged, so it needs rebasing onto
 * that PR's base; else it conflicts with its base. Each must be open.
 */
export async function gardenPrs(world: World, repo: Repo, refs: string[]): Promise<GardenPr[]> {
  const prs: GardenPr[] = [];
  for (const ref of refs) {
    const number = prNumber(repo.slug, ref);
    if (number === null) {
      throw new DispatchError(`\`${ref}\` is not a PR of ${repo.slug}`, [`Pass --pr a PR URL, such as https://github.com/${repo.slug}/pull/12`], true);
    }
    const pr = await world.githubPullRequest(repo.slug, number);
    if (!pr) throw new DispatchError(`${repo.slug}#${number} is not a PR on GitHub`, [`Check the PR number on https://github.com/${repo.slug}/pulls`]);
    if (pr.state !== "open") throw new DispatchError(`${pr.url} is ${pr.state}; the Gardener tends open PRs only`, [`Run \`nico-agent garden ${repo.slug}\` without it`]);
    const below = (await world.githubBranchPullRequests(repo.slug, pr.baseBranch)).find((p) => p.state === "merged");
    prs.push(below
      ? { url: pr.url, happened: "merged below", below: below.url, newBase: below.baseBranch }
      : { url: pr.url, happened: "conflict", base: pr.baseBranch });
  }
  return prs;
}
