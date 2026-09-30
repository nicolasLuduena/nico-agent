import { sameSlug } from "./slug";
import { type Dispatch, REVIEW_STEPS } from "./state";
import { type PullRequest, type World, WorldError } from "./world";

/**
 * Where a Dispatch stands (ADR-0003): Failed at the step that failed, else
 * decided only by PR linkage. Implementing until a PR is linked, then PR
 * ready, then Review launched once the Reviewer was prompted.
 */
export function stageOf(dispatch: Dispatch, pr: PullRequest | null) {
  if (dispatch.failure) return `Failed at ${dispatch.failure.step}`;
  const { reviewer } = dispatch;
  if (reviewer?.failure) return `Failed at review ${reviewer.failure.step}`;
  if (reviewer && REVIEW_STEPS.every((s) => reviewer.completed.includes(s))) return "Review launched";
  return pr ? "PR ready" : "Implementing";
}

/** The PR of a Dispatch: one in its Repo closing the issue, the open one first, else the latest. */
export function linkedPr(prs: PullRequest[], repo: string): PullRequest | null {
  const own = prs.filter((pr) => sameSlug(pr.repo, repo));
  return own.find((pr) => pr.state === "open") ?? own.at(-1) ?? null;
}

/** Looks up the PR of an In-flight issue. */
export type PrLookup = (dispatch: Dispatch) => Promise<PullRequest | null>;

/** Asks GitHub every time. */
export function freshPrs(world: World): PrLookup {
  return async (d) => linkedPr(await world.githubLinkedPullRequests(d.repo, issueNumber(d)), d.repo);
}

const PR_CACHE_MS = 30_000;

/** Asks GitHub at most every ~30s per issue, for a Board that polls; failures are not cached. */
export function cachedPrs(world: World): PrLookup {
  const fresh = freshPrs(world);
  const cache = new Map<string, { at: number; pr: PullRequest | null }>();
  return async (d) => {
    const now = world.now().getTime();
    const hit = cache.get(d.issue);
    if (hit && now - hit.at < PR_CACHE_MS) return hit.pr;
    const pr = await fresh(d);
    cache.set(d.issue, { at: now, pr });
    return pr;
  };
}

/** An In-flight issue as the Board shows it: the Dispatch, its Stage and PR, and its agents' raw Agent state. */
export interface InFlightRow {
  dispatch: Dispatch;
  stage: string;
  pr: PullRequest | null;
  /** Why the PR could not be looked up; the Stage then ignores PRs. */
  prError?: string;
  implementerState: string;
  reviewerState?: string;
}

/** Every Dispatch's row, with one `herdr agent list` for all; agents herdr doesn't report are `unknown`. */
export async function loadInFlight(world: World, dispatches: Dispatch[], prs: PrLookup): Promise<InFlightRow[]> {
  if (dispatches.length === 0) return [];
  const [states, ...lookups] = await Promise.all([
    world.herdrAgents().then(
      (agents) => new Map(agents.map((a) => [a.name, a.state])),
      (e) => {
        if (!(e instanceof WorldError)) throw e;
        return new Map<string, string>();
      },
    ),
    ...dispatches.map((d) => prs(d).then(
      (pr) => ({ pr }),
      (e) => {
        if (!(e instanceof WorldError)) throw e;
        return { pr: null, prError: e.message };
      },
    )),
  ]);
  const stateOf = (agent: string) => states.get(agent) ?? "unknown";
  return dispatches.map((dispatch, i) => {
    const { pr, prError } = lookups[i]! as { pr: PullRequest | null; prError?: string };
    return {
      dispatch,
      stage: stageOf(dispatch, pr),
      pr,
      ...(prError && { prError }),
      implementerState: stateOf(dispatch.implementer.agent),
      ...(dispatch.reviewer && { reviewerState: stateOf(dispatch.reviewer.agent) }),
    };
  });
}

/** The issue number of a Dispatch's `owner/repo#N` key. */
export function issueNumber(dispatch: Dispatch) {
  return Number(dispatch.issue.slice(dispatch.issue.lastIndexOf("#") + 1));
}
