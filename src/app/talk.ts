/** The rate `/api/voice` takes audio at, as 16-bit mono PCM. */
export const SAMPLE_RATE = 16_000;

/** A press shorter than this is a tap, which listens hands-free; a longer one is push-to-talk. */
export const TAP_MS = 300;

/**
 * The talk button: idle; held, recording until released; hands-free,
 * recording until a pause or a tap; waiting for the final transcript; or
 * watching the microphone for the user to talk, over the Lead or not.
 * `session` is a hands-free session: after each utterance it keeps
 * watching, through the Lead's reply, for the next, until the user ends it.
 */
export type Talk =
  | { mode: "idle" }
  | { mode: "holding"; since: number }
  | { mode: "hands-free"; session?: boolean }
  | { mode: "transcribing"; session?: boolean }
  | { mode: "watching"; session?: boolean };

/** What happens to the talk button: the user presses or releases it, listening ends, or the transcript comes. */
export type TalkEvent =
  | { type: "press"; at: number }
  | { type: "release"; at: number }
  /** `nico-agent voice talk`, the key anywhere: a tap, from wherever the user is. */
  | { type: "key" }
  /** Hands-free listening heard speech, then a pause. */
  | { type: "pause" }
  /** Hands-free listening heard nothing for a while. */
  | { type: "nothing" }
  /** The utterance reached the longest one sent. */
  | { type: "limit" }
  /** The final transcript came. */
  | { type: "final" }
  /** No microphone, the socket gone, or the service down. */
  | { type: "failed" }
  /** The Lead began speaking. */
  | { type: "lead-speaks" }
  /** The Lead finished speaking, or was hushed. */
  | { type: "lead-done" }
  /** The user began talking while the microphone watched (see `bargesIn`). */
  | { type: "barge" };

/** What to tell `/api/voice` (see VoiceCommand): an utterance starts, ends (transcribe it), or is dropped. */
export type TalkSend = "start" | "end" | "cancel";

/** The talk button after `event`, and what to tell `/api/voice`, if anything. */
export function talk(state: Talk, event: TalkEvent): { state: Talk; send?: TalkSend } {
  const recording = state.mode === "holding" || state.mode === "hands-free";
  const session = inSession(state);
  switch (event.type) {
    case "press":
      // A tap while hands-free sends what it heard; its release does nothing.
      if (state.mode === "hands-free") return { state: { mode: "transcribing", session }, send: "end" };
      if (state.mode === "holding") return { state };
      // A tap in a session while nobody talks ends it; the last transcript still comes.
      if (session) return { state: state.mode === "transcribing" ? { mode: "transcribing" } : { mode: "idle" } };
      // While the last utterance is transcribed, or the Lead speaks, the next one may start.
      return { state: { mode: "holding", since: event.at }, send: "start" };
    case "release":
      if (state.mode !== "holding") return { state };
      if (event.at - state.since < TAP_MS) return { state: { mode: "hands-free", session: true } };
      return { state: { mode: "transcribing" }, send: "end" };
    case "key":
      if (state.mode === "holding") return { state: { mode: "transcribing" }, send: "end" };
      // As a press: hands-free it sends, and in a session while nobody talks it ends it; neither reads `at`.
      if (recording || session) return talk(state, { type: "press", at: 0 });
      return { state: { mode: "hands-free", session: true }, send: "start" };
    case "pause":
      // The user holding the button is still talking.
      return state.mode === "hands-free" ? { state: { mode: "transcribing", session }, send: "end" } : { state };
    case "nothing":
      if (state.mode !== "hands-free") return { state };
      return { state: session ? { mode: "watching", session } : { mode: "idle" }, send: "cancel" };
    case "limit":
      return recording ? { state: { mode: "transcribing", session }, send: "end" } : { state };
    case "final":
      if (state.mode !== "transcribing") return { state };
      return { state: session ? { mode: "watching", session } : { mode: "idle" } };
    case "failed":
      return recording ? { state: { mode: "idle" }, send: "cancel" } : { state: { mode: "idle" } };
    // The user talking or waiting on a transcript keeps the microphone to themselves.
    case "lead-speaks":
      return state.mode === "idle" ? { state: { mode: "watching" } } : { state };
    case "lead-done":
      return state.mode === "watching" && !session ? { state: { mode: "idle" } } : { state };
    case "barge":
      return watches(state) ? { state: { mode: "hands-free", session }, send: "start" } : { state };
  }
}

/** Whether the microphone watches for the user to talk, rather than sending what it hears: while the Lead speaks, and all through a session. */
export function watches(state: Talk): state is Extract<Talk, { mode: "watching" | "transcribing" }> {
  return state.mode === "watching" || (state.mode === "transcribing" && state.session === true);
}

/** Whether the talk button is in a hands-free session. */
export function inSession(state: Talk): boolean {
  return "session" in state && state.session === true;
}

/** Whether a tap ends the session: in one, while nobody talks. */
export function ends(state: Talk): boolean {
  return watches(state) && inSession(state);
}

/** What the conversation by voice is doing, as the panel shows it; null outside one. */
export type Indicator = "listening" | "thinking" | "speaking";

/**
 * The indicator for the talk button in `state`, with the Lead `speaking`
 * aloud or `working` (its Agent state): the user heard first, then the
 * Lead's voice, then what keeps the user waiting; a session waiting on
 * nothing is listening for the user.
 */
export function indicator(state: Talk, { speaking, working }: { speaking: boolean; working: boolean }): Indicator | null {
  if (state.mode === "holding" || state.mode === "hands-free") return "listening";
  if (speaking) return "speaking";
  if (state.mode === "transcribing") return "thinking";
  if (state.mode === "watching" && state.session) return working ? "thinking" : "listening";
  return null;
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

/** What hands-free listening has heard so far: the room's floor, how much speech and quiet, and how long the speech going on now has lasted. */
export interface Listening {
  floor: number;
  speech: number;
  quiet: number;
  voiced: number;
  elapsed: number;
}

/** Listening before any audio: the floor at the least level that could be speech. */
export const LISTENING: Listening = { floor: MIN_LEVEL, speech: 0, quiet: 0, voiced: 0, elapsed: 0 };

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
    voiced: speaking ? state.voiced + ms : 0,
    elapsed: state.elapsed + ms,
  };
  const heard = next.speech >= MIN_SPEECH_MS;
  const ended = next.elapsed >= LIMIT_MS ? "limit" : heard && next.quiet >= PAUSE_MS ? "pause" : !heard && next.elapsed >= NOTHING_MS ? "nothing" : undefined;
  return { state: next, speaking, ...(ended && { ended }) };
}

/**
 * Whether the user has begun talking over the Lead: unbroken voice for as
 * long as an utterance needs to count, a fraction of a word. Unbroken, so
 * the Lead's own voice leaking past echo cancellation in blips never adds up.
 */
export function bargesIn(state: Listening): boolean {
  return state.voiced >= MIN_SPEECH_MS;
}

/** 16-bit little-endian PCM, as `/api/voice` streams the Lead's speech, as samples from -1 to 1. */
export function pcmSamples(pcm: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(pcm);
  return Float32Array.from({ length: Math.floor(pcm.byteLength / 2) }, (_, i) => view.getInt16(i * 2, true) / 32768);
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
