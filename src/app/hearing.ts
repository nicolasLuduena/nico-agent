import { type Ending, type Listening, LISTENING, SAMPLE_RATE, listen } from "./talk";

/** How much of an utterance Smart Turn hears: its last 8 seconds. */
const TURN_SAMPLES = 8 * SAMPLE_RATE;
/** Whisper's window and hop, in samples at 16kHz: 25ms windows every 10ms. */
const WINDOW = 400;
const HOP = 160;
const FREQUENCIES = WINDOW / 2 + 1;
/** Whisper's mel bands, and the frames of 8 seconds of audio. */
export const MEL_BINS = 80;
export const MEL_FRAMES = TURN_SAMPLES / HOP;

/** Hertz on the Slaney mel scale: linear below 1kHz, logarithmic above. */
function mel(hz: number) {
  return hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) * (27 / Math.log(6.4));
}

function hertz(m: number) {
  return m < 15 ? (200 * m) / 3 : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27));
}

/** Whisper's 80 triangular mel filters over 0 to 8kHz, Slaney-normalized: each one's weights over the frequencies from `from`. */
const MEL_FILTERS = (() => {
  const top = mel(SAMPLE_RATE / 2);
  const edges = Array.from({ length: MEL_BINS + 2 }, (_, i) => hertz((top * i) / (MEL_BINS + 1)));
  return Array.from({ length: MEL_BINS }, (_, b) => {
    const [low, center, high] = [edges[b]!, edges[b + 1]!, edges[b + 2]!];
    const weights = Array.from({ length: FREQUENCIES }, (_, k) => {
      const hz = (k * SAMPLE_RATE) / 2 / (FREQUENCIES - 1);
      return Math.max(0, Math.min((hz - low) / (center - low), (high - hz) / (high - center))) * (2 / (high - low));
    });
    const from = weights.findIndex((w) => w > 0);
    const to = weights.findLastIndex((w) => w > 0) + 1;
    return { from, weights: Float64Array.from(weights.slice(from, to)) };
  });
})();

/** For each frequency of the DFT, its cosines and sines over a window, a periodic Hann window folded in. */
const [COS, SIN] = [Math.cos, Math.sin].map((wave) => {
  const table = new Float64Array(FREQUENCIES * WINDOW);
  for (let k = 0; k < FREQUENCIES; k++) {
    for (let n = 0; n < WINDOW; n++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / WINDOW);
      table[k * WINDOW + n] = hann * wave((2 * Math.PI * ((k * n) % WINDOW)) / WINDOW);
    }
  }
  return table;
}) as [Float64Array, Float64Array];

/** The log-mel features of one window of `samples` from `at`, into `into`. */
function logMel(samples: Float64Array, at: number, into: Float64Array) {
  const spectrum = new Float64Array(FREQUENCIES);
  for (let k = 0; k < FREQUENCIES; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0, i = k * WINDOW; n < WINDOW; n++, i++) {
      re += samples[at + n]! * COS[i]!;
      im += samples[at + n]! * SIN[i]!;
    }
    spectrum[k] = re * re + im * im;
  }
  MEL_FILTERS.forEach(({ from, weights }, b) => {
    let sum = 0;
    for (let k = 0; k < weights.length; k++) sum += weights[k]! * spectrum[from + k]!;
    into[b] = Math.log10(Math.max(1e-10, sum));
  });
}

/**
 * What Smart Turn hears of an utterance (16kHz samples from -1 to 1): its
 * last 8 seconds, padded with silence at the start when shorter, normalized
 * to zero mean and unit variance, as Whisper's log-mel features, MEL_BINS
 * rows of MEL_FRAMES. The same as Smart Turn's own inference code makes
 * with `transformers`' WhisperFeatureExtractor.
 */
