import { DEFAULT_RUNNING_SPECS, type LinearSelector, type Repo } from "./config";
import { type InFlightRow, type PrLookup, linearPullRequests, linkedPr, loadInFlight } from "./stage";
import { type IssueFacts, type RepoDecision, type RepoFacts, type SpecFacts, decideSpecs } from "./spec";
import type { Dispatch } from "./state";
import type { GitHubIssue, LinearIssue, World } from "./world";
import { READY_LABEL, WorldError } from "./world";
import { sameSlug } from "./slug";
import { linearIdentifier } from "./linear";
import type { PullRequest } from "./world";

export interface StackOption {
  blocker: string;
  pr: PullRequest & { headBranch: string };
}

export type StackableIssue = BoardIssue & {
  blockers: StackOption[];
};

/** A Blocker names its sole PR; several PRs need an exact URL. */
export function stackChoice(option: StackOption, options: StackOption[]) {
  return options.filter((other) => sameSlug(other.blocker, option.blocker)).length > 1 ? option.pr.url : option.blocker;
}

export type BoardIssue = {
  repo: string;
  title: string;
  url: string;
  /** For a Ready issue, the Base its dispatch would start from; unset when origin's branches could not be listed. */
  base?: string;
} & ({ number: number; identifier?: never } | { identifier: string; number?: never });

export interface Board {
  ready: BoardIssue[];
  /** Each Repo's Specs as the Spec rules decide them; Repos without Specs are left out. */
  specs: RepoDecision[];
  stackable: StackableIssue[];
  inFlight: InFlightRow[];
  /** The Base choice of each Repo with Ready issues, by slug. */
  bases: Record<string, BaseChoice>;
  /** `git` errors are about listing origin's branches; the Repo's issues still loaded. */
  errors: { repo: string; error: string; source?: "Linear" | "git" }[];
}

/** origin's branches, and the Base a dispatch starts from unless another is chosen. */
export interface BaseChoice {
  branches: string[];
  selected: string;
}

/** A Repo's Base choice: `wanted` while origin has it, else origin's default branch. */
export async function baseChoice(world: World, repo: Repo, wanted?: string): Promise<BaseChoice> {
  const branches = await world.gitRemoteBranches(repo.path);
  const selected = wanted && branches.includes(wanted) ? wanted : await world.gitDefaultBranch(repo.path);
  return { branches, selected };
}

/**
 * Ready: open, labelled `ready-for-agent`, unassigned or assigned only to the
 * user, and every Blocker closed.
 */
export function isReady(issue: GitHubIssue, viewer: string) {
  return (
    canStart(issue, viewer) &&
    issue.blockers.every((blocker) => blocker.state === "closed")
  );
}

export function canStart(issue: GitHubIssue, viewer: string) {
  return issue.state === "open" && issue.labels.includes(READY_LABEL) &&
    issue.assignees.every((login) => login.toLowerCase() === viewer.toLowerCase());
}

/** Each unresolved Blocker of an issue, with its open PRs whose head can be fetched from a Repo. */
export interface BlockerPrs {
  blocker: string;
  prs: (PullRequest & { headBranch: string })[];
}

/** Each open Blocker of a GitHub issue, with its open PRs in `repo`. */
export async function blockerPrs(world: World, repo: string, issue: GitHubIssue): Promise<BlockerPrs[]> {
  const blockers = issue.blockers.filter((b) => b.state === "open");
  return Promise.all(blockers.map(async (b) => ({
    blocker: `${b.slug}#${b.number}`,
    prs: stackable(await world.githubLinkedPullRequests(b.slug, b.number), repo),
  })));
}

/** Each unresolved Blocker of a Linear issue, with its open PRs attached in `repo`. */
export async function linearBlockerPrs(world: World, repo: string, issue: LinearIssue): Promise<BlockerPrs[]> {
  const blockers = issue.blockers.filter((b) => !isLinearClosed(b.state));
  return Promise.all(blockers.map(async (b) => ({
    blocker: b.identifier,
    prs: stackable(await linearPullRequests(world, b.identifier, repo), repo),
  })));
}

/** Each open Blocker must have an open PR whose head can be fetched from this Repo. */
export async function stackOptions(world: World, repo: string, issue: GitHubIssue): Promise<StackOption[]> {
  return everyBlocker(await blockerPrs(world, repo, issue));
}

/** Each unresolved Blocker of a Linear issue must have an open PR attached whose head can be fetched from this Repo. */
export async function linearStackOptions(world: World, repo: string, issue: LinearIssue): Promise<StackOption[]> {
  return everyBlocker(await linearBlockerPrs(world, repo, issue));
}

/** Open PRs in `repo` whose head branch can be fetched from it. */
export function stackable(prs: PullRequest[], repo: string) {
  return prs.filter((pr): pr is PullRequest & { headBranch: string } =>
    pr.state === "open" && sameSlug(pr.repo, repo) && Boolean(pr.headBranch));
}

