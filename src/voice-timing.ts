import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { type Entry, loadConversation } from "./conversation";
import { nudgesSent } from "./nudge";
import { voiceOn } from "./voice-on";
import type { World } from "./world";

/**
 * The steps of a spoken message, in order: the user stops talking, the page
 * ends the utterance (the end of speech heard), the final transcript comes,
 * the Front voice hands it to the Lead, its entry is written, the Lead is
 * Nudged, the Lead first says something after it, and the page plays the
 * first audio of that.
 */
const VOICE_STEPS = ["spoke", "ended", "transcribed", "handed", "written", "nudged", "said", "played"] as const;
type VoiceStep = (typeof VOICE_STEPS)[number];

/** Where `serve` logs each spoken message's steps, a line each, in the config directory (see docs/voice.md). */
export const TIMING_FILE = "voice-timing.jsonl";

/** How long after the user stops talking a message is logged with what happened, if the Lead has not been heard by then. */
const TIMING_TIMEOUT_MS = 5 * 60_000;

/**
 * One spoken message's line: when each step happened, null for one that did
 * not; how long each took after the last one that did; the whole wait, from
 * the end of speech to the Lead heard; and the step that took longest.
 */
function timingLine(utterance: number, text: string, times: Partial<Record<VoiceStep, Date>>): string {
  const took: Partial<Record<VoiceStep, number | null>> = {};
  let last = times.spoke;
  for (const step of VOICE_STEPS.slice(1)) {
    const at = times[step];
    took[step] = at && last ? at.getTime() - last.getTime() : null;
    if (at) last = at;
  }
  const slowest = VOICE_STEPS.slice(1).reduce<VoiceStep | null>((most, step) => (took[step] ?? -1) > (most ? took[most]! : -1) ? step : most, null);
  const { spoke, played } = times;
  return JSON.stringify({
    utterance,
    text,
    ...Object.fromEntries(VOICE_STEPS.map((step) => [step, times[step]?.toISOString() ?? null])),
    took,
    total: spoke && played ? played.getTime() - spoke.getTime() : null,
    slowest,
  });
}

/** One spoken message being timed, as `/api/voice` tells of its transcript. */
export interface Timing {
  /** The final transcript came. */
  transcribed(): void;
  /** The Front voice hands it to the Lead (`cleaned` false when sent as heard) as `text`, heard as `raw`. */
  handed(cleaned: boolean, said: { text: string; raw: string }): void;
  /** It ends here: it failed, nothing was heard, or the Front voice answered it itself. */
  dropped(): void;
}

/** A message being timed: its steps so far, and the ids of its entry and of the Lead's first after it. */
interface Timed {
  utterance: number;
  text: string;
  raw: string | null;
  times: Partial<Record<VoiceStep, Date>>;
  entry?: number;
  said?: number;
}

/**
 * Times each spoken message through `serve` and logs it, a line each, to
 * TIMING_FILE. `/api/voice` starts it and tells of the transcript; the
 * conversation, of its entry and the Lead's first entry after it; the
 * Nudges sent, of the Nudge; and the page, of the first audio it played. A
 * message is logged once played, once the Lead speaks with Voice off, or
 * after TIMING_TIMEOUT_MS with what happened by then.
 */
export function stopwatch({ world, configDir }: { world: World; configDir: string }) {
  let timed: Timed[] = [];
  /** The last entry looked at; the ones after it are new. */
  let seen = lastId(configDir);

  /** Log `message`, once: a message already logged (it expired, say) is not logged again. */
  const log = (message: Timed) => {
    if (!timed.includes(message)) return;
    timed = timed.filter((t) => t !== message);
    const { times } = message;
    const written = times.written;
    const nudged = written && nudgesSent(configDir).find((at) => at >= written);
    if (nudged && (!times.said || nudged <= times.said)) times.nudged = nudged;
    appendFileSync(join(configDir, TIMING_FILE), `${timingLine(message.utterance, message.text, times)}\n`);
  };

  return {
    /** A spoken message ends now, the user having stopped talking at `spoke`. */
    start(utterance: number, spoke: Date): Timing {
      const message: Timed = { utterance, text: "", raw: null, times: { spoke, ended: world.now() } };
      timed.push(message);
      return {
        transcribed: () => { message.times.transcribed = world.now(); },
        handed: (cleaned, { text, raw }) => {
          if (cleaned) message.times.handed = world.now();
          if (!text) return log(message);
          message.text = text;
          message.raw = raw;
        },
        dropped: () => log(message),
      };
    },
    /** The conversation changed: a spoken message's entry, or the Lead's first entry after one. */
    changed() {
      const fresh = loadConversation(configDir).filter((e) => e.id > seen);
      if (fresh.length) seen = fresh.at(-1)!.id;
      for (const entry of fresh) {
        if (entry.type === "user" || entry.type === "answer") {
          const message = timed.find((t) => t.entry === undefined && t.raw !== null && t.raw === entry.raw);
          if (message) {
            message.entry = entry.id;
            message.times.written = new Date(entry.at);
          }
        }
        if (entry.type === "lead" || entry.type === "ask") said(entry);
      }
      this.expire();
    },
    /** A page began playing the Lead's entry `entry` at `at`. */
    played(entry: number, at: Date) {
      for (const message of timed.filter((t) => t.said === entry)) {
        message.times.played = at;
        log(message);
      }
    },
    /** Log the messages the Lead has not been heard on in TIMING_TIMEOUT_MS. */
    expire() {
      const now = world.now().getTime();
      for (const message of timed.filter((t) => now - t.times.spoke!.getTime() >= TIMING_TIMEOUT_MS)) log(message);
    },
  };

  /** The Lead's entry after each message written before it: with Voice off, nothing will be played. */
  function said(entry: Entry) {
    const quiet = !voiceOn(configDir);
    for (const message of timed.filter((t) => t.entry !== undefined && t.entry < entry.id && t.said === undefined)) {
      message.said = entry.id;
      message.times.said = new Date(entry.at);
      if (quiet) log(message);
    }
  }
}

/** The stopwatch `serve` times spoken messages with. */
export type Stopwatch = ReturnType<typeof stopwatch>;

function lastId(configDir: string) {
  try {
    return loadConversation(configDir).at(-1)?.id ?? 0;
  } catch {
    return 0;
  }
}