export function turnFeatures(utterance: Float32Array): Float32Array {
  const audio = new Float64Array(TURN_SAMPLES);
  const kept = utterance.subarray(Math.max(0, utterance.length - TURN_SAMPLES));
  const silence = TURN_SAMPLES - kept.length;
  audio.set(kept, silence);
  let mean = 0;
  for (const s of audio) mean += s;
  mean /= TURN_SAMPLES;
  let variance = 0;
  for (const s of audio) variance += (s - mean) ** 2;
  const scale = 1 / Math.sqrt(variance / TURN_SAMPLES + 1e-7);
  // Centered windows: half a window reflected at each end.
  const half = WINDOW / 2;
  const padded = new Float64Array(TURN_SAMPLES + WINDOW);
  for (let i = 0; i < padded.length; i++) {
    const j = i - half;
    const from = j < 0 ? -j : j >= TURN_SAMPLES ? 2 * (TURN_SAMPLES - 1) - j : j;
    padded[i] = (audio[from]! - mean) * scale;
  }
  const features = new Float64Array(MEL_BINS * MEL_FRAMES);
  const frame = new Float64Array(MEL_BINS);
  // Windows wholly in the silence before a short utterance are all alike: worked out once.
  const silent = silence > half ? Math.floor((silence + half - WINDOW) / HOP) + 1 : 0;
  let top = -Infinity;
  for (let t = 0; t < MEL_FRAMES; t++) {
    if (t === 0 || t >= silent) logMel(padded, t * HOP, frame);
    for (let b = 0; b < MEL_BINS; b++) {
      features[b * MEL_FRAMES + t] = frame[b]!;
      if (frame[b]! > top) top = frame[b]!;
    }
  }
  return Float32Array.from(features, (v) => (Math.max(v, top - 8) + 4) / 4);
}

/** onnxruntime-web, as the page loads it (`onnxruntime-web/wasm`) or the tests do. */
type Ort = typeof import("onnxruntime-web");
type Session = import("onnxruntime-web").InferenceSession;

/** Silero VAD's frame, 32ms at 16kHz, and the end of the frame before that it hears with it. */
const FRAME = 512;
const CONTEXT = 64;
/** The frame's length in ms. */
export const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;

/** Where `serve` serves the two models and onnxruntime-web's WebAssembly, for the page. */
export const HEARING_FILES = {
  vad: "/voice/silero-vad.onnx",
  turn: "/voice/smart-turn-v3.2-cpu.onnx",
  wasm: "/voice/ort-wasm-simd-threaded.wasm",
} as const;

/** Where the two models come from: a URL (the page) or their bytes (the tests). */
export interface ModelSources {
  vad: string | Uint8Array;
  turn: string | Uint8Array;
}

/** Silero VAD and Smart Turn, loaded once and shared by every microphone. */
export class Models {
  private constructor(
    readonly ort: Ort,
    readonly vad: Session,
    readonly turn: Session,
  ) {}

  static async load(ort: Ort, sources: ModelSources) {
    // `create` takes a URL or bytes; its overloads take one or the other.
    const create = (source: string | Uint8Array) => (typeof source === "string" ? ort.InferenceSession.create(source) : ort.InferenceSession.create(source));
    const [vad, turn] = await Promise.all([create(sources.vad), create(sources.turn)]);
    const models = new Models(ort, vad, turn);
    // The first answer takes several times as long as the next ones: had now, not at the first pause.
    await models.finished(new Float32Array(SAMPLE_RATE));
    return models;
  }

  /** The probability Smart Turn gives that the user finished their turn, from what they said of it (16kHz, -1 to 1). */
  async finished(utterance: Float32Array): Promise<number> {
    const input = new this.ort.Tensor("float32", turnFeatures(utterance), [1, MEL_BINS, MEL_FRAMES]);
    const { logits } = await this.turn.run({ input_features: input });
    return (logits!.data as Float32Array)[0]!;
  }
}

/** One stream of audio through Silero VAD: the probability that each 32ms frame is speech, from what it heard before. */
export class Vad {
  private state: Float32Array = new Float32Array(2 * 128);
  private context = new Float32Array(CONTEXT);
  private readonly rate: import("onnxruntime-web").Tensor;

  constructor(private readonly models: Models) {
    this.rate = new models.ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  }

  async probability(frame: Float32Array): Promise<number> {
    const { ort, vad } = this.models;
    const input = new Float32Array(CONTEXT + FRAME);
    input.set(this.context);
    input.set(frame, CONTEXT);
    const { output, stateN } = await vad.run({
      input: new ort.Tensor("float32", input, [1, CONTEXT + FRAME]),
      state: new ort.Tensor("float32", this.state, [2, 1, 128]),
      sr: this.rate,
    });
    this.state = stateN!.data as Float32Array;
    this.context = input.slice(FRAME);
    return (output!.data as Float32Array)[0]!;
  }
}

