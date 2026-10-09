import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** The window a Lead's model is taken to have when config sets none; Claude Code records none in its transcript. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** The window of a model run with Claude Code's `[1m]` suffix, such as `opus[1m]`. */
export const LONG_CONTEXT_WINDOW = 1_000_000;

/** The share of its window, in percent, above which the Lead's context is a warning. */
export const DEFAULT_CONTEXT_WARNING = 80;

/** How full the Lead's context is after its latest turn, as `lead status` reports it. */
export interface LeadContext {
  /** The context in use: the newest assistant entry's input, cache creation and cache read tokens. */
  tokens: number;
  window: number;
  /** `tokens` over `window`, in whole percent. */
  percent: number;
  /** Whether `percent` is above the warning threshold, so a restart is due. */
  warning: boolean;
  /** The id of the Claude Code session it was read from. */
  session: string;
}

export interface LeadContextRequest {
  /** Claude Code's config directory, `~/.claude` unless `CLAUDE_CONFIG_DIR` says otherwise. */
  claude: string;
  /** The Lead's home, which is its cwd. */
  home: string;
  /** When the running Lead was started: a transcript last written before is an earlier Lead's. */
  startedAt: Date;
  /** The Lead's model, as it was launched with. */
  model: string;
  /** The window config sets, over the model's default. */
  window?: number;
  /** The warning threshold config sets, in percent. */
  warning?: number;
}

/**
 * How full the Lead's context is: read from the newest transcript Claude Code
 * wrote for the Lead's home since the Lead started, its newest assistant
 * entry's usage over the window. Null when there is none, as for a Lead on
 * another Harness or one that has not answered yet.
 */
export function leadContext(request: LeadContextRequest): LeadContext | null {
  const session = currentSession(join(request.claude, "projects", sessionsDirName(request.home)), request.startedAt);
  if (!session) return null;
  const tokens = lastContextTokens(session);
  if (tokens === null) return null;
  const window = request.window ?? defaultWindow(request.model);
  const percent = Math.round((tokens / window) * 100);
  return { tokens, window, percent, warning: percent > (request.warning ?? DEFAULT_CONTEXT_WARNING), session: basename(session, ".jsonl") };
}

/** Claude Code's directory name for a cwd's sessions: every character but a letter or digit made `-`. */
function sessionsDirName(cwd: string) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

function defaultWindow(model: string) {
  return /\[1m\]$/i.test(model) ? LONG_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
}

/** The newest transcript in `dir` written since `since`, or null. */
function currentSession(dir: string, since: Date): string | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return null;
  }
  let newest: { file: string; at: number } | null = null;
  for (const name of names) {
    const file = join(dir, name);
    try {
      const at = statSync(file).mtimeMs;
      if (!newest || at > newest.at) newest = { file, at };
    } catch {
      // Gone since it was listed.
    }
  }
  return newest && newest.at >= since.getTime() ? newest.file : null;
}

/** How much of a transcript is read at a time, from its end. */
const CHUNK = 64 * 1024;

/**
 * The context in use after the newest assistant entry of `file` with usage,
 * read backwards from the end, so a long session costs only its last turn.
 */
function lastContextTokens(file: string): number | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    let end = fstatSync(fd).size;
    // The bytes of the line cut by the last chunk read, carried to the next.
    let carry = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const chunk = Buffer.alloc(end - start);
      readSync(fd, chunk, 0, chunk.length, start);
      const text = Buffer.concat([chunk, carry]);
      // The first line is whole only at the file's start.
      const firstBreak = start === 0 ? -1 : text.indexOf(0x0a);
      const lines = text.subarray(firstBreak + 1).toString("utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const tokens = contextTokens(lines[i]!);
        if (tokens !== null) return tokens;
      }
      carry = firstBreak === -1 ? Buffer.alloc(0) : text.subarray(0, firstBreak);
      end = start;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/** A transcript line's context in use, when it is a main-chain assistant entry with usage. */
function contextTokens(line: string): number | null {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  let entry: { type?: string; isSidechain?: boolean; message?: { usage?: Record<string, unknown> } };
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = entry.message?.usage;
  if (entry.type !== "assistant" || entry.isSidechain || !usage) return null;
  const count = (key: string) => (typeof usage[key] === "number" ? usage[key] : 0);
  const tokens = count("input_tokens") + count("cache_creation_input_tokens") + count("cache_read_input_tokens");
  // Claude Code's own synthetic entries, such as after an interrupt, carry no usage worth reading.
  return tokens > 0 ? tokens : null;
}
