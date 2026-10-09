import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, VOICE_DOC, type VoiceEndpoint, loadConfig } from "./config";
import type { FrontVoice } from "./front-voice";
import { harnesses } from "./harness";
import type { CliRunner } from "./mcp";
import { MIN_LEVEL, PAUSE_MS, SAMPLE_RATE, level, pcmSamples } from "./app/talk";
import { type Answered, transcribe, wav } from "./voice";
import type { Stopwatch, Timing } from "./voice-timing";
import type { SocketPeer, SocketSession, World } from "./world";

/** How much more audio, in bytes, an interim transcript waits for after the last: a second's. */
const INTERIM_EVERY = SAMPLE_RATE * 2;

/**
 * How long the user is quiet before what they said is transcribed, without
 * waiting for the end: well inside the half-second pause that ends a
 * finished utterance, so it is ready by then. Quiet here is below
 * MIN_LEVEL, stricter than the page's VAD, which hears soft words this
 * misses; those are not in an early transcript, and the final hears them.
 */
const SETTLE_MS = 250;
/** SETTLE_MS of audio, in bytes. */
const SETTLE_BYTES = bytesOf(SETTLE_MS);

/** How many ms `bytes` of audio last. */
function msOf(bytes: number) {
  return (bytes / 2 / SAMPLE_RATE) * 1000;
}

/** How many bytes `ms` of audio is, whole samples. */
function bytesOf(ms: number) {
  return Math.max(0, Math.round((SAMPLE_RATE * ms) / 1000)) * 2;
}

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

/**
 * What `/api/voice` tells the app, each about the utterance it numbered: what
 * was heard so far, and at the end; then, when the Front voice could not
 * answer it and sent it to the Lead as heard, a warning saying why.
 */
export type Transcript = { utterance: number } & (
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "warning"; error: string; help: string[] }
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
  /** Answers each final transcript, or hands it to the Lead. */
  front: FrontVoice;
  /** Holds the Lead's speech back until the returned release (see `speaker`). */
  hold?: () => () => void;
}

