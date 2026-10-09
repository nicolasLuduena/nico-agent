import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StackTarget } from "./stack";

/** The steps of a Dispatch, in order; each runs once, and a failed one is resumed. */
export const STEPS = ["fetch", "worktree", "tab", "agent start", "agent ready", "prompt"] as const;
export type Step = (typeof STEPS)[number];

/** The steps that launch a Reviewer in a Dispatch's workspace, in order. */
export const REVIEW_STEPS = ["tab", "agent start", "agent ready", "prompt"] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number];

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
  /** The PR a Stacked dispatch started on, kept across interrupted dispatches. */
  stackedOn?: StackTarget;
  worktree?: string;
  workspace?: string;
  implementer: Launch;
  /** The Reviewer, once a review was launched. */
  reviewer?: Reviewer;
  /** Steps done so far, in order. */
  completed: Step[];
  /** The step that failed last, until a re-run gets past it. */
  failure?: { step: Step; error: string };
  /** Whether the prompt carried the bot suffix: the GitHub App is installed on the Repo. */
  botSuffix?: boolean;
  /** Whether the issue was assigned to the user (ADR-0007); false with a warning when that failed. */
  claimed?: boolean;
  /** What went wrong without failing the Dispatch. */
  warnings?: string[];
  /** Id of the process running the steps (the Implementer's or the Reviewer's), while one is. */
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

/** A Reviewer's launch, the PR it reviews, and how far its steps got. */
export interface Reviewer extends Launch {
  /** URL of the PR under review, and the branch it merges into. */
  prUrl: string;
  prBase: string;
  completed: ReviewStep[];
  failure?: { step: ReviewStep; error: string };
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

/** Forget a Dispatch after its workspace was removed. */
export async function removeDispatch(dir: string, issue: string): Promise<void> {
  await withLock(dir, () => {
    const state = read(dir);
    delete state.dispatches[issue];
    write(dir, state);
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
  const state = JSON.parse(text) as StateFile;
  for (const dispatch of Object.values(state.dispatches)) migrate(dispatch);
  return state;
}

/** Bring a record written by an older nico-agent to the current shape. */
function migrate(dispatch: Dispatch) {
  // Records from before any open PR could be stacked on name the Blocker.
  const legacy = dispatch.stackedOn as (StackTarget & { blocker?: string }) | undefined;
  if (legacy?.blocker === undefined) return;
  const { blocker, ...target } = legacy;
  dispatch.stackedOn = { issue: target.issue ?? blocker, pr: target.pr };
}

function write(dir: string, state: StateFile) {
  writeJsonAtomic(join(dir, FILE), state);
}

/** Replace `file` with `value` as JSON atomically, so readers never need the lock and an interrupted write leaves the last state whole. */
export function writeJsonAtomic(file: string, value: unknown) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Replace `file` with `text` atomically, so a reader never sees half of it. */
export function writeTextAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Run `fn` holding an exclusive lock file shared by the CLI and a running server. */
function withLock<T>(dir: string, fn: () => T): Promise<T> {
  return withFileLock(dir, FILE, fn);
}

/** Run `fn` holding the exclusive lock on `file` in `dir`, shared by the CLI and a running server. */
export async function withFileLock<T>(dir: string, file: string, fn: () => T): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, `${file}.lock`);
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
