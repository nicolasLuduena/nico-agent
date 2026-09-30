import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The steps of a Dispatch, in order; each runs once, and a failed one is resumed. */
export const STEPS = ["fetch", "worktree", "tab", "agent start", "agent ready", "prompt"] as const;
export type Step = (typeof STEPS)[number];

/**
 * The local record of one Dispatch (ADR-0002), keyed by its issue. It is
 * written before the first step, so ids appear as the steps that create them
 * complete.
 */
export interface Dispatch {
  /** `owner/repo#N`, with the Repo's configured slug. */
  issue: string;
  title: string;
  url: string;
  repo: string;
  branch: string;
  base?: string;
  worktree?: string;
  workspace?: string;
  implementer: Launch;
  /** Steps done so far, in order. */
  completed: Step[];
  /** The step that failed last, until a re-run gets past it. */
  failure?: { step: Step; error: string };
  /** Whether the prompt carried the bot suffix: the GitHub App is installed on the Repo. */
  bot?: boolean;
  /** Whether the issue was assigned to the user (ADR-0007); false with a warning when that failed. */
  claimed?: boolean;
  /** What went wrong without failing the Dispatch. */
  warnings?: string[];
  /** Id of the process running the steps, while one is. */
  runner?: number;
  createdAt: string;
  updatedAt: string;
}

/** Where an agent was launched, and with which Harness, model and Effort. */
export interface Launch {
  tab?: string;
  pane?: string;
  agent: string;
  harness: string;
  model: string;
  effort: string;
}

interface StateFile {
  dispatches: Record<string, Dispatch>;
}

const FILE = "dispatches.json";
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 15_000;

export function loadDispatches(dir: string): Dispatch[] {
  return Object.values(read(dir).dispatches);
}

export function findDispatch(dir: string, issue: string): Dispatch | undefined {
  return read(dir).dispatches[issue];
}

/** Record a Dispatch; false when its issue already has one. */
export async function addDispatch(dir: string, dispatch: Dispatch): Promise<boolean> {
  return withLock(dir, () => {
    const state = read(dir);
    if (state.dispatches[dispatch.issue]) return false;
    state.dispatches[dispatch.issue] = dispatch;
    write(dir, state);
    return true;
  });
}

/**
 * Take over running a Dispatch's steps for process `pid`, if `canTake` allows
 * it; null when there is no record or it is not free to take.
 */
export async function leaseDispatch(
  dir: string,
  issue: string,
  pid: number,
  canTake: (dispatch: Dispatch) => boolean,
): Promise<Dispatch | null> {
  return withLock(dir, () => {
    const state = read(dir);
    const dispatch = state.dispatches[issue];
    if (!dispatch || !canTake(dispatch)) return null;
    dispatch.runner = pid;
    write(dir, state);
    return dispatch;
  });
}

/** Replace the record of a Dispatch that was added. */
export async function saveDispatch(dir: string, dispatch: Dispatch): Promise<void> {
  await withLock(dir, () => {
    const state = read(dir);
    state.dispatches[dispatch.issue] = dispatch;
    write(dir, state);
  });
}

/** Where a Dispatch stands: Failed at its failed step, else Implementing (ADR-0003 adds the PR Stages). */
export function stageOf(dispatch: Dispatch) {
  return dispatch.failure ? `Failed at ${dispatch.failure.step}` : "Implementing";
}

function read(dir: string): StateFile {
  let text: string;
  try {
    text = readFileSync(join(dir, FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { dispatches: {} };
    throw e;
  }
  return JSON.parse(text) as StateFile;
}

/** Atomic replace, so readers never need the lock. */
function write(dir: string, state: StateFile) {
  const file = join(dir, FILE);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Run `fn` holding an exclusive lock file shared by the CLI and a running server. */
async function withLock<T>(dir: string, fn: () => T): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, `${FILE}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    if (isStale(lock)) {
      try {
        unlinkSync(lock);
      } catch {}
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}; delete it if no nico-agent is running`);
    await Bun.sleep(5 + Math.random() * 20);
  }
  try {
    return fn();
  } finally {
    unlinkSync(lock);
  }
}

function isStale(lock: string) {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}
