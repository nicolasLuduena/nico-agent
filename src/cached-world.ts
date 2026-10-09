import { RateLimited, type World, WorldError } from "./world";

/** How long `serve` reuses a GitHub read, for every Board, the Lead's `board` tool and `advance` alike. */
export const GITHUB_READ_CACHE_MS = 60_000;

/** The GitHub reads the Board makes; writes (the Claim) and PR activity always go through. */
const CACHED_READS = new Set<keyof World>([
  "githubViewer",
  "githubIssues",
  "githubIssue",
  "githubIssueDescription",
  "githubSubIssues",
  "githubAppRepos",
  "githubLinkedPullRequests",
  "githubPullRequest",
  "githubBranchPullRequests",
]);

type Entry = { at: number; value: unknown } | { at: number; error: WorldError };

/**
 * `world` with its GitHub reads kept for `ms`, keyed by method and arguments,
 * and `forget`, which drops them all, for when nico-agent changed something itself.
 * A failure is kept as long, so a failing GitHub isn't asked again on every poll.
 * Once GitHub answers any call with its rate limit, no GitHub call goes out until the reset.
 */
export function cachingGitHubReads(world: World, ms = GITHUB_READ_CACHE_MS): { world: World; forget(): void } {
  const cache = new Map<string, Entry>();
  let limit: RateLimited | null = null;
  const call = async (target: World, member: Function, args: unknown[]) => {
    if (limit && target.now() < limit.resumesAt) throw limit;
    try {
      return await member.apply(target, args);
    } catch (e) {
      if (e instanceof RateLimited) limit = e;
      throw e;
    }
  };
  const cached = new Proxy(world, {
    get(target, name, receiver) {
      const member = Reflect.get(target, name, receiver);
      if (typeof member !== "function") return member;
      if (!String(name).startsWith("github")) return member.bind(target);
      if (!CACHED_READS.has(name as keyof World)) return (...args: unknown[]) => call(target, member, args);
      return async (...args: unknown[]) => {
        const key = `${String(name)} ${JSON.stringify(args)}`;
        const now = target.now().getTime();
        const hit = cache.get(key);
        if (hit && now - hit.at < ms) {
          if ("error" in hit) throw hit.error;
          return hit.value;
        }
        try {
          const value = await call(target, member, args);
          cache.set(key, { at: now, value });
          return value;
        } catch (e) {
          // A rate limit is held off by its reset time instead, which may come sooner.
          if (e instanceof WorldError && !(e instanceof RateLimited)) cache.set(key, { at: now, error: e });
          throw e;
        }
      };
    },
  });
  return { world: cached, forget: () => cache.clear() };
}
