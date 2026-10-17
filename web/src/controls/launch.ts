import type { Dispatch, Launch, Repo } from "../status";

/**
 * The launch the Dispatch form starts on: the last one used in the Repo (its
 * newest Dispatch's), else its implementer launch. With `harness` picked, the
 * last one used on that Harness, else that Harness on its defaults.
 */
export function startingLaunch(repo: Repo, dispatches: Dispatch[], harness?: string): Launch {
  // Oldest first, as /api/status lists them.
  const used = dispatches.filter((d) => d.repo === repo.slug).map((d) => d.implementer).reverse();
  const last = [...used, repo.implementer.value]
    .filter((l) => l.harness in repo.harnesses)
    .find((l) => harness === undefined || l.harness === harness);
  return last ? { harness: last.harness, model: last.model, effort: last.effort } : { harness: harness ?? repo.implementer.value.harness, model: null, effort: null };
}

/** The Harness a Dispatch on `implementer` is reviewed on while nothing sets the Reviewer: the first other by name, as serve picks it. */
export const otherHarness = (harnesses: string[], implementer: string) => [...harnesses].sort().find((h) => h !== implementer) ?? implementer;

/** The default Reviewer's rule, by what it picks for each Implementer: "codex for claude, claude for codex and opencode". */
export function ruleSaid(harnesses: string[]): string {
  const by = new Map<string, string[]>();
  for (const h of [...harnesses].sort()) {
    const other = otherHarness(harnesses, h);
    by.set(other, [...(by.get(other) ?? []), h]);
  }
  const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);
  return [...by].map(([reviewer, implementers]) => `${reviewer} for ${and(implementers)}`).join(", ");
}

/** A model or Effort select's options: null (the default), then what the Harness takes, or only the one chosen when it takes any. */
export function choices(valid: string[] | null, chosen: string | null): (string | null)[] {
  return [null, ...new Set([...(valid ?? []), ...(chosen === null ? [] : [chosen])])];
}

/** How many of the Repo's Dispatches are In flight: those not Closed, each holding its room. */
export const inFlight = (repo: Repo, dispatches: Dispatch[]) => dispatches.filter((d) => d.repo === repo.slug && d.closed_at === null).length;
