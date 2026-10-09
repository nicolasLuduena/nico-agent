import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specLoadErrors } from "./board";
import { sameSlug } from "./slug";
import { type RepoDecision, isCandidate, sameSpec } from "./spec";
import { withFileLock, writeJsonAtomic } from "./state";

/**
 * The Queue of each Repo: the candidate Specs the user approved to start,
 * in the order the user set. Local state nico-agent owns, like the Dispatch record
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

/** The Queue of `repo`, head first. */
export function queueOf(queues: Queues, repo: string): string[] {
  return Object.entries(queues).find(([slug]) => sameSlug(slug, repo))?.[1] ?? [];
}

/** A Queue edit's result: the Queue left, head first, and whether the edit changed it. */
export interface QueueChange {
  queue: string[];
  changed: boolean;
}

/** Put `spec` last in `repo`'s Queue, unless it is already queued. */
export function enqueue(dir: string, repo: string, spec: string): Promise<QueueChange> {
  return update(dir, repo, (queue) => (queue.some((s) => sameSpec(s, spec)) ? queue : [...queue, spec]));
}

/** Take `spec` out of `repo`'s Queue. */
export function dequeue(dir: string, repo: string, spec: string): Promise<QueueChange> {
  return update(dir, repo, (queue) => (queue.some((s) => sameSpec(s, spec)) ? queue.filter((s) => !sameSpec(s, spec)) : queue));
}

/** Swap `spec` with its neighbour toward the head (`up`) or the tail (`down`); at that end, or not queued, nothing moves. */
export function move(dir: string, repo: string, spec: string, direction: "up" | "down"): Promise<QueueChange> {
  return update(dir, repo, (queue) => {
    const from = queue.findIndex((s) => sameSpec(s, spec));
    const to = from + (direction === "up" ? -1 : 1);
    if (from < 0 || to < 0 || to >= queue.length) return queue;
    const moved = [...queue];
    [moved[from], moved[to]] = [moved[to]!, moved[from]!];
    return moved;
  });
}

/**
 * Drop each queued Spec that is no longer a candidate of its Repo: started,
 * Held, closed, or no longer Ready. Repos left out of `decisions` (say, ones
 * that could not be loaded) keep their Queue. Returns the Queues left.
 */
export function pruneQueues(dir: string, decisions: RepoDecision[]): Promise<Queues> {
  return withFileLock(dir, FILE, () => {
    const queues = loadQueues(dir);
    let stale = false;
    for (const decision of decisions) {
      const slug = Object.keys(queues).find((s) => sameSlug(s, decision.repo));
      if (!slug) continue;
      const kept = queues[slug]!.filter((s) => isCandidate(decision, s));
      stale ||= kept.length !== queues[slug]!.length;
      queues[slug] = kept;
    }
    if (stale) write(dir, queues);
    return queues;
  });
}

/** Prune the Queues against a loaded Board, leaving alone each Repo whose Specs could not all be loaded. */
export function pruneBoardQueues(dir: string, board: { specs: RepoDecision[]; errors: { repo: string; source?: string }[] }): Promise<Queues> {
  const failed = specLoadErrors(board.errors);
  return pruneQueues(dir, board.specs.filter((d) => !failed.some((e) => sameSlug(e.repo, d.repo))));
}

function update(dir: string, repo: string, change: (queue: string[]) => string[]): Promise<QueueChange> {
  return withFileLock(dir, FILE, () => {
    const queues = loadQueues(dir);
    const slug = Object.keys(queues).find((s) => sameSlug(s, repo)) ?? repo;
    const before = queues[slug] ?? [];
    const queue = change(before);
    if (queue === before) return { queue, changed: false };
    queues[slug] = queue;
    write(dir, queues);
    return { queue, changed: true };
  });
}

function write(dir: string, queues: Queues) {
  writeJsonAtomic(join(dir, FILE), { queues });
}
