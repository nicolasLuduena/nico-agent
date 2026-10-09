import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authored, isCorrection, loadConversation } from "./conversation";
import { ConfigError, VOICE_DOC, type VoiceEndpoint, loadConfig } from "./config";
import { harnesses } from "./harness";
import type { CliRunner } from "./mcp";
import { SAMPLE_RATE } from "./app/talk";
import { choose, scribe, transcribe, wav } from "./voice";
import type { Stopwatch, Timing } from "./voice-timing";
import type { SocketPeer, SocketSession, World } from "./world";

/** How much more audio, in bytes, an interim transcript waits for after the last: a second's. */
const INTERIM_EVERY = SAMPLE_RATE * 2;

/**
 * What the app tells `/api/voice`, besides the audio itself as binary
 * messages: an utterance starts, under the number the app gave it; it ends,
 * to be transcribed, the user having stopped talking at `spokeAt` (epoch
 * ms); or it is dropped. `hush` stops the Lead's speech (see `speaker`),
 * whatever the utterance does; `played` says the page began playing the
 * Lead's entry `entry` at `at` (epoch ms), for the timing log.
 */
export type VoiceCommand =
  | { type: "start"; utterance: number }
  | { type: "end"; spokeAt?: number }
  | { type: "cancel" }
  | { type: "hush" }
  | { type: "played"; entry: number; at: number };

/** How many of the conversation's last entries the Scribe reads, for context. */
const RECENT = 4;

/**
 * What `/api/voice` tells the app, each about the utterance it numbered. A
 * final transcript is the Scribe's text, with `raw` what was heard; when the
 * Scribe could not clean it, `text` is the raw and `warning` says why. Said
 * right after the Lead's question, it `answers` that question, and its text
 * is the choice it picks, if one.
 */
export type Transcript = { utterance: number } & (
  | { type: "interim"; text: string }
  | { type: "final"; text: string; raw: string; answers?: number; warning?: { error: string; help: string[] } }
  | { type: "error"; error: string; help: string[] }
);

/** Typing is the way round any voice failure, so every warning says so. */
const TYPING = "typing still works";

interface TranscriptionContext {
  world: World;
  configDir: string;
  runCli: CliRunner;
  /** Times each final transcript's steps, for the timing log. */
  timing?: Stopwatch;
}

/**
 * One page's `/api/voice` socket. Each utterance is `start`, its audio, then
 * `end` (or `cancel`); while it streams, an interim transcript of all the
 * audio so far is sent at most a second of audio apart, one request at a
 * time, and on `end` the final one. The final one is primed with the
 * vocabulary built when the utterance started; an interim one, not to wait
 * on the Board, with the last vocabulary built. A failed request drops the
 * utterance and says why at once.
 */
export function transcriptionSession(ctx: TranscriptionContext) {
  /** The last vocabulary built, for any page, and which build it came from, so an older one never replaces it. */
  let known = { hint: "", build: 0 };
  let builds = 0;
  const build = () => {
    const number = ++builds;
    // Without a vocabulary the service still transcribes, only unprimed.
    const hint = vocabularyHint(ctx).catch(() => "");
    void hint.then((h) => { if (number > known.build) known = { hint: h, build: number }; });
    return hint;
  };
  return (peer: SocketPeer): SocketSession => {
    const send = (message: Transcript) => peer.send(JSON.stringify(message));
    /** The utterance streaming now, if any; a newer one makes an older one's interims stale. */
    let current: Utterance | null = null;
    const failure = (utterance: number, error: string, help: string): Transcript => ({ type: "error", utterance, error, help: [`${help}; ${TYPING}`] });
    const fail = (utterance: number, error: string, help: string) => send(failure(utterance, error, help));
    /** The finals told so far: each waits on the one before, so the app posts them in the order they were said. */
    let told = Promise.resolve();

    /** What to tell the app of `utterance` now, if anything. */
    const ask = async (utterance: Utterance, kind: "interim" | "final", timing?: Timing): Promise<Transcript | null> => {
      const prompt = kind === "final" ? await utterance.prompt : known.hint;
      const answer = await transcribe(ctx.world, utterance.endpoint, wav(concat(utterance.audio), SAMPLE_RATE), prompt);
      // An interim that comes back after the end, or after another utterance began, is dropped.
      if (kind === "interim" && current !== utterance) return null;
      if ("error" in answer) {
        if (current === utterance) current = null;
        timing?.dropped();
        return failure(utterance.number, answer.error, answer.help);
      }
      if (kind === "interim") return { type: kind, utterance: utterance.number, text: answer.returned };
      timing?.transcribed();
      const cleaned = await clean(ctx, utterance, answer.returned, prompt);
      const said = await answering(ctx, utterance, cleaned);
      timing?.scribed(!("warning" in cleaned) && Boolean(cleaned.raw), said);
      return { type: kind, utterance: utterance.number, ...said };
    };

    const start = (number: number) => {
      current = null;
      let voice;
      try {
        voice = loadConfig(ctx.configDir).voice;
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        return fail(number, e.message, "Fix config.json");
      }
      const endpoint = voice?.transcribe;
      if (!endpoint) return fail(number, "no transcription service is configured", `Add voice.transcribe to config.json (see ${VOICE_DOC})`);
      current = { number, endpoint, scribe: voice?.scribe, audio: [], bytes: 0, heardUpTo: 0, asking: false, prompt: build() };
    };

    const hear = (chunk: Uint8Array) => {
      const utterance = current;
      if (!utterance) return;
      utterance.audio.push(chunk);
      utterance.bytes += chunk.byteLength;
      if (utterance.asking || utterance.bytes - utterance.heardUpTo < INTERIM_EVERY) return;
      utterance.asking = true;
      utterance.heardUpTo = utterance.bytes;
      void ask(utterance, "interim").then((message) => { if (message) send(message); }).catch(report(utterance)).finally(() => { utterance.asking = false; });
    };

    const report = (utterance: Utterance) => (e: unknown) => fail(utterance.number, e instanceof Error ? e.message : String(e), "Try again");

    return {
      message(data) {
        if (typeof data !== "string") return hear(data);
        const command = parse(data);
        if (command?.type === "start") return start(command.utterance);
        const utterance = current;
        current = null;
        if (command?.type !== "end" || !utterance) return;
        const timing = ctx.timing?.start(utterance.number, new Date(command.spokeAt ?? ctx.world.now().getTime()));
        // Transcribed and cleaned at once, but told after the finals before it.
        const final = ask(utterance, "final", timing);
        told = told.then(() => final).then((message) => { if (message) send(message); }).catch((e: unknown) => {
          timing?.dropped();
          report(utterance)(e);
        });
      },
      close() {
        current = null;
      },
    };
  };
}