/** The options of each Blocker, or none when some Blocker has none. */
export function everyBlocker(blockers: BlockerPrs[]): StackOption[] {
  return blockers.some((b) => b.prs.length === 0) ? [] : blockers.flatMap((b) => b.prs.map((pr) => ({ blocker: b.blocker, pr })));
}

/**
 * Ready issues of every Repo, minus those In flight, which are listed apart
 * with their Stage. Ready issues carry the Base their dispatch would start
 * from: the Repo's entry in `lastBases` while origin still has it.
 */
export async function loadBoard(world: World, repos: Repo[], dispatches: Dispatch[], prs: PrLookup, lastBases: Record<string, string> = {}): Promise<Board> {
  const [{ linear, viewer, ...ready }, inFlight] = await Promise.all([loadReady(world, repos, dispatches, lastBases), loadInFlight(world, dispatches, prs)]);
  const board: Board = { ...ready, inFlight, specs: [] };
  if (viewer !== undefined) board.specs = await loadLinearSpecs(world, board, linear, viewer);
  return board;
}

/**
 * The facts the Spec rules need about each Repo's Linear Specs: those its
 * issues belong to, those they are, and its loose issues as Specs of one.
 */
async function loadLinearSpecs(world: World, board: Omit<Board, "specs">, linear: Map<Repo, LinearIssue[]>, viewer: string): Promise<RepoDecision[]> {
  const facts = await Promise.allSettled([...linear].map(async ([repo, issues]): Promise<RepoFacts> => {
    const inFlight = board.inFlight.filter((row) => sameSlug(row.dispatch.repo, repo.slug) && linearIdentifier(row.dispatch.issue) !== null);
    const known = new Map(issues.map((i) => [i.identifier, i]));
    const parents = new Set(issues.flatMap((i) => i.hasSubIssues ? [i.identifier] : i.parent ? [i.parent] : []));
    const facts = async (issue: LinearIssue): Promise<IssueFacts> => {
      const row = inFlight.find((r) => r.dispatch.issue === issue.identifier);
      const closed = isLinearClosed(issue.state);
      return {
        issue: issue.identifier, closed, startable: canStartLinear(issue, viewer), inFlight: row !== undefined,
        pr: row ? row.pr : closed ? null : linkedPr(await linearPullRequests(world, issue.identifier, repo.slug), repo.slug),
        blockers: issue.blockers.map((b) => ({ issue: b.identifier, closed: isLinearClosed(b.state) })),
      };
    };
    const specs: SpecFacts[] = await Promise.all([...parents].map(async (spec) => {
      const [parent, subIssues] = await Promise.all([known.get(spec) ?? world.linearIssue(spec), world.linearSubIssues(spec)]);
      return { spec, title: parent?.title ?? spec, url: parent?.url ?? "", body: parent?.body ?? "", issues: await Promise.all(subIssues.map(facts)) };
    }));
    const inSpec = new Set(specs.flatMap((s) => s.issues.map((i) => i.issue)));
    const loose = issues.filter((i) => !i.parent && !i.hasSubIssues && (canStartLinear(i, viewer) || inFlight.some((r) => r.dispatch.issue === i.identifier)));
    for (const issue of loose) specs.push({ spec: issue.identifier, title: issue.title, url: issue.url, body: issue.body, issues: [await facts(issue)] });
    for (const row of inFlight) {
      if (inSpec.has(row.dispatch.issue) || loose.some((i) => i.identifier === row.dispatch.issue)) continue;
      const { issue, title, url } = row.dispatch;
      specs.push({ spec: issue, title, url, body: "", issues: [{ issue, closed: false, startable: false, inFlight: true, pr: row.pr, blockers: [] }] });
    }
    specs.sort((a, b) => a.spec.localeCompare(b.spec, undefined, { numeric: true }));
    return { repo: repo.slug, defaultBranch: await world.gitDefaultBranch(repo.path), runningSpecs: repo.runningSpecs ?? DEFAULT_RUNNING_SPECS, specs };
  }));
  const loaded: RepoFacts[] = [];
  facts.forEach((result, i) => {
    const repo = [...linear.keys()][i]!;
    if (result.status === "fulfilled") loaded.push(result.value);
    else board.errors.push({ repo: repo.slug, source: "Linear", error: worldErrorMessage(result.reason) });
  });
  return decideSpecs(loaded).filter((r) => r.specs.length > 0);
}

