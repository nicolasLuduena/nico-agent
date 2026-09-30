import type { Repo } from "./config";
import { type InFlightRow, type PrLookup, loadInFlight } from "./stage";
import type { Dispatch } from "./state";
import type { GitHubIssue, World } from "./world";
import { READY_LABEL, WorldError } from "./world";
import { sameSlug } from "./slug";
import type { PullRequest } from "./world";

export interface StackOption {
  blocker: string;
  pr: PullRequest & { headBranch: string };
}

export interface StackableIssue extends BoardIssue {
  blockers: StackOption[];
}

/** A Blocker names its sole PR; several PRs need an exact URL. */
export function stackChoice(option: StackOption, options: StackOption[]) {
  return options.filter((other) => sameSlug(other.blocker, option.blocker)).length > 1 ? option.pr.url : option.blocker;
}

export interface BoardIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
}

export interface Board {
  ready: BoardIssue[];
  stackable: StackableIssue[];
  inFlight: InFlightRow[];
  errors: { repo: string; error: string }[];
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

/** Each open Blocker must have an open PR whose head can be fetched from this Repo. */
export async function stackOptions(world: World, repo: string, issue: GitHubIssue): Promise<StackOption[]> {
  const blockers = issue.blockers.filter((b) => b.state === "open");
  const options = await Promise.all(blockers.map(async (b) => {
    const prs = await world.githubLinkedPullRequests(b.slug, b.number);
    return prs.filter((pr): pr is PullRequest & { headBranch: string } =>
      pr.state === "open" && sameSlug(pr.repo, repo) && Boolean(pr.headBranch))
      .map((pr) => ({ blocker: `${b.slug}#${b.number}`, pr }));
  }));
  return options.some((prs) => prs.length === 0) ? [] : options.flat();
}

/** Ready issues of every Repo, minus those In flight, which are listed apart with their Stage. */
export async function loadBoard(world: World, repos: Repo[], dispatches: Dispatch[], prs: PrLookup): Promise<Board> {
  const [ready, inFlight] = await Promise.all([loadReady(world, repos, dispatches), loadInFlight(world, dispatches, prs)]);
  return { ...ready, inFlight };
}

async function loadReady(world: World, repos: Repo[], inFlight: Dispatch[]) {
  const board: Omit<Board, "inFlight"> = { ready: [], stackable: [], errors: [] };
  if (repos.length === 0) return board;
  const dispatched = new Set(inFlight.map((d) => d.issue));
  let viewer: string;
  try {
    viewer = await world.githubViewer();
  } catch (e) {
    const error = worldErrorMessage(e);
    return { ready: [], stackable: [], errors: repos.map((r) => ({ repo: r.slug, error })) };
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
  return board;
}

/** The message of an adapter failure; anything else is a bug and propagates. */
function worldErrorMessage(e: unknown) {
  if (e instanceof WorldError) return e.message;
  throw e;
}
