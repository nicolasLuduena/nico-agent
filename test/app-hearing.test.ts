import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { Ears, MEL_BINS, MEL_FRAMES, Models, turnFeatures } from "../src/app/hearing";
import { SAMPLE_RATE, bargesIn } from "../src/app/talk";

const FIXTURES = join(import.meta.dir, "fixtures");

/** A 16kHz 16-bit mono WAV's PCM. */
async function wavPcm(path: string) {
  return new Int16Array((await Bun.file(path).arrayBuffer()).slice(44));
}

/** A 16kHz 16-bit mono WAV's samples, from -1 to 1. */
async function wavSamples(path: string) {
  return Float32Array.from(await wavPcm(path), (s) => s / 32768);
}

describe("what Smart Turn hears", () => {
  // `test/fixtures/turn/09.features.f32` is what Smart Turn's own inference code feeds it for `scribe/09.wav`:
  // the audio padded at the start to 8s, then `WhisperFeatureExtractor(chunk_length=8)` from `transformers`
  // with `padding="max_length", max_length=128000, do_normalize=True`, as float32.
  test("is the utterance's last 8 seconds as Whisper's log-mel features, as Smart Turn's inference makes them", async () => {
    const expected = new Float32Array(await Bun.file(join(FIXTURES, "turn/09.features.f32")).arrayBuffer());
    const features = turnFeatures(await wavSamples(join(FIXTURES, "scribe/09.wav")));
    expect(features.length).toBe(MEL_BINS * MEL_FRAMES);
    expect(expected.length).toBe(features.length);
    let worst = 0;
    for (let i = 0; i < features.length; i++) worst = Math.max(worst, Math.abs(features[i]! - expected[i]!));
    expect(worst).toBeLessThan(1e-3);
  });

  test("an utterance longer than 8 seconds is heard by its end", async () => {
    const utterance = await wavSamples(join(FIXTURES, "scribe/09.wav"));
    const longer = new Float32Array(utterance.length + SAMPLE_RATE * 10);
    longer.set(Float32Array.from({ length: SAMPLE_RATE * 10 }, (_, i) => Math.sin(i / 7) * 0.3));
    longer.set(utterance, SAMPLE_RATE * 10);
    const tail = longer.slice(-8 * SAMPLE_RATE);
    expect(turnFeatures(longer)).toEqual(turnFeatures(tail));
  });
});

const { utterances } = (await Bun.file(join(FIXTURES, "scribe/utterances.json")).json()) as { utterances: { file: string; said: string }[] };

/** The microphone's batches as the page hears them: 2048 samples at 48kHz, about 683 at 16kHz. */
const BATCH = 683;

/** 16-bit PCM of `seconds` of `sample(i)` (at 16kHz, from -1 to 1). */
const pcmOf = (seconds: number, sample: (i: number) => number) => Int16Array.from({ length: seconds * SAMPLE_RATE }, (_, i) => Math.round(Math.max(-1, Math.min(1, sample(i))) * 32767));

/** A quiet room's hiss. */
const hiss = (seconds: number) => pcmOf(seconds, () => (Math.random() - 0.5) * 0.002);

/** `pcm` through `ears` a batch at a time, until the utterance ends: how, and after how many samples heard; and whether a barge-in was heard. */
async function through(ears: Ears, pcm: Int16Array) {
  let barged = false;
  for (let at = 0; at < pcm.length; at += BATCH) {
    const heard = await ears.hear(pcm.subarray(at, at + BATCH));
    barged ||= bargesIn(heard.listening);
    if (heard.ended) return { ended: heard.ended, after: Math.min(at + BATCH, pcm.length), barged };
  }
  return { ended: null, after: pcm.length, barged };
}

describe("hearing the microphone, with Silero VAD and Smart Turn", () => {
  let models: Models;
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    const bytes = async (file: string) => new Uint8Array(await Bun.file(join(import.meta.dir, "../src/app/models", file)).arrayBuffer());
    models = await Models.load(ort, { vad: await bytes("silero-vad.onnx"), turn: await bytes("smart-turn-v3.2-cpu.onnx") });
  }, 30_000);

  for (const { file, said } of utterances) {
    // Several pause mid-sentence, as long as 450ms ("Tell the implementer on B L E forty two to, um, ...").
    test(`"${said}" ends on the pause after its last word, not before`, async () => {
      const wav = await wavPcm(join(FIXTURES, "scribe", file));
      const ears = new Ears(models);
      ears.begin(false);
      const { ended, after } = await through(ears, Int16Array.from([...wav, ...hiss(3)]));
      expect(ended).toBe("pause");
      expect(after).toBeGreaterThanOrEqual(wav.length);
    }, 20_000);
  }

  const noises: [string, Int16Array][] = [
    ["a door slamming", Int16Array.from([...hiss(1), ...pcmOf(1, (i) => Math.exp(-i / 1600) * (Math.sin(i / 40) * 0.8 + (Math.random() - 0.5) * 0.6)), ...hiss(1)])],
    ["knocks", Int16Array.from(Array.from({ length: 4 }, () => [...pcmOf(0.04, (i) => Math.exp(-i / 80) * (Math.random() - 0.5) * 1.6), ...hiss(0.3)]).flat())],
    ["loud steady noise", pcmOf(3, () => (Math.random() - 0.5) * 0.5)],
    ["a hum", pcmOf(3, (i) => Math.sin((2 * Math.PI * 100 * i) / SAMPLE_RATE) * 0.4)],
  ];
  for (const [noise, pcm] of noises) {
    test(`${noise}, without speech, starts no utterance and talks over nothing`, async () => {
      const watching = new Ears(models);
      expect((await through(watching, pcm)).barged).toBe(false);
      const listening = new Ears(models);
      listening.begin(false);
      const { ended } = await through(listening, Int16Array.from([...pcm, ...hiss(7)]));
      expect(ended).toBe("nothing");
    }, 20_000);
  }

  test("speech while it only listens is the user talking over the Lead", async () => {
    const wav = await wavPcm(join(FIXTURES, "scribe/03.wav"));
    expect(await through(new Ears(models), wav)).toMatchObject({ ended: null, barged: true });
  }, 20_000);
});
