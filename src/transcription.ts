import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, VOICE_DOC, type VoiceEndpoint, loadConfig } from "./config";
import { harnesses } from "./harness";
import type { CliRunner } from "./mcp";
import { transcribe, wav } from "./voice";
import type { SocketPeer, SocketSession, World } from "./world";

/** The audio the app streams: 16-bit little-endian mono PCM at this rate. */
export const SAMPLE_RATE = 16_000;

/** How much more audio, in bytes, an interim transcript waits for after the last: a second's. */
const INTERIM_EVERY = SAMPLE_RATE * 2;

/** What the app sends on `/api/voice`, besides the audio itself as binary messages. */
type Heard = { type: "start" } | { type: "end" } | { type: "cancel" };

/** What `/api/voice` sends the app. */
export type Transcript =
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; error: string; help: string[] };

/** Typing is the way round any voice failure, so every warning says so. */
const TYPING = "typing still works";

interface TranscriptionContext {
  world: World;
  configDir: string;
  runCli: CliRunner;
}

/**
 * One page's `/api/voice` socket. Each utterance is `start`, its audio, then
 * `end` (or `cancel`); while it streams, an interim transcript of all the
 * audio so far is sent at most a second of audio apart, one request at a
 * time, and on `end` the final one. The final one is primed with the
 * vocabulary built when the utterance started; an interim one, not to wait
 * on the Board, with the last vocabulary built.
 */
export function transcriptionSession(ctx: TranscriptionContext) {
  /** The last vocabulary built, for any page. */
  let known = "";
  const build = () => {
    // Without a vocabulary the service still transcribes, only unprimed.
    const hint = vocabularyHint(ctx).catch(() => "");
    void hint.then((h) => { known = h; });
    return hint;
  };
  return (peer: SocketPeer): SocketSession => {
    const send = (message: Transcript) => peer.send(JSON.stringify(message));
    /** The utterance streaming now, if any; a newer one makes an older one's answers stale. */
    let current: Utterance | null = null;
    const fail = (error: string, help: string) => send({ type: "error", error, help: [`${help}; ${TYPING}`] });

    const ask = async (utterance: Utterance, kind: "interim" | "final") => {
      const prompt = kind === "final" ? await utterance.prompt : known;
      const answer = await transcribe(ctx.world, utterance.endpoint, wav(concat(utterance.audio), SAMPLE_RATE), prompt);
      // An interim that comes back after the end, or after another utterance began, is dropped.
      if (kind === "interim" && current !== utterance) return;
      if ("error" in answer) {
        // A failed interim stays quiet: the final says what went wrong.
        if (kind === "final") fail(answer.error, answer.help);
        return;
      }
      send({ type: kind, text: answer.returned });
    };

    const start = () => {
      let endpoint;
      try {
        endpoint = loadConfig(ctx.configDir).voice?.transcribe;
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        return fail(e.message, "Fix config.json");
      }
      if (!endpoint) return fail("no transcription service is configured", `Add voice.transcribe to config.json (see ${VOICE_DOC})`);
      current = { endpoint, audio: [], bytes: 0, heardUpTo: 0, asking: false, prompt: build() };
    };

    const hear = (chunk: Uint8Array) => {
      const utterance = current;
      if (!utterance) return;
      utterance.audio.push(chunk);
      utterance.bytes += chunk.byteLength;
      if (utterance.asking || utterance.bytes - utterance.heardUpTo < INTERIM_EVERY) return;
      utterance.asking = true;
      utterance.heardUpTo = utterance.bytes;
      void ask(utterance, "interim").catch(report).finally(() => { utterance.asking = false; });
    };

    const report = (e: unknown) => fail(e instanceof Error ? e.message : String(e), "Try again");

    return {
      message(data) {
        if (typeof data !== "string") return hear(data);
        const heard = parse(data);
        if (heard?.type === "start") return start();
        const utterance = current;
        current = null;
        if (heard?.type === "end" && utterance) void ask(utterance, "final").catch(report);
      },
      close() {
        current = null;
      },
    };
  };
}

/** An utterance as it streams in. */
interface Utterance {
  endpoint: VoiceEndpoint;
  audio: Uint8Array[];
  bytes: number;
  /** How many bytes the last interim transcript was of. */
  heardUpTo: number;
  /** Whether an interim request is out. */
  asking: boolean;
  prompt: Promise<string>;
}

function parse(data: string): Heard | null {
  try {
    const message = JSON.parse(data);
    return ["start", "end", "cancel"].includes(message?.type) ? message : null;
  } catch {
    return null;
  }
}

function concat(chunks: Uint8Array[]) {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

/**
 * The words the transcription service is told to expect, built fresh: the
 * terms of each Repo's glossary, the Harness names, the Repos, and each issue
 * and Spec on the Board by its identifier and title. Whisper reads only the
 * end of a long prompt, so the Board, the likeliest to be said, comes last.
 */
async function vocabularyHint(ctx: TranscriptionContext): Promise<string> {
  let config;
  try {
    config = loadConfig(ctx.configDir);
  } catch {
    return "";
  }
  const terms = unique(config.repos.flatMap((repo) => glossaryTerms(repo.path)));
  const names = unique([...harnesses(ctx.configDir).map((h) => h.name), ...config.repos.map((r) => r.slug)]);
  const issues = await boardIssues(ctx.runCli);
  return [
    terms.length ? `Glossary: ${terms.join(", ")}.` : "",
    names.length ? `Names: ${names.join(", ")}.` : "",
    issues.length ? `Issues: ${issues.map(({ issue, title }) => `${issue} ${title}`).join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

/** The terms a Repo's `GLOSSARY.md` defines, each a `**Term**:` line; none without the file. */
export function glossaryTerms(repoPath: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(repoPath, "GLOSSARY.md"), "utf8");
  } catch {
    return [];
  }
  return [...text.matchAll(/^\*\*(.+?)\*\*:/gm)].map((m) => m[1]!.trim());
}

/** Every issue and Spec the Board shows, by its identifier, with its title; none when the Board fails. */
async function boardIssues(runCli: CliRunner): Promise<{ issue: string; title: string }[]> {
  let board: Record<string, unknown>;
  try {
    board = JSON.parse((await runCli(["board", "--json"])).stdout);
  } catch {
    return [];
  }
  const rows = (key: string, id: string) =>
    (Array.isArray(board[key]) ? board[key] as Record<string, unknown>[] : []).flatMap((row) =>
      typeof row[id] === "string" && typeof row.title === "string" ? [{ issue: row[id] as string, title: row.title as string }] : []);
  const all = [...rows("issues", "issue"), ...rows("stackable", "issue"), ...rows("prOpen", "issue"), ...rows("dispatches", "issue"), ...rows("specs", "spec")];
  const seen = new Set<string>();
  return all.filter(({ issue }) => !seen.has(issue) && seen.add(issue));
}

function unique(values: string[]) {
  return [...new Set(values)];
}
