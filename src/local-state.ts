import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Board, emptyBoard, mergeBoards, specLoadErrors } from "./board";
import type { Repo } from "./config";
import type { Events } from "./events";
import { writeJsonAtomic } from "./state";

/** Where `serve` keeps its Local state between runs, in the config directory (ADR-0015). */
export const STATE_FILE = "state.json";

/** How long one Repo's share of a Sync may take before it counts as failed, so a hung Repo never stalls the Syncs after it. */
export const REPO_SYNC_TIMEOUT_MS = 60_000;

/** The parts of Local state, each read again by the page when a Sync changes it; `sync` is the Sync itself, starting or ending. */
export type PartName = "board" | "repos" | "stats" | "partners" | "sync";

/** One Repo's latest Sync: when its Board last loaded, and why its latest Sync failed, if it did. */
export interface RepoSync {
  repo: string;
  at?: string;
  error?: string;
  failedAt?: string;
}

/** What `GET /api/sync` answers: whether a Sync runs now, when the last one ended, and each Repo's. */
export interface SyncStatus {
  syncing: boolean;
  at?: string;
  repos: RepoSync[];
}

/** A CLI command's answer as `--json` gives it, and its exit code. */
export interface Answer {
  value: unknown;
  exitCode: number;
}

/** A part as its last Sync left it. */
interface Part extends Answer {
  syncedAt: string;
}

/** One Repo's share of the Board: the last that loaded and when, and why its latest Sync failed, if it did. */
interface RepoBoard {
  board: Board;
  syncedAt?: string;
  error?: { error: string; at: string };
}

interface Saved {
  /** When the last Sync ended. */
  syncedAt?: string;
  board?: Part;
  repos?: Part;
  partners?: Part;
  /** Each `stats` read, by its arguments. */
  stats: Record<string, Part>;
  /** Each configured Repo's share of the Board, by slug. */
  repoBoards: Record<string, RepoBoard>;
}

/** Where a Sync reads git, GitHub and the rest from: `serve`'s commands, run in-process. */
export interface SyncSources {
  /** The configured Repos. */
  repos(): Repo[];
  /** One Repo's Board, with the Dispatches In flight in it. */
  loadBoard(repo: Repo): Promise<Board>;
  /** The Board as `board --json` answers it, from the Repos' Boards merged. */
  renderBoard(board: Board): Promise<Answer>;
  /** A read-only command's `--json` answer, such as `partner list`. */
  read(argv: string[]): Promise<Answer>;
  /** Each herdr agent's state, by name. */
  agentStates(): Promise<Map<string, string>>;
}

export interface LocalState {
  /**
   * The answer to `argv` (with `--json`) from Local state, for the reads it
   * holds; null for any other command, which the CLI answers.
   */
  answer(argv: string[]): Promise<{ stdout: string; exitCode: number }> | null;
  /** Sync now; a Sync asked for while one runs joins it. */
  sync(): Promise<void>;
  /**
   * Sync once more after any Sync that runs, for a change it may have read
   * too early, such as an action's; several asked for meanwhile are one.
   */
  syncAgain(): Promise<void>;
  /** Whether a Sync runs now, when the last ended, and how each Repo's went. */
  status(): SyncStatus;
  /**
   * Read herdr again, without git or GitHub: the agent states on the Board
   * and the Partners, which change outside nico-agent between Syncs. While a
   * Sync runs, it waits for that Sync instead.
   */
  refresh(): Promise<void>;
}

/**
 * `serve`'s Local state (ADR-0015): the Board, the configured Repos, stats
 * and Partners, read back from `state.json` at start and written after each
 * Sync. Each Repo syncs on its own: one that fails keeps its last Board and
 * records its error, and one that is slow holds up no other. A Sync that
 * changes a part emits `state-changed` naming it.
 */
