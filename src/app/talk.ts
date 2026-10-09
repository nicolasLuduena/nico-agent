/** The rate `/api/voice` takes audio at, as 16-bit mono PCM. */
export const SAMPLE_RATE = 16_000;

/** A press shorter than this is a tap, which listens hands-free; a longer one is push-to-talk. */
export const TAP_MS = 300;

/**
 * The talk button: idle; held, recording until released; hands-free,
 * recording until a pause or a tap; or waiting for the final transcript.
 */
export type Talk = { mode: "idle" } | { mode: "holding"; since: number } | { mode: "hands-free" } | { mode: "transcribing" };

export type TalkEvent =
  | { type: "press"; at: number }
  | { type: "release"; at: number }
  /** Hands-free listening heard speech, then a pause. */
  | { type: "pause" }
  /** Hands-free listening heard nothing for a while. */
  | { type: "nothing" }
  /** The utterance reached the longest one sent. */
  | { type: "limit" }
  /** The final transcript came. */
  | { type: "final" }
  /** No microphone, the socket gone, or the service down. */
  | { type: "failed" };

/** What to tell `/api/voice`: an utterance starts, ends (transcribe it), or is dropped. */
export type TalkSend = "start" | "end" | "cancel";

/** The talk button after `event`, and what to tell `/api/voice`, if anything. */
export function talk(state: Talk, event: TalkEvent): { state: Talk; send?: TalkSend } {
  const recording = state.mode === "holding" || state.mode === "hands-free";
  switch (event.type) {
    case "press":
      // A tap while hands-free sends what it heard; its release does nothing.
      if (state.mode === "hands-free") return { state: { mode: "transcribing" }, send: "end" };
      if (state.mode === "holding") return { state };
      // While the last utterance is transcribed, the next one may start.
      return { state: { mode: "holding", since: event.at }, send: "start" };
    case "release":
      if (state.mode !== "holding") return { state };
      if (event.at - state.since < TAP_MS) return { state: { mode: "hands-free" } };
      return { state: { mode: "transcribing" }, send: "end" };
    case "pause":
      // The user holding the button is still talking.
      return state.mode === "hands-free" ? { state: { mode: "transcribing" }, send: "end" } : { state };
    case "nothing":
      return state.mode === "hands-free" ? { state: { mode: "idle" }, send: "cancel" } : { state };
    case "limit":
      return recording ? { state: { mode: "transcribing" }, send: "end" } : { state };
    case "final":
      return state.mode === "transcribing" ? { state: { mode: "idle" } } : { state };
    case "failed":
      return recording ? { state: { mode: "idle" }, send: "cancel" } : { state: { mode: "idle" } };
  }
}

/** Below this level nothing counts as speech, however quiet the room. */
const MIN_LEVEL = 0.015;
/** Speech is this many times louder than the room's floor. */
const OVER_FLOOR = 3;
/** Less speech than this is a click or a knock, not words. */
const MIN_SPEECH_MS = 200;
/** This much quiet after speech ends the utterance. */
const PAUSE_MS = 800;
/** With no speech for this long, hands-free listening gives up. */
const NOTHING_MS = 6000;
/** The longest utterance sent. */
export const LIMIT_MS = 60_000;
/** How fast the floor rises to a steadily louder room. */
const FLOOR_RISE_MS = 2000;

/** What hands-free listening has heard so far: the room's floor, and how much speech and quiet. */
export interface Listening {
  floor: number;
  speech: number;
  quiet: number;
  elapsed: number;
}

export const LISTENING: Listening = { floor: MIN_LEVEL, speech: 0, quiet: 0, elapsed: 0 };

/**
 * Listening after `ms` more of audio at `level` (see `level`): speech is
 * what stands out from the room's floor, which drops at once to a quieter
 * room and rises slowly to a louder one, never while speech goes on. It ends
 * on a pause after enough speech, on nothing heard for a while, or at the limit.
 */
export function listen(state: Listening, level: number, ms: number): { state: Listening; speaking: boolean; ended?: "pause" | "nothing" | "limit" } {
  const speaking = level > Math.max(MIN_LEVEL, state.floor * OVER_FLOOR);
  const floor = level < state.floor ? level : speaking ? state.floor : state.floor + (level - state.floor) * (1 - Math.exp(-ms / FLOOR_RISE_MS));
  const next = {
    floor,
    speech: state.speech + (speaking ? ms : 0),
    quiet: speaking ? 0 : state.quiet + ms,
    elapsed: state.elapsed + ms,
  };
  const heard = next.speech >= MIN_SPEECH_MS;
  const ended = next.elapsed >= LIMIT_MS ? "limit" : heard && next.quiet >= PAUSE_MS ? "pause" : !heard && next.elapsed >= NOTHING_MS ? "nothing" : undefined;
  return { state: next, speaking, ...(ended && { ended }) };
}

/** The loudness of a batch of samples, as their root mean square. */
export function level(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/**
 * Turns the microphone's batches of samples at `rate` into 16-bit PCM at
 * SAMPLE_RATE, each output sample the mean of the input ones it covers.
 * What a batch leaves over starts the next, so batches join without a seam.
 */
export function resampler(rate: number): (samples: Float32Array) => Int16Array {
  const step = rate / SAMPLE_RATE;
  let carry = new Float32Array(0);
  // Where the next output sample starts, in `carry`'s indices.
  let at = 0;
  return (input) => {
    const samples = new Float32Array(carry.length + input.length);
    samples.set(carry);
    samples.set(input, carry.length);
    const out: number[] = [];
    for (; Math.floor(at + step) <= samples.length; at += step) {
      const from = Math.floor(at);
      const to = Math.max(Math.floor(at + step), from + 1);
      let sum = 0;
      for (let i = from; i < to; i++) sum += samples[i]!;
      const s = Math.min(1, Math.max(-1, sum / (to - from)));
      out.push(Math.round(s < 0 ? s * 32768 : s * 32767));
    }
    const used = Math.floor(at);
    carry = samples.slice(used);
    at -= used;
    return Int16Array.from(out);
  };
}
