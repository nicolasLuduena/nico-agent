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
  /** What the Spec says it builds, for the Scheduler to judge priority by. */
  body: string;
  issues: IssueFacts[];
}

export interface RepoFacts {
  repo: string;
  /** The default branch of the Repo's origin, which every Stack is anchored on. */
  defaultBranch: string;
  /** How many Specs may run in the Repo at once. */
  runningSpecs: number;
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
  body: string;
  repo: string;
  /** Its issues, in sub-issue order. */
  issues: string[];
  /**
   * From the dispatch of its first issue until each of its issues has a PR,
   * except while it only waits on another Spec's PRs to merge: then it frees its slot.
   */
  running: boolean;
  /** The issue whose Implementer the Spec is waiting on; a Spec has one at a time. */
  implementing?: string;
  /** A running Spec's next issue, or a candidate Spec's first. */
  next?: Next;
  waiting?: Waiting;
  /** Why a running Spec has no next issue. */
  reason?: string;
}

export interface RepoDecision {
  repo: string;
  /** The Specs with work left, in the order given. */
  specs: SpecDecision[];
  /** How many more Specs may start: the Repo's cap less its running Specs. */
  room: number;
  /** The Specs that could start, as not started and with a first issue Ready: the Scheduler's choice when there is room. */
  candidates: string[];
}

export function decideSpecs(repos: RepoFacts[]): RepoDecision[] {
  return repos.map((repo) => {
    const specs = repo.specs.filter(hasWorkLeft).map((spec) => decideSpec(repo, spec));
    return {
      repo: repo.repo, specs,
      room: Math.max(0, repo.runningSpecs - specs.filter((s) => s.running).length),
      candidates: specs.filter((s) => !s.running && s.next).map((s) => s.spec),
    };
  });
}

/** A Spec drops off once every issue is closed and none is still In flight. */
function hasWorkLeft(spec: SpecFacts) {
  return spec.issues.some((i) => !i.closed || i.inFlight);
}

function decideSpec(repo: RepoFacts, spec: SpecFacts): SpecDecision {
  const decision: SpecDecision = {
    spec: spec.spec, title: spec.title, url: spec.url, body: spec.body, repo: repo.repo,
    issues: spec.issues.map((i) => i.issue), running: false,
  };
  const remaining = spec.issues.filter((i) => !done(i));
  const started = spec.issues.some((i) => i.inFlight || i.closed || i.pr);
  if (remaining.length === 0) return decision;
  if (!started) {
    const first = nextIssue(repo, spec, remaining);
    if (first) decision.next = first;
    return decision;
  }
  decision.running = true;
  const implementing = remaining.find((i) => i.inFlight);
  if (implementing) {
    decision.implementing = implementing.issue;
    decision.reason = `${implementing.issue} is Implementing; a Spec has one Implementer at a time`;
    return decision;
  }
  const next = nextIssue(repo, spec, remaining);
  if (next) {
    decision.next = next;
    return decision;
  }
  for (const issue of remaining.filter((i) => i.startable)) {
    const blocker = issue.blockers.find((b) => !b.closed && !spec.issues.some((i) => i.issue === b.issue));
    if (!blocker) continue;
    // Waiting only on another Spec's merges, it frees its slot.
    decision.running = false;
    decision.waiting = {
      issue: issue.issue, blocker: blocker.issue,
      reason: `${issue.issue} waits for ${blocker.issue}, in another Spec, to close; a Stack never mixes Specs`,
    };
    return decision;
  }
  decision.reason = "no remaining issue is Ready or unblocked";
  return decision;
}

/** The first remaining issue that is startable with each Blocker closed or done within the Spec, on the Spec's newest open PR. */
function nextIssue(repo: RepoFacts, spec: SpecFacts, remaining: IssueFacts[]): Next | undefined {
  const next = remaining.find((i) => i.startable && i.blockers.every((b) => b.closed || within(spec, b.issue)));
  if (!next) return undefined;
  const stackOn = newestOpenPr(spec);
  return {
    issue: next.issue, base: stackOn?.headBranch ?? repo.defaultBranch,
    reason: `${next.issue} is the first unblocked issue of ${spec.spec}; ` +
      (stackOn ? "it stacks on the Spec's newest open PR" : `the Spec has no open PR, so it starts from ${repo.defaultBranch}`),
    ...(stackOn && { stackOn }),
  };
}

/** An issue is done for its Spec once it is closed or has a PR. */
function done(issue: IssueFacts) {
  return issue.closed || issue.pr !== null;
}

/** Whether `blocker` is an issue of `spec` that is done, so a Dispatch stacked on the Spec's newest PR builds on it. */
function within(spec: SpecFacts, blocker: string) {
  const issue = spec.issues.find((i) => i.issue === blocker);
  return issue !== undefined && done(issue);
}

/** The top of the Spec's Stack: its open PR with the highest number. */
function newestOpenPr(spec: SpecFacts) {
  return spec.issues
    .map((i) => i.pr)
    .filter((pr): pr is PullRequest & { headBranch: string } => pr?.state === "open" && Boolean(pr.headBranch))
    .sort((a, b) => b.number - a.number)[0];
}
