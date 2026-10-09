#!/usr/bin/env bun
// Streams each utterance of the Scribe's fixture set (test/fixtures/scribe)
// through `/api/voice`'s transcription in real time, as the app streams it,
// and ends it as the app does, on the pause after the speech. Prints, per
// utterance, how long after the end its final transcript came and how it
// compares with the whole utterance transcribed after the end, as before
// #183. The transcription service is config.json's voice.transcribe, else
// the local one docs/voice.md sets up; the Front voice is stood in for, so
// nothing is answered.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LISTENING, MIN_LEVEL, SAMPLE_RATE, level, listen, pcmSamples } from "../src/app/talk";
import { defaultConfigDir, loadConfig } from "../src/config";
import { RealWorld } from "../src/real-world";
import { type Transcript, transcriptionSession } from "../src/transcription";
import { transcribe, wav } from "../src/voice";

const DIR = join(import.meta.dir, "../test/fixtures/scribe");
const LOCAL = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
/** A tenth of a second of audio, in bytes: the app sends smaller batches, but as often makes no difference here. */
const BATCH = SAMPLE_RATE / 5;

const endpoint = loadConfig(defaultConfigDir(process.env)).voice?.transcribe ?? LOCAL;
const fixtures = JSON.parse(readFileSync(join(DIR, "utterances.json"), "utf8")) as { utterances: { file: string; said: string }[] };
// A config of its own, so the prompt is the same each run rather than this machine's Board.
const configDir = mkdtempSync(join(tmpdir(), "nico-agent-transcription-"));
writeFileSync(join(configDir, "config.json"), JSON.stringify({ repos: [], voice: { transcribe: endpoint } }));
const world = new RealWorld();
/** The prompt the session last sent, for the whole utterance to be primed alike. */
let prompt = "";
const http = world.http.bind(world);
world.http = async (request) => {
  prompt = String((await request.clone().formData()).get("prompt") ?? "");
  return http(request);
};
/** The Front voice, stood in for: it answers nothing, handing every final to the Lead at once. */
const front = { hear: async () => true, hush() {} };
const session = transcriptionSession({ world, configDir, runCli: async () => ({ stdout: "{}", exitCode: 0 }), front });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The fixture's audio as the app sends it: up to where its listening hears
 * the pause that ends it. The page hears with Silero VAD and Smart Turn;
 * here a level threshold stands in for the one, and the fixtures being whole
 * sentences, every pause Smart Turn is asked about is a finished turn.
 */
function asSent(file: string) {
  const pcm = new Uint8Array(readFileSync(join(DIR, file))).slice(44);
  const audio = new Uint8Array(pcm.byteLength + SAMPLE_RATE * 4);
  audio.set(pcm);
  let listening = LISTENING;
  for (let at = 0; at < audio.byteLength; at += BATCH) {
    const probability = level(pcmSamples(audio.slice(at, at + BATCH).buffer)) > MIN_LEVEL ? 1 : 0;
    const heard = listen(listening, probability, 100);
    listening = heard.ask ? { ...heard.state, finished: true } : heard.state;
    if (heard.ended) return audio.slice(0, at + BATCH);
  }
  return audio;
}

const rows: string[] = [];
const waits: number[] = [];
for (const [i, utterance] of fixtures.utterances.entries()) {
  const audio = asSent(utterance.file);
  const final = Promise.withResolvers<Transcript>();
  const talk = session({ send: (m) => { const t = JSON.parse(String(m)) as Transcript; if (t.type !== "interim") final.resolve(t); }, close() {} });
  talk.message(JSON.stringify({ type: "start", utterance: i + 1 }));
  const started = performance.now();
  for (let at = 0; at < audio.byteLength; at += BATCH) {
    talk.message(audio.slice(at, at + BATCH));
    await sleep(started + ((at + BATCH) / (SAMPLE_RATE * 2)) * 1000 - performance.now());
  }
  const ended = performance.now();
  talk.message(JSON.stringify({ type: "end" }));
  const heard = await final.promise;
  const wait = Math.round(performance.now() - ended);
  if (heard.type !== "final") throw new Error(`${utterance.file}: ${heard.type === "error" ? heard.error : heard.type}`);
  await sleep(500);
  const whole = await transcribe(world, endpoint, wav(audio, SAMPLE_RATE), prompt);
  if ("error" in whole) throw new Error(`${utterance.file}: ${whole.error}. ${whole.help}`);
  waits.push(wait);
  const cell = (text: string) => text.replaceAll("|", "\\|");
  rows.push(`| ${i + 1} | ${cell(utterance.said)} | ${cell(heard.text)} | ${heard.text === whole.returned ? "same" : cell(whole.returned)} | ${wait}ms | ${whole.ms}ms |`);
  console.error(`${utterance.file}: ${wait}ms ${heard.text}`);
}
waits.sort((a, b) => a - b);
console.log(["| # | Said | Final | Whole, if different | End to final | Whole alone |", "| - | ---- | ----- | ------------------- | ------------ | ----------- |", ...rows].join("\n"));
console.log(`\nEnd to final: median ${waits[waits.length >> 1]}ms.`);