async function loadReady(world: World, repos: Repo[], inFlight: Dispatch[], lastBases: Record<string, string>) {
  const board: Omit<Board, "inFlight" | "specs"> & { linear: Map<Repo, LinearIssue[]>; viewer?: string } = { ready: [], stackable: [], bases: {}, errors: [], linear: new Map() };
  if (repos.length === 0) return board;
  const dispatched = new Set(inFlight.map((d) => d.issue));
  const github = async () => {
    let viewer: string;
    try { viewer = await world.githubViewer(); }
    catch (e) {
      board.errors.push(...repos.map((r) => ({ repo: r.slug, error: worldErrorMessage(e) })));
      return;
    }
    const results = await Promise.allSettled(repos.map(async (repo) => {
      const issues = (await world.githubIssues(repo.slug))
        .filter((issue) => canStart(issue, viewer) && !dispatched.has(`${repo.slug}#${issue.number}`))
        .sort((a, b) => a.number - b.number);
      return Promise.all(issues.map(async (issue) => ({ issue, blockers: await stackOptions(world, repo.slug, issue) })));
    }));
    results.forEach((result, i) => {
      const repo = repos[i]!;
      if (result.status === "rejected") {
        board.errors.push({ repo: repo.slug, error: worldErrorMessage(result.reason) });
        return;
      }
      for (const { issue, blockers } of result.value) {
        const { number, title, url } = issue;
        const row = { repo: repo.slug, number, title, url };
        if (isReady(issue, viewer)) board.ready.push(row);
        else if (blockers.length) board.stackable.push({ ...row, blockers });
      }
    });
  };
  const linear = async () => {
    const selected = repos.filter((r) => r.linear);
    if (!selected.length) return;
    let viewer: string;
    try { viewer = await world.linearViewer(); }
    catch (e) {
      board.errors.push(...selected.map((r) => ({ repo: r.slug, source: "Linear" as const, error: worldErrorMessage(e) })));
      return;
    }
    board.viewer = viewer;
    const teams = [...new Set(selected.map((r) => r.linear!.team))];
    const issues = await Promise.allSettled(teams.map((team) => world.linearIssues(team)));
    // A Repo's Stackable issues are those with a Blocker PR in it, so each Repo is asked on its own.
    const results = await Promise.allSettled(selected.map(async (repo) => {
      const result = issues[teams.indexOf(repo.linear!.team)]!;
      if (result.status === "rejected") throw result.reason;
      const claimed = result.value.filter((i) => matchesSelector(i, repo.linear!));
      board.linear.set(repo, claimed);
      const startable = claimed.filter((i) => canStartLinear(i, viewer) && !dispatched.has(i.identifier))
        .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
      return Promise.all(startable.map(async (issue) => {
        const ready = isLinearReady(issue, viewer);
        return { issue, ready, blockers: ready || stacksAcrossSpecs(issue, claimed) ? [] : await linearStackOptions(world, repo.slug, issue) };
      }));
    }));
    results.forEach((result, i) => {
      const repo = selected[i]!;
      if (result.status === "rejected") {
        board.errors.push({ repo: repo.slug, source: "Linear", error: worldErrorMessage(result.reason) });
        return;
      }
      for (const { issue: { identifier, title, url }, ready, blockers } of result.value) {
        const row = { repo: repo.slug, identifier, title, url };
        if (ready) board.ready.push(row);
        else if (blockers.length) board.stackable.push({ ...row, blockers });
      }
    });
  };
  // GitHub rows precede Linear rows.
  await github();
  await linear();
  await Promise.all(repos.filter((r) => board.ready.some((i) => i.repo === r.slug)).map(async (repo) => {
    try { board.bases[repo.slug] = await baseChoice(world, repo, lastBases[repo.slug]); }
    catch (e) { board.errors.push({ repo: repo.slug, source: "git", error: worldErrorMessage(e) }); }
  }));
  for (const issue of board.ready) {
    const choice = board.bases[issue.repo];
    if (choice) issue.base = choice.selected;
  }
  return board;
}

/** The message of an adapter failure; anything else is a bug and propagates. */
function worldErrorMessage(e: unknown) {
  if (e instanceof WorldError) return e.message;
  throw e;
}

/** An issue of a Spec with an unresolved Blocker outside it would stack across Specs, so it waits for that Blocker instead. */
function stacksAcrossSpecs(issue: LinearIssue, known: LinearIssue[]) {
  if (!issue.parent) return false;
  return issue.blockers.some((b) => !isLinearClosed(b.state) && known.find((k) => k.identifier === b.identifier)?.parent !== issue.parent);
}

export function matchesSelector(issue: LinearIssue, selector: LinearSelector) {
  return [issue.team.id, issue.team.key, issue.team.name].includes(selector.team) &&
    (!selector.project || (issue.project !== null && [issue.project.id, issue.project.name].includes(selector.project))) &&
    (!selector.label || issue.labels.includes(selector.label));
}

export function isLinearReady(issue: LinearIssue, viewer: string) {
  return canStartLinear(issue, viewer) && issue.blockers.every((b) => isLinearClosed(b.state));
}

/** Ready but for its Blockers: not a Spec, not started, labelled `ready-for-agent`, and unassigned or assigned to the user. */
export function canStartLinear(issue: LinearIssue, viewer: string) {
  return !issue.hasSubIssues && ["backlog", "unstarted"].includes(issue.state) && issue.labels.includes(READY_LABEL) &&
    (issue.assignee === null || issue.assignee === viewer);
}

/** Whether a Linear state type is closed: completed or canceled. */
export function isLinearClosed(state: string) {
  return ["completed", "canceled"].includes(state);
}