/** Smart Turn's probability over which the user finished their turn. */
const FINISHED = 0.5;
/** How many frames of audio Smart Turn hears at most (8 seconds), and how many a barge-in's utterance starts with, about the words that broke in. */
const TURN_FRAMES = Math.ceil(TURN_SAMPLES / FRAME);
const BROKE_IN_FRAMES = 16;

/** What a batch of the microphone's audio left listening at, when the batch came (epoch ms), and how the utterance ended on it, if it did. */
export interface Heard {
  listening: Listening;
  at: number;
  ended?: Ending;
}

/**
 * Hears one microphone's 16kHz PCM as the talk button needs it: each 32ms
 * frame through Silero VAD into `listen`, and in an utterance, at a pause, all
 * of it so far through Smart Turn, whose answer counts from the frames heard
 * after it comes. Batches are heard one after another, in the order they
 * came. Outside an utterance it only listens, for the user talking over the
 * Lead (`bargesIn`); an utterance ends once, on the batch where it ended.
 */
export class Ears {
  listening: Listening = LISTENING;
  private models!: Models;
  private vad!: Vad;
  /** Samples short of a frame, heard with the next batch. */
  private rest = new Float32Array(0);
  /** The utterance's frames, its last 8 seconds; outside one, the last of what was heard, for words that break in. */
  private frames: Float32Array[] = [];
  private inUtterance = false;
  /** How many times Smart Turn was asked: an answer counts only if it answers the last one asked. */
  private asked = 0;
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  /** With the models, or while they load: what it is told to hear waits for them, and fails if they do. */
  constructor(models: Models | Promise<Models>) {
    this.ready = Promise.resolve(models).then((loaded) => {
      this.models = loaded;
      this.vad = new Vad(loaded);
    });
  }

  /** An utterance starts, from the words that broke in when `barged` (as long as they have been voiced), or from now. */
  begin(barged: boolean) {
    this.enqueue(async () => {
      this.inUtterance = true;
      this.asked++;
      this.listening = barged ? { ...this.listening, elapsed: this.listening.voiced } : LISTENING;
      this.frames = barged ? this.frames.slice(-BROKE_IN_FRAMES) : [];
    });
  }

  hear(pcm: Int16Array): Promise<Heard> {
    const at = Date.now();
    return this.enqueue(async () => {
      const samples = new Float32Array(this.rest.length + pcm.length);
      samples.set(this.rest);
      samples.set(Float32Array.from(pcm, (s) => s / 32768), this.rest.length);
      const frames = Math.floor(samples.length / FRAME);
      this.rest = samples.slice(frames * FRAME);
      let ended: Ending | undefined;
      for (let f = 0; f < frames; f++) {
        const frame = samples.slice(f * FRAME, (f + 1) * FRAME);
        this.frames.push(frame);
        this.frames.splice(0, this.frames.length - (this.inUtterance ? TURN_FRAMES : BROKE_IN_FRAMES));
        // Awaited before `listening` is read: Smart Turn may answer meanwhile.
        const probability = await this.vad.probability(frame);
        const heard = listen(this.listening, probability, FRAME_MS);
        this.listening = heard.state;
        if (!this.inUtterance) continue;
        if (heard.ask) this.ask();
        if (heard.ended) {
          ended = heard.ended;
          this.inUtterance = false;
        }
      }
      return { listening: this.listening, at, ...(ended && { ended }) };
    });
  }

  /**
   * Ask Smart Turn whether the user finished, while the pause goes on; its
   * answer, if nothing came since (speech, another pause, another utterance),
   * goes in `listening`. Without an answer the pause ends it as if finished.
   */
  private ask() {
    const asked = ++this.asked;
    const answer = (finished: boolean) => {
      if (this.asked === asked && this.inUtterance && !this.listening.speaking) this.listening = { ...this.listening, finished };
    };
    this.models.finished(joined(this.frames)).then((probability) => answer(probability > FINISHED), () => answer(true));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const done = this.queue.then(() => this.ready).then(work);
    this.queue = done.catch(() => {});
    return done;
  }
}

/** `frames` as one run of samples. */
function joined(frames: Float32Array[]) {
  const samples = new Float32Array(frames.length * FRAME);
  frames.forEach((frame, i) => samples.set(frame, i * FRAME));
  return samples;
}
