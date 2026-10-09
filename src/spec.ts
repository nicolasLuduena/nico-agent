import type { PullRequest } from "./world";

/**
 * The Spec rules (ADR-0008, kept by ADR-0009, amended by ADR-0012): a pure decision over facts already fetched, the
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
  /** Its PR in the Repo, closed issue or not: the open one, else the latest; null without any. */
  pr: PullRequest | null;
  /** Its Blockers, named like `issue`, and whether each is closed. */
  blockers: { issue: string; closed: boolean }[];
  /** The step its In-flight Dispatch Failed at, until a re-run gets past it or the Dispatch is Closed. */
  failed?: { step: string; error: string };
  /** The PR closed without merging that its In-flight Dispatch's Stack is built on. */
  builtOnClosedPr?: PullRequest;
}

/** A Spec and its issues in sub-issue order; a loose issue is a Spec of one, named after itself. */
export interface SpecFacts {
  spec: string;
  title: string;
  url: string;
  issues: IssueFacts[];
}

/** An open PR whose head branch is in the Repo, so a Dispatch can start on it. */
export type OpenPr = PullRequest & { headBranch: string };

export interface RepoFacts {
  repo: string;
  /** The Base an issue starts from when none of its Blockers has an open PR. */
  defaultBranch: string;
  /** How many Specs may run in the Repo at once. */
  maxRunningSpecs: number;
  /** How many of a Spec's issues may be In flight at once. */
  maxImplementersPerSpec: number;
  /** `advance` starts nothing in it, so only a Spec with an In-flight Dispatch runs there. */
  manual?: boolean;
  specs: SpecFacts[];
}

/** An issue a Spec dispatches next, and the PR it stacks on, or the Base it starts from. */
export interface Next {
  issue: string;
  /** Its Blockers' one open PR; unset when the issue starts from `base`, the Repo's default branch. */
  stackOn?: OpenPr;
  /** The branch the Dispatch starts from: `stackOn`'s head branch, else the Repo's default branch. */
  base: string;
  reason: string;
}

/** A startable issue that waits: on a Blocker in another Spec to close, or on its Blockers' open PRs, on several branches, to merge down to one. */
export interface Waiting {
  issue: string;
  blockers: string[];
  reason: string;
}

/** Why the Scheduler does not dispatch into a Spec until the user acts, and the issue whose Dispatch needs it. */
export interface Hold {
  issue: string;
  reason: string;
}

export interface SpecDecision {
  spec: string;
  title: string;
  url: string;
  repo: string;
  /** Its issues, in sub-issue order. */
  issues: string[];
  /**
   * From the dispatch of its first issue until each of its issues has a PR,
   * except while it only waits on another Spec's PRs to merge: then it frees its slot.
   */
  running: boolean;
  /** The issues whose Implementers the Spec is waiting on. */
  implementing: string[];
  /** The issues a running Spec starts next, or a candidate Spec's first ones, up to its cap of Implementers. */
  next: Next[];
  /** Its startable issues that wait, each with why. */
  waiting: Waiting[];
  /** Why a running Spec starts no issue. */
  reason?: string;
  /** Set when the Spec is Held; a Held Spec has no next issue and is never started. */
  held?: Hold;
}

export interface RepoDecision {
  repo: string;
  /** The Specs with work left, in the order given. */
  specs: SpecDecision[];
  /** How many more Specs may start: the Repo's cap less its running Specs. */
  room: number;
  /** `advance` starts nothing in it: only an explicit `dispatch` does. */
  manual: boolean;
  /** The Specs that could start, as not started, not Held, and with a first issue Ready: the Scheduler's choice when there is room. */
  candidates: string[];
}

export function decideSpecs(repos: RepoFacts[]): RepoDecision[] {
  return repos.map((repo) => {
    const specs = repo.specs.filter(hasWorkLeft).map((spec) => decideSpec(repo, spec));
    return {
      repo: repo.repo, specs, manual: repo.manual === true,
      room: Math.max(0, repo.maxRunningSpecs - specs.filter((s) => s.running).length),
      candidates: specs.filter((s) => !s.running && !s.held && s.next.length).map((s) => s.spec),
    };
  });
}

