import { linearIdentifier } from "./linear";
import { sameSlug } from "./slug";
import { type Dispatch, REVIEW_STEPS } from "./state";
import { type PullRequest, type World, WorldError } from "./world";

/**
 * Where a Dispatch stands (ADR-0003): Failed at the step that failed, else
 * decided only by PR linkage. Implementing until a PR is linked, then PR
 * ready, then Review launched once the Reviewer was prompted. `pr` is
 * undefined when the lookup failed, which leaves the Stage `unknown`.
 */
export function stageOf(dispatch: Dispatch, pr: PullRequest | null | undefined) {
  if (dispatch.failure) return `Failed at ${dispatch.failure.step}`;
  if (dispatch.reviewer?.failure) return `Failed at review ${dispatch.reviewer.failure.step}`;
  if (isReviewLaunched(dispatch)) return "Review launched";
  if (pr === undefined) return "unknown";
  return pr ? "PR ready" : "Implementing";
}

/** Whether a Dispatch's Reviewer was prompted. */
export function isReviewLaunched(dispatch: Dispatch) {
  const { reviewer } = dispatch;
  return reviewer !== undefined && REVIEW_STEPS.every((s) => reviewer.completed.includes(s));
}

/** The Stage as of now, asking GitHub for the PR unless the record alone decides it. */
export async function currentStage(world: World, dispatch: Dispatch) {
  const stage = stageOf(dispatch, undefined);
  if (stage !== "unknown") return stage;
  return stageOf(dispatch, await freshPrs(world)(dispatch).catch(unlessWorldError));
}

/** Undefined for an adapter failure; anything else is a bug and propagates. */
function unlessWorldError(e: unknown): undefined {
  if (e instanceof WorldError) return undefined;
  throw e;
}

/** The PR of a Dispatch: one in its Repo closing the issue, the open one first, else the latest. */
export function linkedPr(prs: PullRequest[], repo: string): PullRequest | null {
  const own = prs.filter((pr) => sameSlug(pr.repo, repo));
  return own.find((pr) => pr.state === "open") ?? own.at(-1) ?? null;
}

/** Looks up the PR of an In-flight issue. */
export type PrLookup = (dispatch: Dispatch) => Promise<PullRequest | null>;

/** Asks GitHub (and Linear, for a Linear issue) every time. */
export function freshPrs(world: World): PrLookup {
  return async (d) => linkedPr(await linkedPrs(world, d), d.repo);
}

/**
 * The PRs linked to a Dispatch's issue (ADR-0003): GitHub's closing
 * references, or for a Linear issue its GitHub PR attachments in the
 * dispatched Repo, with their state read from GitHub.
 */
export async function linkedPrs(world: World, dispatch: Dispatch): Promise<PullRequest[]> {
  const identifier = linearIdentifier(dispatch.issue);
  if (!identifier) return world.githubLinkedPullRequests(dispatch.repo, issueNumber(dispatch));
  return linearPullRequests(world, identifier, dispatch.repo);
}

/**
 * A Linear issue's GitHub PR attachments in `repo`, with their state read from
 * GitHub. Attachments in other repos are ignored.
 */
export async function linearPullRequests(world: World, identifier: string, repo: string): Promise<PullRequest[]> {
  const numbers = new Set<number>();
  for (const url of await world.linearAttachmentUrls(identifier)) {
    const match = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/i);
    if (match && sameSlug(match[1]!, repo)) numbers.add(Number(match[2]));
  }
  const prs = await Promise.all([...numbers].map((n) => world.githubPullRequest(repo, n)));
  // Closed unmerged PRs are left out, as GitHub's closing references leave them out.
  return prs.filter((pr): pr is PullRequest => pr !== null && pr.state !== "closed");
}

const PR_CACHE_MS = 30_000;

/** Asks GitHub at most every ~30s per issue, for a Board that polls; a failure is kept as long, so an outage isn't asked every poll. */
export function cachedPrs(world: World): PrLookup {
  const fresh = freshPrs(world);
  const cache = new Map<string, { at: number; pr: PullRequest | null } | { at: number; error: WorldError }>();
  return async (d) => {
    const now = world.now().getTime();
    const hit = cache.get(d.issue);
    if (hit && now - hit.at < PR_CACHE_MS) {
      if ("error" in hit) throw hit.error;
      return hit.pr;
    }
    try {
      const pr = await fresh(d);
      cache.set(d.issue, { at: now, pr });
      return pr;
    } catch (e) {
      if (e instanceof WorldError) cache.set(d.issue, { at: now, error: e });
      throw e;
    }
  };
}

/** An In-flight issue as the Board shows it: the Dispatch, its Stage and PR, and its agents' raw Agent state. */
export interface InFlightRow {
  dispatch: Dispatch;
  stage: string;
  pr: PullRequest | null;
  /** Why the PR could not be looked up; the Stage is then `unknown` unless the record decides it. */
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
        return { pr: undefined, prError: e.message };
      },
    )),
  ]);
  const stateOf = (agent: string) => states.get(agent) ?? "unknown";
  return dispatches.map((dispatch, i) => {
    const { pr, prError } = lookups[i]! as { pr: PullRequest | null | undefined; prError?: string };
    return {
      dispatch,
      stage: stageOf(dispatch, pr),
      pr: pr ?? null,
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