/**
 * One page's `/api/voice` socket. Each utterance is `start`, its audio, then
 * `end` (or `cancel`); while it streams, an interim transcript of all the
 * audio so far is sent at most a second of audio apart, one request at a
 * time. Once the user has been quiet for SETTLE_MS after speaking, all the
 * audio so far is transcribed, right after any request out, so that a
 * transcript of everything said is under way before `end`. On `end`
 * the final transcript is the last one asked, when it covers all the speech
 * and was primed as a final is; else all the audio is transcribed then. A
 * final is primed with the vocabulary built when the utterance started; an
 * interim one, not to wait on the Board, with the last vocabulary built. A
 * failed request drops the utterance and says why at once. Each final
 * transcript then goes to the Front voice, one after another in the order
 * they were said. From its start until the Front voice has answered it or
 * handed it off, an utterance holds the Lead's speech back, so the Lead
 * never talks over either.
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
    /** The finals heard so far: each waits on the one before, so the Front voice hears them in the order they were said. */
    let told = Promise.resolve();

    /**
     * Transcribe all of `utterance`'s audio so far, primed with `prompt`, and
     * `quiet` ms of silence after it; the last asked is the final's to take.
     * Sent once the last one asked is answered: requests at once to a
     * service on CPU only slow each other down.
     */
    const hearSoFar = (utterance: Utterance, prompt: Promise<string>, quiet = 0): Heard => {
      const audio = wav(concat([...utterance.audio, new Uint8Array(bytesOf(quiet))]), SAMPLE_RATE);
      const before = utterance.last?.answer.catch(() => {});
      const heard = { upTo: utterance.bytes, prompt, answer: Promise.all([prompt, before]).then(([p]) => transcribe(ctx.world, utterance.endpoint, audio, p)) };
      utterance.last = heard;
      return heard;
    };

    /** What to tell the app of `utterance` now, `answered` as transcribed, if anything. */
    const ask = async (utterance: Utterance, kind: "interim" | "final", answered: Promise<Answered>, timing?: Timing): Promise<Transcript | null> => {
      const answer = await answered;
      // An interim that comes back after the end, or after another utterance began, is dropped.
      if (kind === "interim" && current !== utterance) return null;
      if ("error" in answer) {
        if (current === utterance) current = null;
        utterance.release();
        timing?.dropped();
        return failure(utterance.number, answer.error, answer.help);
      }
      if (kind === "final") timing?.transcribed();
      return { type: kind, utterance: utterance.number, text: answer.returned };
    };

    /** Have the Front voice answer what was heard of `utterance`, or hand it to the Lead; nothing heard ends there. */
    const respond = async (utterance: Utterance, heard: string, timing?: Timing) => {
      if (!heard) return timing?.dropped();
      const handed = await ctx.front.hear(heard, await utterance.prompt, {
        warn: (warning) => send({ type: "warning", utterance: utterance.number, ...warning }),
        handing: (message, cleaned) => {
          timing?.handed(cleaned, message);
          utterance.release();
        },
      });
      if (!handed) timing?.dropped();
    };

    /** The final transcript of `utterance`: the last one asked, when it heard all the speech primed as a final is; else one of all the audio. */
    const heardFinally = async (utterance: Utterance): Promise<Answered> => {
      const { last } = utterance;
      if (last && heardAll(utterance) && await last.prompt === await utterance.prompt) return last.answer;
      return hearSoFar(utterance, utterance.prompt).answer;
    };

    const start = (number: number) => {
      current?.release();
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
      current = { number, endpoint, audio: [], bytes: 0, heardUpTo: 0, asking: false, prompt: build(), spokeUpTo: 0, last: null, release: ctx.hold?.() ?? (() => {}) };
    };

    const hear = (chunk: Uint8Array) => {
      const utterance = current;
      if (!utterance) return;
      utterance.audio.push(chunk);
      utterance.bytes += chunk.byteLength;
      if (level(pcmSamples(chunk.slice().buffer)) > MIN_LEVEL) utterance.spokeUpTo = utterance.bytes;
      // Nothing new said since the last transcription: nothing to ask.
      if (heardAll(utterance)) return;
      const tell = (asked: Promise<Transcript | null>) => asked.then((message) => { if (message) send(message); }).catch(report(utterance));
      const quiet = utterance.bytes - utterance.spokeUpTo;
      // The user has gone quiet: what they said, primed as a final is and heard out to the end of
      // the pause that ends an utterance, as the final would be, so that it can be the final.
      if (utterance.spokeUpTo > 0 && quiet >= SETTLE_BYTES) {
        utterance.heardUpTo = utterance.bytes;
        return void tell(ask(utterance, "interim", hearSoFar(utterance, utterance.prompt, PAUSE_MS - msOf(quiet)).answer));
      }
      // While the user is quiet, an interim would only hold up the one above.
      if (quiet > 0 || utterance.asking || utterance.bytes - utterance.heardUpTo < INTERIM_EVERY) return;
      utterance.asking = true;
      utterance.heardUpTo = utterance.bytes;
      void tell(ask(utterance, "interim", hearSoFar(utterance, Promise.resolve(known.hint)).answer)).finally(() => { utterance.asking = false; });
    };

    const report = (utterance: Utterance) => (e: unknown) => fail(utterance.number, e instanceof Error ? e.message : String(e), "Try again");

    return {
      message(data) {
        if (typeof data !== "string") return hear(data);
        const command = parse(data);
        if (command?.type === "start") return start(command.utterance);
        const utterance = current;
        current = null;
        if (command?.type !== "end") return utterance?.release();
        if (!utterance) return;
        const timing = ctx.timing?.start(utterance.number, new Date(command.spokeAt ?? ctx.world.now().getTime()));
        // Transcribed at once, but told, and heard by the Front voice, after the finals before it.
        const final = ask(utterance, "final", heardFinally(utterance), timing);
        told = told.then(() => final).then(async (message) => {
          if (!message) return;
          send(message);
          if (message.type === "final") await respond(utterance, message.text, timing);
        }).catch((e: unknown) => {
          timing?.dropped();
          report(utterance)(e);
        }).finally(utterance.release);
      },
      close() {
        current?.release();
        current = null;
      },
    };
  };
}

/** An utterance as it streams in. */
interface Utterance {
  /** The number the app gave it, which every answer about it carries. */
  number: number;
  endpoint: VoiceEndpoint;
  audio: Uint8Array[];
  bytes: number;
  /** How many bytes the last interim transcript was of. */
  heardUpTo: number;
  /** Whether an interim request is out, of those sent at most a second of audio apart. */
  asking: boolean;
  /** The vocabulary its final transcript is primed with. */
  prompt: Promise<string>;
  /** How many bytes in what may be its last speech ended (see SETTLE_MS); 0 before any. */
  spokeUpTo: number;
  /** The last transcription asked of it. */
  last: Heard | null;
  /** Lets the Lead speak again, once nothing else holds it back. */
  release(): void;
}

/** Whether the last transcription of `utterance` heard all its speech, and the start of the quiet after it. */
function heardAll(utterance: Utterance) {
  return utterance.spokeUpTo > 0 && (utterance.last?.upTo ?? 0) >= Math.min(utterance.bytes, utterance.spokeUpTo + SETTLE_BYTES);
}

/** A transcription of an utterance's first `upTo` bytes, primed with `prompt`. */
interface Heard {
  upTo: number;
  prompt: Promise<string>;
  answer: Promise<Answered>;
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