/** Whether two names are the same Spec, as the user may type a Linear key in any case. */
export function sameSpec(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether `spec` is one of the Repo's candidate Specs. */
export function isCandidate(decision: RepoDecision, spec: string) {
  return decision.candidates.some((c) => sameSpec(c, spec));
}

/** A Spec drops off once every issue is closed and none is still In flight. */
function hasWorkLeft(spec: SpecFacts) {
  return spec.issues.some((i) => !i.closed || i.inFlight);
}

function decideSpec(repo: RepoFacts, spec: SpecFacts): SpecDecision {
  const decision: SpecDecision = {
    spec: spec.spec, title: spec.title, url: spec.url, repo: repo.repo,
    issues: spec.issues.map((i) => i.issue), running: false, implementing: [], next: [], waiting: [],
  };
  const held = holdOf(spec);
  if (held) decision.held = held;
  const remaining = spec.issues.filter((i) => !done(i));
  // Started by a Dispatch: one is In flight, or one left a PR. An issue closed by hand is no evidence.
  // In a manual Repo only an In-flight Dispatch counts, as an old PR is no say-so to carry the Spec on.
  const started = spec.issues.some((i) => i.inFlight || (!repo.manual && i.pr));
  if (remaining.length === 0) return decision;
  const { next, waiting } = nextIssues(repo, spec, remaining);
  const cap = repo.maxImplementersPerSpec;
  if (!started) {
    decision.next = next.slice(0, cap);
    return decision;
  }
  decision.running = true;
  if (held) return decision;
  // Implementing are the In-flight issues without a PR yet; the cap counts every In-flight one, PR ready or not.
  decision.implementing = remaining.filter((i) => i.inFlight).map((i) => i.issue);
  const inFlight = spec.issues.filter((i) => i.inFlight).length;
  decision.next = next.slice(0, Math.max(0, cap - inFlight));
  decision.waiting = waiting;
  if (decision.next.length) return decision;
  if (next.length) {
    decision.reason = `${spec.spec} has ${inFlight} issues In flight, its cap of Implementers`;
  } else if (decision.implementing.length) {
    const names = decision.implementing.join(", ");
    decision.reason = `${names} ${decision.implementing.length === 1 ? "is" : "are"} Implementing, and no other issue is unblocked`;
  } else if (waiting.length) {
    // Waiting only on another Spec's merges, it frees its slot.
    decision.running = !remaining.every(waitsOnAnotherSpec(spec, remaining));
  } else {
    decision.reason = "no remaining issue is Ready or unblocked";
  }
  return decision;
}

/** An unresolved Blocker of `issue` outside its Spec. */
function outsideBlocker(spec: SpecFacts, issue: IssueFacts) {
  return issue.blockers.find((b) => !b.closed && !spec.issues.some((i) => i.issue === b.issue));
}

/** Whether a remaining issue waits on another Spec: through its own Blocker there, or a remaining Blocker in the Spec that does. */
function waitsOnAnotherSpec(spec: SpecFacts, remaining: IssueFacts[]) {
  const waits = new Set(remaining.filter((i) => outsideBlocker(spec, i)).map((i) => i.issue));
  for (let grew = true; grew;) {
    grew = false;
    for (const issue of remaining) {
      if (waits.has(issue.issue) || !issue.blockers.some((b) => !b.closed && waits.has(b.issue))) continue;
      waits.add(issue.issue);
      grew = true;
    }
  }
  return (issue: IssueFacts) => waits.has(issue.issue);
}

/**
 * The remaining issues that may start now, in sub-issue order: startable, not
 * In flight, with each Blocker closed or done within the Spec. Each stacks on
 * its Blockers' one open PR, or starts from the default branch when none has
 * one; one whose open Blocker PRs top more than one Stack waits, as does one
 * blocked by another Spec's open issue.
 */
function nextIssues(repo: RepoFacts, spec: SpecFacts, remaining: IssueFacts[]): { next: Next[]; waiting: Waiting[] } {
  const next: Next[] = [];
  const waiting: Waiting[] = [];
  for (const issue of remaining.filter((i) => i.startable && !i.inFlight)) {
    const outside = outsideBlocker(spec, issue);
    if (outside) {
      waiting.push({
        issue: issue.issue, blockers: [outside.issue],
        reason: `${issue.issue} waits for ${outside.issue}, in another Spec, to close; a Stack never mixes Specs`,
      });
      continue;
    }
    if (!issue.blockers.every((b) => b.closed || within(spec, b.issue))) continue;
    const tops = stackTops(spec, blockerPrs(spec, issue));
    if (tops.length > 1) {
      waiting.push({
        issue: issue.issue, blockers: tops.map((t) => t.blocker),
        reason: `${issue.issue} waits for its Blockers' open PRs ${tops.map((t) => t.pr.url).join(", ")} to merge down to one; they sit on different branches`,
      });
      continue;
    }
    const top = tops[0];
    next.push(top
      ? { issue: issue.issue, stackOn: top.pr, base: top.pr.headBranch, reason: `${issue.issue} stacks on its Blocker ${top.blocker}'s open PR` }
      : { issue: issue.issue, base: repo.defaultBranch, reason: `${issue.issue} has no open Blocker PR, so it starts from ${repo.defaultBranch}` });
  }
  return { next, waiting };
}

/** An unresolved Blocker within the Spec, and its open PR. */
interface BlockerPr {
  blocker: string;
  pr: OpenPr;
}

/** The open PRs of `issue`'s unresolved Blockers within the Spec. */
function blockerPrs(spec: SpecFacts, issue: IssueFacts): BlockerPr[] {
  return issue.blockers.filter((b) => !b.closed).flatMap((b) => {
    const pr = spec.issues.find((i) => i.issue === b.issue)?.pr;
    return pr && isOpen(pr) ? [{ blocker: b.issue, pr }] : [];
  });
}

/**
 * Those of `prs` no other of them stacks above, walking each one's base
 * branch down through the Spec's open PRs: one top means every Blocker's PR
 * is in that top PR's Stack.
 */
function stackTops(spec: SpecFacts, prs: BlockerPr[]): BlockerPr[] {
  const open = spec.issues.map((i) => i.pr).filter((pr): pr is OpenPr => pr !== null && isOpen(pr));
  const below = (pr: OpenPr) => {
    const branches = new Set<string>();
    for (let base = pr.baseBranch; !branches.has(base);) {
      branches.add(base);
      const under = open.find((p) => p.headBranch === base);
      if (!under) break;
      base = under.baseBranch;
    }
    return branches;
  };
  const unique = prs.filter((p, i) => prs.findIndex((q) => q.pr.number === p.pr.number) === i);
  return unique.filter((p) => !unique.some((q) => q !== p && below(q.pr).has(p.pr.headBranch)));
}

/** Whether `pr` is open with a head branch in the Repo to start on. */
function isOpen(pr: PullRequest): pr is OpenPr {
  return pr.state === "open" && Boolean(pr.headBranch);
}

/**
 * Holds are derived from the facts on every read, so they clear once the user
 * resumes or Closes the Dispatch that caused them.
 */
function holdOf(spec: SpecFacts): Hold | undefined {
  const failed = spec.issues.find((i) => i.failed);
  if (failed?.failed) {
    return { issue: failed.issue, reason: `${failed.issue}'s Dispatch Failed at ${failed.failed.step}: ${failed.failed.error}` };
  }
  const closedUnder = spec.issues.find((i) => i.builtOnClosedPr);
  if (closedUnder?.builtOnClosedPr) {
    return { issue: closedUnder.issue, reason: `${closedUnder.issue}'s Stack is built on ${closedUnder.builtOnClosedPr.url}, closed without merging` };
  }
  return undefined;
}

/** An issue is done for its Spec once it is closed or has a PR. */
function done(issue: IssueFacts) {
  return issue.closed || issue.pr !== null;
}

/** Whether `blocker` is an issue of `spec` that is done: closed, or with a PR to stack on or already merged. */
function within(spec: SpecFacts, blocker: string) {
  const issue = spec.issues.find((i) => i.issue === blocker);
  return issue !== undefined && done(issue);
}
