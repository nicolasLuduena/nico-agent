import type { LinearSelector, Repo } from "./config";
import { sameSlug } from "./slug";
import { type SourceAdapter, type SourceIssue, canStart, canStartLinear, githubSource, isLinearReady, isReady, linearSource } from "./source";
import type { RepoDecision } from "./spec";
import type { BoardSighting } from "./stats";
import { type SourceIssues, loadSpecs } from "./spec-facts";
import { type InFlightRow, type PrLookup, loadInFlight } from "./stage";
import type { Dispatch } from "./state";
import { type GitHubIssue, type LinearIssue, type PullRequest, type World, isResearch, worldErrorMessage } from "./world";

export interface StackOption {
  blocker: string;
  pr: PullRequest & { headBranch: string };
}

export type StackableIssue = BoardIssue & {
  blockers: StackOption[];
};

/** The errors that kept a Repo's issues, and so its Specs, from loading; a failed branch listing (`git`) did not. */
export function specLoadErrors<E extends { source?: string }>(errors: E[]): E[] {
  return errors.filter((e) => e.source !== "git");
}

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
  /** Set on a Research issue. */
  research?: boolean;
} & ({ number: number; identifier?: never } | { identifier: string; number?: never });

export interface Board {
  ready: BoardIssue[];
  /** Each Repo's Specs as the Spec rules decide them; Repos without Specs are left out. */
  specs: RepoDecision[];
  stackable: StackableIssue[];
  /** Issues that would be Ready or Stackable but already have an open or merged PR, with no Dispatch In flight. */
  withPr: (BoardIssue & { pr: PullRequest })[];
  inFlight: InFlightRow[];
  /** The Base choice of each Repo with Ready issues, by slug. */
  bases: Record<string, BaseChoice>;
  /** `git` errors are about listing origin's branches; the Repo's issues still loaded. */
  errors: { repo: string; error: string; source?: "Linear" | "git" }[];
  /** Each Source whose issues loaded, with every issue it listed, for counting issues defined. */
  sighting: BoardSighting;
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

/** Each unresolved Blocker of an issue, with its open PRs whose head can be fetched from a Repo. */
export interface BlockerPrs {
  blocker: string;
  prs: (PullRequest & { headBranch: string })[];
}

/** Each unresolved Blocker of an issue, with its open PRs in the adapter's Repo. */
export async function blockerPrs<I extends SourceIssue>(source: SourceAdapter<I>, issue: I): Promise<BlockerPrs[]> {
  const blockers = source.blockers(issue).filter((b) => !b.closed);
  return Promise.all(blockers.map(async (b) => ({ blocker: b.issue, prs: openPrsIn(await source.linkedPrs(b.issue), source.repo) })));
}

/** Each unresolved Blocker must have an open PR whose head can be fetched from the adapter's Repo. */
export async function stackOptions<I extends SourceIssue>(source: SourceAdapter<I>, issue: I): Promise<StackOption[]> {
  return everyBlocker(await blockerPrs(source, issue));
}

/** Open PRs in `repo` whose head branch can be fetched from it. */
export function openPrsIn(prs: PullRequest[], repo: string) {
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
  const [{ sources, ...ready }, inFlight] = await Promise.all([loadReady(world, repos, dispatches, lastBases), loadInFlight(world, dispatches, prs)]);
  const { specs, prs: started, errors } = await loadSpecs(world, sources, inFlight);
  // An issue with a PR is started, so it isn't Ready: it is listed with its PR instead.
  const prOf = (i: BoardIssue) => started.find((p) => p.repo === i.repo && p.issue === (i.identifier ?? `${i.repo}#${i.number}`))?.pr;
  const withPr = [...ready.ready, ...ready.stackable].flatMap((i): Board["withPr"] => {
    const pr = prOf(i);
    const { repo, title, url, research } = i;
    return pr ? [{ repo, title, url, ...(research && { research }), ...(i.identifier ? { identifier: i.identifier } : { number: i.number! }), pr }] : [];
  });
  const sighting: BoardSighting = sources.map((s) => ({ source: s.adapter.source ?? "GitHub", repo: s.repo.slug, issues: s.issues.map((i) => s.adapter.name(i)) }));
  return {
    ...ready, sighting, ready: ready.ready.filter((i) => !prOf(i)), stackable: ready.stackable.filter((i) => !prOf(i)), withPr,
    errors: [...ready.errors, ...errors], inFlight, specs,
  };
}

async function loadReady(world: World, repos: Repo[], inFlight: Dispatch[], lastBases: Record<string, string>) {
  const board: Omit<Board, "inFlight" | "specs" | "withPr" | "sighting"> & { sources: SourceIssues<any>[] } = { ready: [], stackable: [], bases: {}, errors: [], sources: [] };
  if (repos.length === 0) return board;
  const dispatched = new Set(inFlight.map((d) => d.issue));
  const github = async () => {
    let githubViewer: string;
    try { githubViewer = await world.githubViewer(); }
    catch (e) {
      board.errors.push(...repos.map((r) => ({ repo: r.slug, error: worldErrorMessage(e) })));
      return;
    }
    const results = await Promise.allSettled(repos.map(async (repo) => {
      const source = githubSource(world, repo.slug);
      const all = await world.githubIssues(repo.slug);
      board.sources.push({ repo, adapter: source, issues: all, viewer: githubViewer });
      const issues = all
        .filter((issue) => canStart(issue, githubViewer) && !dispatched.has(`${repo.slug}#${issue.number}`))
        .sort((a, b) => a.number - b.number);
      return Promise.all(issues.map(async (issue) => ({ issue, blockers: stacksAcrossSpecs(source, issue, all) ? [] : await stackOptions(source, issue) })));
    }));
    results.forEach((result, i) => {
      const repo = repos[i]!;
      if (result.status === "rejected") {
        board.errors.push({ repo: repo.slug, error: worldErrorMessage(result.reason) });
        return;
      }
      for (const { issue, blockers } of result.value) {
        const { number, title, url } = issue;
        const row = { repo: repo.slug, number, title, url, ...researchMark(issue) };
        if (isReady(issue, githubViewer)) board.ready.push(row);
        else if (blockers.length) board.stackable.push({ ...row, blockers });
      }
    });
  };
  const linear = async () => {
    const selected = repos.filter((r) => r.linear);
    if (!selected.length) return;
    let linearViewer: string;
    try { linearViewer = await world.linearViewer(); }
    catch (e) {
      board.errors.push(...selected.map((r) => ({ repo: r.slug, source: "Linear" as const, error: worldErrorMessage(e) })));
      return;
    }
    const teams = [...new Set(selected.map((r) => r.linear!.team))];
    const issues = await Promise.allSettled(teams.map((team) => world.linearIssues(team)));
    // A Repo's Stackable issues are those with a Blocker PR in it, so each Repo is asked on its own.
    const results = await Promise.allSettled(selected.map(async (repo) => {
      const result = issues[teams.indexOf(repo.linear!.team)]!;
      if (result.status === "rejected") throw result.reason;
      const source = linearSource(world, repo.slug);
      const claimed = result.value.filter((i) => matchesSelector(i, repo.linear!));
      board.sources.push({ repo, adapter: source, issues: claimed, viewer: linearViewer });
      const startable = claimed.filter((i) => canStartLinear(i, linearViewer) && !dispatched.has(i.identifier))
        .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
      return Promise.all(startable.map(async (issue) => {
        const ready = isLinearReady(issue, linearViewer);
        return { issue, ready, blockers: ready || stacksAcrossSpecs(source, issue, claimed) ? [] : await stackOptions(source, issue) };
      }));
    }));
    results.forEach((result, i) => {
      const repo = selected[i]!;
      if (result.status === "rejected") {
        board.errors.push({ repo: repo.slug, source: "Linear", error: worldErrorMessage(result.reason) });
        return;
      }
      for (const { issue, ready, blockers } of result.value) {
        const { identifier, title, url } = issue;
        const row = { repo: repo.slug, identifier, title, url, ...researchMark(issue) };
        if (ready) board.ready.push(row);
        else if (blockers.length) board.stackable.push({ ...row, blockers });
      }
    });
  };
  // GitHub rows precede Linear rows.
  await github();
  await linear();
  // In config order whichever Repo loaded first; stable, so GitHub stays before Linear.
  board.sources.sort((a, b) => repos.indexOf(a.repo) - repos.indexOf(b.repo));
  await Promise.all(repos.filter((r) => board.ready.some((i) => i.repo === r.slug)).map(async (repo) => {
    try { board.bases[repo.slug] = await baseChoice(world, repo, repo.base ?? lastBases[repo.slug]); }
    catch (e) { board.errors.push({ repo: repo.slug, source: "git", error: worldErrorMessage(e) }); }
  }));
  for (const issue of board.ready) {
    const choice = board.bases[issue.repo];
    if (choice) issue.base = choice.selected;
  }
  return board;
}

function researchMark(issue: { labels: string[] }) {
  return isResearch(issue) ? { research: true } : {};
}

/** An issue of a Spec with an unresolved Blocker outside it would stack across Specs, so it waits for that Blocker instead. */
function stacksAcrossSpecs<I extends SourceIssue>(source: SourceAdapter<I>, issue: I, known: I[]) {
  const parent = source.parent(issue);
  if (!parent) return false;
  return source.blockers(issue).some((b) => {
    if (b.closed) return false;
    const blocker = known.find((k) => source.name(k) === b.issue);
    return !blocker || source.parent(blocker) !== parent;
  });
}

export function matchesSelector(issue: LinearIssue, selector: LinearSelector) {
  return [issue.team.id, issue.team.key, issue.team.name].includes(selector.team) &&
    (!selector.project || (issue.project !== null && [issue.project.id, issue.project.name].includes(selector.project))) &&
    (!selector.label || issue.labels.includes(selector.label));
}

