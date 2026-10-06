import { linearPullRequests, withBranchPrs } from "./stage";
import { linearIdentifier } from "./linear";
import { githubBranch, sameSlug } from "./slug";
import type { Dispatch } from "./state";
import { type GitHubIssue, type LinearIssue, type PullRequest, READY_LABEL, type World } from "./world";

/**
 * What the Board and the Spec rules read from a Source's issues for one Repo,
 * so each rule is written once for GitHub and Linear alike. Issues are named
 * as the CLI names them: `owner/repo#N` (the Repo's configured slug for its
 * own issues) or a Linear identifier.
 */
export interface SourceAdapter<I extends SourceIssue> {
  /** The Repo's slug. */
  repo: string;
  /** Set for Linear, whose load failures the Board reports apart. */
  source?: "Linear";
  name(issue: I): string;
  closed(issue: I): boolean;
  /** Ready but for its Blockers. */
  startable(issue: I, viewer: string): boolean;
  /** Whether the issue has sub-issues, which makes it a Spec. */
  isSpec(issue: I): boolean;
  /** The name of the Spec the issue is a sub-issue of, or null. */
  parent(issue: I): string | null;
  /** Its Blockers by name, and whether each is closed. */
  blockers(issue: I): { issue: string; closed: boolean }[];
  /** The PRs linked to the issue named `name`, as ADR-0003 reads them. */
  linkedPrs(name: string): Promise<PullRequest[]>;
  /** A Spec's own issue, and its sub-issues in the Repo in sub-issue order; `known` saves a lookup. */
  spec(name: string, known: I[]): Promise<{ parent: I | null; subIssues: I[] }>;
  /** Whether a Dispatch is for an issue of this Source. */
  owns(dispatch: Dispatch): boolean;
}

export type SourceIssue = { title: string; url: string; body: string };

export function githubSource(world: World, repo: string): SourceAdapter<GitHubIssue> {
  const nameOf = (slug: string, number: number) => `${sameSlug(slug, repo) ? repo : slug}#${number}`;
  const parse = (name: string) => {
    const at = name.lastIndexOf("#");
    return { slug: name.slice(0, at), number: Number(name.slice(at + 1)) };
  };
  return {
    repo,
    name: (issue) => nameOf(repo, issue.number),
    closed: (issue) => issue.state === "closed",
    startable: canStart,
    isSpec: (issue) => issue.hasSubIssues,
    parent: (issue) => issue.parent && nameOf(issue.parent.slug, issue.parent.number),
    blockers: (issue) => issue.blockers.map((b) => ({ issue: nameOf(b.slug, b.number), closed: b.state === "closed" })),
    // A Closed Dispatch's PR into a non-default branch has no closing reference, but keeps its branch.
    linkedPrs: (name) => {
      const { slug, number } = parse(name);
      return withBranchPrs(world, slug, githubBranch(slug, number), world.githubLinkedPullRequests(slug, number));
    },
    spec: async (name, known) => {
      const { slug, number } = parse(name);
      const own = sameSlug(slug, repo) ? known.find((i) => i.number === number) : undefined;
      const [parent, subIssues] = await Promise.all([own ?? world.githubIssue(slug, number), world.githubSubIssues(slug, number)]);
      // A Spec's sub-issues in other repos belong to Stacks there.
      return { parent, subIssues: subIssues.filter((sub) => sameSlug(sub.slug, repo)) };
    },
    owns: (dispatch) => linearIdentifier(dispatch.issue) === null,
  };
}

export function linearSource(world: World, repo: string): SourceAdapter<LinearIssue> {
  return {
    repo,
    source: "Linear",
    name: (issue) => issue.identifier,
    closed: (issue) => isLinearClosed(issue.state),
    startable: canStartLinear,
    isSpec: (issue) => issue.hasSubIssues,
    parent: (issue) => issue.parent,
    blockers: (issue) => issue.blockers.map((b) => ({ issue: b.identifier, closed: isLinearClosed(b.state) })),
    linkedPrs: (name) => linearPullRequests(world, name, repo),
    spec: async (name, known) => {
      const [parent, subIssues] = await Promise.all([known.find((i) => i.identifier === name) ?? world.linearIssue(name), world.linearSubIssues(name)]);
      return { parent, subIssues };
    },
    owns: (dispatch) => linearIdentifier(dispatch.issue) !== null,
  };
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

/** Ready but for its Blockers: not a Spec, open, labelled `ready-for-agent`, and unassigned or assigned only to the user. */
export function canStart(issue: GitHubIssue, viewer: string) {
  return !issue.hasSubIssues && issue.state === "open" && issue.labels.includes(READY_LABEL) &&
    issue.assignees.every((login) => login.toLowerCase() === viewer.toLowerCase());
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
