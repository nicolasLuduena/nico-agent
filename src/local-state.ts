import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Board, emptyBoard, mergeBoards, specLoadErrors } from "./board";
import type { Repo } from "./config";
import type { Events } from "./events";
import { writeJsonAtomic } from "./state";

/** Where `serve` keeps its Local state between runs, in the config directory (ADR-0015). */
export const STATE_FILE = "state.json";

/** The parts of Local state, each read again by the page when a Sync changes it. */
export type PartName = "board" | "repos" | "stats" | "partners";

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
}

export interface LocalState {
  /**
   * The answer to `argv` (with `--json`) from Local state, for the reads it
   * holds; null for any other command, which the CLI answers.
   */
  answer(argv: string[]): Promise<{ stdout: string; exitCode: number }> | null;
  /** Sync now; a Sync asked for while one runs joins it. */
  sync(): Promise<void>;
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
  const set = (name: Exclude<PartName, "stats">, answer: Answer) => {
    const before = saved[name];
    saved[name] = { ...answer, syncedAt: now().toISOString() };
    if (!before || JSON.stringify(withoutSynced(before)) !== JSON.stringify(withoutSynced(answer))) events.emit("state-changed", { parts: [name] });
  };

  // Renders run one at a time, so a Repo that finished late never overwrites a later render with an older one.
  let rendering = Promise.resolve();
  const renderBoard = () => {
    rendering = rendering.then(async () => {
      const repos = sources.repos();
      const boards = repos.map((r) => saved.repoBoards[slugKey(r.slug)]?.board ?? emptyBoard());
      const answer = await sources.renderBoard(mergeBoards(boards));
      const synced = {
        at: now().toISOString(),
        repos: repos.map((r) => {
          const part = saved.repoBoards[slugKey(r.slug)];
          return { repo: r.slug, ...(part?.syncedAt && { at: part.syncedAt }), ...(part?.error && { error: part.error.error, failedAt: part.error.at }) };
        }),
      };
      set("board", { ...answer, value: { ...(answer.value as object), synced } });
    }).catch((e) => console.error(`sync: the Board failed to render: ${errorMessage(e)}`));
    return rendering;
  };

  const syncRepo = async (repo: Repo) => {
    const key = slugKey(repo.slug);
    const last = saved.repoBoards[key];
    const failed = (error: string, board?: Board) => {
      saved.repoBoards[key] = { ...last, board: last?.board ?? board ?? emptyBoard(), error: { error, at: now().toISOString() } };
    };
    try {
      const board = await sources.loadBoard(repo);
      const errors = specLoadErrors(board.errors);
      if (errors.length) failed(errors.map((e) => e.error).join("; "), board);
      else saved.repoBoards[key] = { board, syncedAt: now().toISOString() };
    } catch (e) {
      failed(errorMessage(e));
    }
    await renderBoard();
  };

  const syncPart = async (name: Exclude<PartName, "board" | "stats">, argv: string[]) => {
    try {
      set(name, await sources.read(argv));
    } catch (e) {
      console.error(`sync: ${argv.join(" ")} failed: ${errorMessage(e)}`);
    }
  };

  const syncStats = async () => {
    for (const key of Object.keys(saved.stats)) {
      try {
        const answer = await sources.read(statsArgv(key));
        const before = saved.stats[key];
        saved.stats[key] = { ...answer, syncedAt: now().toISOString() };
        if (before && JSON.stringify(withoutSynced(before)) !== JSON.stringify(withoutSynced(answer))) events.emit("state-changed", { parts: ["stats"] });
      } catch (e) {
        console.error(`sync: stats ${key} failed: ${errorMessage(e)}`);
      }
    }
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

  const sync = () => {
    running ??= runSync().finally(() => {
      running = null;
    });
    return running;
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
    if (words.length === 2 && first === "repo" && second === "list") return reply(part(() => saved.repos));
    if (words.length === 2 && first === "partner" && second === "list") return reply(part(() => saved.partners));
    if (first === "stats") return reply(statsPart(words.slice(1).join(" ")));
    return null;
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

  return { answer, sync };
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

/** An answer without its Sync times, to tell whether a Sync changed it. */
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