/**
 * What the user said, `raw` as heard, cleaned by the Scribe with the
 * vocabulary and the conversation's last entries.
 */
async function clean(ctx: TranscriptionContext, utterance: Utterance, raw: string, vocabulary: string) {
  if (!raw) return { text: raw, raw };
  const asHeard = (error: string, help: string) => ({ text: raw, raw, warning: { error, help: [`Sent as heard. ${help}`] } });
  if (!utterance.scribe) return asHeard("no Scribe is configured", `Add voice.scribe to config.json (see ${VOICE_DOC})`);
  const recent = loadConversation(ctx.configDir).slice(-RECENT).map(authored)
    .flatMap((e) => (e.text ? [`${e.who === "user" ? "User" : "Lead"}: ${e.text}`] : []));
  const answer = await scribe(ctx.world, utterance.scribe, raw, { vocabulary, recent });
  if ("error" in answer) return asHeard(answer.error, answer.help);
  // A small model may answer the message rather than clean it; a cleanup is never much longer than what was said.
  if (words(answer.returned) > words(raw) * 1.5 + 4) return asHeard("the Scribe answered far more than was said", "Check voice.scribe.model, or try a larger one");
  return { text: answer.returned, raw };
}

/**
 * `said` as the answer to the Lead's question when that question is the
 * conversation's last entry: what is said right after it answers it, unless
 * it is a Correction of the user's last message. A question with choices
 * takes the one the Scribe finds `said` picks; else what was said, as cleaned.
 */
async function answering(ctx: TranscriptionContext, utterance: Utterance, said: Cleaned): Promise<Cleaned & { answers?: number }> {
  const question = loadConversation(ctx.configDir).at(-1);
  if (!said.text || question?.type !== "ask" || isCorrection(said)) return said;
  const choices = question.choices ?? [];
  const picked = choices.length && utterance.scribe ? await choose(ctx.world, utterance.scribe, { text: question.text, choices }, said.text) : null;
  return { ...said, ...(picked !== null && { text: choices[picked]! }), answers: question.id };
}

/** What was said as it is sent: the Scribe's text, else the raw with why. */
type Cleaned = Awaited<ReturnType<typeof clean>>;

/** How many words `text` has. */
function words(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** An utterance as it streams in. */
interface Utterance {
  /** The number the app gave it, which every answer about it carries. */
  number: number;
  endpoint: VoiceEndpoint;
  /** The Scribe that cleans its final transcript, if one is configured. */
  scribe: VoiceEndpoint | undefined;
  audio: Uint8Array[];
  bytes: number;
  /** How many bytes the last interim transcript was of. */
  heardUpTo: number;
  /** Whether an interim request is out. */
  asking: boolean;
  prompt: Promise<string>;
}

function parse(data: string): VoiceCommand | null {
  try {
    const command = JSON.parse(data);
    if (command?.type === "start") return typeof command.utterance === "number" ? command : null;
    if (command?.type === "end") return typeof command.spokeAt === "number" ? command : { type: "end" };
    return command?.type === "cancel" ? command : null;
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
