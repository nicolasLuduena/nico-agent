import type { Dispatch, Launch, Repo } from "../status";

/**
 * The launch the Dispatch form starts on: the last one used in the Repo (its
 * newest Dispatch's), else its implementer launch. With `harness` picked, the
 * last one used on that Harness, else that Harness on its defaults.
 */
export function startingLaunch(repo: Repo, dispatches: Dispatch[], harness?: string): Launch {
  // Oldest first, as /api/status lists them.
  const used = dispatches.filter((d) => d.repo === repo.slug).map((d) => d.implementer).reverse();
  const last = [...used, repo.implementer]
    .filter((l) => l.harness in repo.harnesses)
    .find((l) => harness === undefined || l.harness === harness);
  return last ? { harness: last.harness, model: last.model, effort: last.effort } : { harness: harness ?? repo.implementer.harness, model: null, effort: null };
}

/** A model or Effort select's options: null (the default), then what the Harness takes, or only the one chosen when it takes any. */
export function choices(valid: string[] | null, chosen: string | null): (string | null)[] {
  return [null, ...new Set([...(valid ?? []), ...(chosen === null ? [] : [chosen])])];
}

/** How many of the Repo's Dispatches are In flight: those not Closed, each holding its room. */
export const inFlight = (repo: Repo, dispatches: Dispatch[]) => dispatches.filter((d) => d.repo === repo.slug && d.closed_at === null).length;