export function localState(configDir: string, sources: SyncSources, events: Events, now: () => Date): LocalState {
  const saved = load(configDir);
  let running: Promise<void> | null = null;

  /** Set `name` to `answer`, telling the page when it changed; the Board's own Sync times never count as a change. */
  const set = (name: Exclude<PartName, "stats" | "sync">, answer: Answer) => {
    const before = saved[name];
    saved[name] = { ...answer, syncedAt: now().toISOString() };
    if (!before || changed(before, answer)) events.emit("state-changed", { parts: [name] });
  };

  // Renders run one at a time, so a Repo that finished late never overwrites a later render with an older one.
  let rendering = Promise.resolve();
  const renderBoard = () => {
    rendering = rendering.then(async () => {
      const repos = sources.repos();
      const boards = repos.map((r) => saved.repoBoards[slugKey(r.slug)]?.board ?? emptyBoard());
      const answer = await sources.renderBoard(mergeBoards(boards));
      const synced = { at: now().toISOString(), repos: repoSyncs(repos) };
      set("board", { ...answer, value: { ...(answer.value as object), synced } });
    }).catch((e) => console.error(`sync: the Board failed to render: ${errorMessage(e)}`));
    return rendering;
  };

  /** How each of `repos` last synced, in their order. */
  const repoSyncs = (repos: Repo[]): RepoSync[] => repos.map((r) => {
    const part = saved.repoBoards[slugKey(r.slug)];
    return { repo: r.slug, ...(part?.syncedAt && { at: part.syncedAt }), ...(part?.error && { error: part.error.error, failedAt: part.error.at }) };
  });

  const syncRepo = async (repo: Repo) => {
    const key = slugKey(repo.slug);
    const last = saved.repoBoards[key];
    const failed = (error: string, board?: Board) => {
      saved.repoBoards[key] = { ...last, board: last?.board ?? board ?? emptyBoard(), error: { error, at: now().toISOString() } };
    };
    try {
      const board = await withTimeout(sources.loadBoard(repo), REPO_SYNC_TIMEOUT_MS, `its Sync took over ${REPO_SYNC_TIMEOUT_MS / 1000}s`);
      const errors = specLoadErrors(board.errors);
      if (errors.length) failed(errors.map((e) => e.error).join("; "), board);
      else saved.repoBoards[key] = { board, syncedAt: now().toISOString() };
    } catch (e) {
      failed(errorMessage(e));
    }
    await renderBoard();
  };

  const syncPart = async (name: Exclude<PartName, "board" | "stats" | "sync">, argv: string[]) => {
    try {
      set(name, await sources.read(argv));
    } catch (e) {
      console.error(`sync: ${argv.join(" ")} failed: ${errorMessage(e)}`);
    }
  };

  const syncStats = async () => {
    let any = false;
    for (const key of Object.keys(saved.stats)) {
      try {
        const answer = await sources.read(statsArgv(key));
        any ||= changed(saved.stats[key]!, answer);
        saved.stats[key] = { ...answer, syncedAt: now().toISOString() };
      } catch (e) {
        console.error(`sync: stats ${key} failed: ${errorMessage(e)}`);
      }
    }
    if (any) events.emit("state-changed", { parts: ["stats"] });
  };

  const runSync = async () => {
    const repos = sources.repos();
    // A Repo no longer configured leaves the Board with its share.
    for (const key of Object.keys(saved.repoBoards)) {
      if (!repos.some((r) => slugKey(r.slug) === key)) delete saved.repoBoards[key];
    }
    await Promise.all([
      repos.length ? Promise.all(repos.map(syncRepo)) : renderBoard(),
      syncPart("repos", ["repo", "list"]),
      syncPart("partners", ["partner", "list"]),
    ]);
    // Stats count what the Board's Sync just saw.
    await syncStats();
    saved.syncedAt = now().toISOString();
    try {
      writeJsonAtomic(join(configDir, STATE_FILE), saved);
    } catch (e) {
      console.error(`sync: could not save ${STATE_FILE}: ${errorMessage(e)}`);
    }
  };

  // The page shows a Sync running, so it hears of each one starting and ending.
  const sync = () => {
    if (running) return running;
    running = runSync().finally(() => {
      running = null;
      events.emit("state-changed", { parts: ["sync"] });
    });
    events.emit("state-changed", { parts: ["sync"] });
    return running;
  };

  /** Whether a Sync runs now, when the last ended, and how each configured Repo's went. */
  const status = (): SyncStatus => ({ syncing: running !== null, ...(saved.syncedAt && { at: saved.syncedAt }), repos: repoSyncs(sources.repos()) });

  let again: Promise<void> | null = null;
  const syncAgain = () => {
    if (!running) return sync();
    again ??= running.catch(() => {}).then(() => {
      again = null;
      return sync();
    });
    return again;
  };

  const refresh = async () => {
    if (running) return running;
    let states: Map<string, string>;
    try {
      states = await sources.agentStates();
    } catch (e) {
      console.error(`refresh: herdr failed: ${errorMessage(e)}`);
      return;
    }
    const stateOf = (agent: string) => states.get(agent) ?? "unknown";
    for (const part of Object.values(saved.repoBoards)) {
      part.board = {
        ...part.board,
        inFlight: part.board.inFlight.map((row) => ({
          ...row,
          implementerState: stateOf(row.dispatch.implementer.agent),
          ...(row.dispatch.reviewer && { reviewerState: stateOf(row.dispatch.reviewer.agent) }),
        })),
      };
    }
    await Promise.all([renderBoard(), syncPart("partners", ["partner", "list"])]);
  };

  /** A part as its last Sync left it; before any Sync ever ran, once the first one ends. */
  const part = async (get: () => Part | undefined) => {
    if (!get()) await sync().catch((e) => console.error(`sync failed: ${errorMessage(e)}`));
    return get();
  };

  const answer = (argv: string[]) => {
    if (!argv.includes("--json")) return null;
    const words = argv.filter((a) => a !== "--json");
    const [first, second] = words;
    if (words.length === 1 && first === "board") return reply(part(() => saved.board));
    // The Repos are config, read as it is now.
    if (words.length === 2 && first === "repo" && second === "list") return reply(repos());
    if (words.length === 2 && first === "partner" && second === "list") return reply(part(() => saved.partners));
    if (first === "stats") return reply(statsPart(words.slice(1).join(" ")));
    return null;
  };

  const repos = async () => {
    set("repos", await sources.read(["repo", "list"]));
    return saved.repos;
  };

  /** A `stats` read: counted from local records only, so one not asked for before is counted now and kept for the next Syncs. */
  const statsPart = async (key: string) => {
    const kept = saved.stats[key];
    if (kept) return kept;
    const answer = await sources.read(statsArgv(key));
    const counted = { ...answer, syncedAt: now().toISOString() };
    if (answer.exitCode === 0) saved.stats[key] = counted;
    return counted;
  };

  return { answer, sync, syncAgain, status, refresh };
}

