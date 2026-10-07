import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sameSlug } from "./slug";
import type { RepoDecision } from "./spec";
import { withFileLock } from "./state";

/**
 * The Queue of each Repo: the candidate Specs the user approved to start,
 * oldest first. Local state nico-agent owns, like the Dispatch record
 * (ADR-0002); nothing is written to a Source.
 */
export type Queues = Record<string, string[]>;

const FILE = "queue.json";

export function loadQueues(dir: string): Queues {
  let text: string;
  try {
    text = readFileSync(join(dir, FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  return (JSON.parse(text) as { queues: Queues }).queues;
}

/** The Queue of `repo`, oldest first. */
export function queueOf(queues: Queues, repo: string): string[] {
  return Object.entries(queues).find(([slug]) => sameSlug(slug, repo))?.[1] ?? [];
}

/** Put `spec` last in `repo`'s Queue, unless it is already queued. */
export function enqueue(dir: string, repo: string, spec: string): Promise<void> {
  return update(dir, repo, (queue) => (queue.some((s) => sameSpec(s, spec)) ? queue : [...queue, spec]));
}

/** Take `spec` out of `repo`'s Queue. */
export function dequeue(dir: string, repo: string, spec: string): Promise<void> {
  return update(dir, repo, (queue) => queue.filter((s) => !sameSpec(s, spec)));
}

/**
 * Drop each queued Spec that is no longer a candidate of its Repo: started,
 * Held, closed, or no longer Ready. Repos left out of `decisions` (say, ones
 * that could not be loaded) keep their Queue. Returns the Queues left.
 */
export async function pruneQueues(dir: string, decisions: RepoDecision[]): Promise<Queues> {
  const stale = (queues: Queues) => decisions.some((d) => queueOf(queues, d.repo).some((s) => !isCandidate(d, s)));
  if (!stale(loadQueues(dir))) return loadQueues(dir);
  return withFileLock(dir, FILE, () => {
    const queues = loadQueues(dir);
    for (const decision of decisions) {
      const slug = Object.keys(queues).find((s) => sameSlug(s, decision.repo));
      if (slug) queues[slug] = queues[slug]!.filter((s) => isCandidate(decision, s));
    }
    write(dir, queues);
    return queues;
  });
}

/** Prune the Queues against a loaded Board, leaving alone each Repo whose Specs could not all be loaded. */
export function pruneBoardQueues(dir: string, board: { specs: RepoDecision[]; errors: { repo: string; source?: string }[] }): Promise<Queues> {
  const loaded = board.specs.filter((d) => !board.errors.some((e) => e.source !== "git" && sameSlug(e.repo, d.repo)));
  return pruneQueues(dir, loaded);
}

function isCandidate(decision: RepoDecision, spec: string) {
  return decision.candidates.some((c) => sameSpec(c, spec));
}

function sameSpec(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function update(dir: string, repo: string, change: (queue: string[]) => string[]) {
  return withFileLock(dir, FILE, () => {
    const queues = loadQueues(dir);
    const slug = Object.keys(queues).find((s) => sameSlug(s, repo)) ?? repo;
    queues[slug] = change(queues[slug] ?? []);
    write(dir, queues);
  });
}

/** Atomic replace, so readers never need the lock. */
function write(dir: string, queues: Queues) {
  const file = join(dir, FILE);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ queues }, null, 2)}\n`);
  renameSync(tmp, file);
}
