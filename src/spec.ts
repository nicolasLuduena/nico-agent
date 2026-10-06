import type { PullRequest } from "./world";

/**
 * The Spec rules (ADR-0008): a pure decision over facts already fetched, the
 * same for every Source. The Board and `advance` both ask it, so there is one
 * source of truth for which Specs run and what each does next.
 */

/** What the rules need to know about one issue of a Spec. */
export interface IssueFacts {
  /** The issue as the CLI names it: `BLE-27` or `owner/repo#N`. */
  issue: string;
  closed: boolean;
  /** Ready but for its Blockers: open, labelled, not started, and free for the user to take. */
  startable: boolean;
  /** It has a Dispatch that has not been Closed. */
  inFlight: boolean;
  /** Its PR in the Repo: the open one, else a merged one; null without any. */
  pr: PullRequest | null;
  /** Its Blockers, named like `issue`, and whether each is closed. */
  blockers: { issue: string; closed: boolean }[];
}

/** A Spec and its issues in sub-issue order; a loose issue is a Spec of one, named after itself. */
export interface SpecFacts {
  spec: string;
  title: string;
  url: string;
  issues: IssueFacts[];
}

export interface RepoFacts {
  repo: string;
  /** The default branch of the Repo's origin, which every Stack is anchored on. */
  defaultBranch: string;
  specs: SpecFacts[];
}

/** The issue a running Spec dispatches next, and the PR it stacks on, or the default branch for its first PR. */
export interface Next {
  issue: string;
  /** The Spec's newest open PR; unset when the issue starts from `base`, the default branch. */
  stackOn?: PullRequest & { headBranch: string };
  /** The branch the Dispatch starts from: `stackOn`'s head branch, else the Repo's default branch. */
  base: string;
  reason: string;
}

/** A Spec's next issue that waits for a Blocker in another Spec to close, as Stacks never mix Specs. */
export interface Waiting {
  issue: string;
  blocker: string;
  reason: string;
}

export interface SpecDecision {
  spec: string;
  title: string;
  url: string;
  repo: string;
  /** Its issues, in sub-issue order. */
  issues: string[];
  /** From the dispatch of its first issue until each of its issues has a PR. */
  running: boolean;
  next?: Next;
  waiting?: Waiting;
  /** Why a running Spec has no next issue. */
  reason?: string;
}

export interface RepoDecision {
  repo: string;
  /** The Specs with work left, in the order given. */
  specs: SpecDecision[];
}

export function decideSpecs(repos: RepoFacts[]): RepoDecision[] {
  return repos.map((repo) => ({
    repo: repo.repo,
    specs: repo.specs.filter(hasWorkLeft).map((spec) => decideSpec(repo, spec)),
  }));
}

/** A Spec drops off once every issue is closed and none is still In flight. */
function hasWorkLeft(spec: SpecFacts) {
  return spec.issues.some((i) => !i.closed || i.inFlight);
}

function decideSpec(repo: RepoFacts, spec: SpecFacts): SpecDecision {
  const decision: SpecDecision = {
    spec: spec.spec, title: spec.title, url: spec.url, repo: repo.repo,
    issues: spec.issues.map((i) => i.issue), running: false,
  };
  return decision;
}