/** `promise`, or a failure saying `why` once `ms` pass first. */
function withTimeout<T>(promise: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(why)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `stats` with the arguments `key` keeps, as they were given. */
function statsArgv(key: string) {
  return ["stats", ...(key ? key.split(" ") : [])];
}

async function reply(part: Promise<Answer | undefined>) {
  const answer = await part;
  if (!answer) return { stdout: `${JSON.stringify({ error: "Local state could not be synced" })}\n`, exitCode: 1 };
  return { stdout: `${JSON.stringify(answer.value, null, 2)}\n`, exitCode: answer.exitCode };
}

/** Whether `after` differs from `before`, their Sync times aside. */
function changed(before: Answer, after: Answer) {
  return JSON.stringify(withoutSynced(before)) !== JSON.stringify(withoutSynced(after));
}

/** An answer without its Sync times. */
function withoutSynced({ value, exitCode }: Answer) {
  if (value === null || typeof value !== "object") return { value, exitCode };
  const { synced: _, ...rest } = value as Record<string, unknown>;
  return { value: rest, exitCode };
}

function slugKey(slug: string) {
  return slug.toLowerCase();
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** What `state.json` holds, or nothing yet; a file that cannot be read costs only a Sync. */
function load(configDir: string): Saved {
  const empty: Saved = { stats: {}, repoBoards: {} };
  try {
    const saved = JSON.parse(readFileSync(join(configDir, STATE_FILE), "utf8")) as Partial<Saved>;
    return { ...empty, ...saved, stats: saved.stats ?? {}, repoBoards: saved.repoBoards ?? {} };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error(`sync: ignoring ${STATE_FILE}: ${errorMessage(e)}`);
    return empty;
  }
}
