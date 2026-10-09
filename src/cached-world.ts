import { type World, WorldError } from "./world";

/** How long `serve` reuses a GitHub read: the app refetches the Board every 10s, GitHub need not hear of each. */
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
 * `world` with its GitHub reads kept for `ms`, keyed by method and arguments.
 * A failure is kept as long, so a rate-limited GitHub isn't asked again on every poll.
 */
export function cachingGitHubReads(world: World, ms = GITHUB_READ_CACHE_MS): World {
  const cache = new Map<string, Entry>();
  return new Proxy(world, {
    get(target, name, receiver) {
      const member = Reflect.get(target, name, receiver);
      if (typeof member !== "function") return member;
      if (!CACHED_READS.has(name as keyof World)) return member.bind(target);
      return async (...args: unknown[]) => {
        const key = `${String(name)} ${JSON.stringify(args)}`;
        const now = target.now().getTime();
        const hit = cache.get(key);
        if (hit && now - hit.at < ms) {
          if ("error" in hit) throw hit.error;
          return hit.value;
        }
        try {
          const value = await member.apply(target, args);
          cache.set(key, { at: now, value });
          return value;
        } catch (e) {
          if (e instanceof WorldError) cache.set(key, { at: now, error: e });
          throw e;
        }
      };
    },
  });
}
