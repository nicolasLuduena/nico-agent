import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The local record of one Dispatch (ADR-0002), keyed by its issue. */
export interface Dispatch {
  /** `owner/repo#N`, with the Repo's configured slug. */
  issue: string;
  title: string;
  url: string;
  repo: string;
  branch: string;
  base: string;
  worktree: string;
  workspace: string;
  implementer: Agent;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  tab: string;
  pane: string;
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
