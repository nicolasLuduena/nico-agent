#!/usr/bin/env bun
// Records the voice fixture set (test/fixtures/scribe): each utterance
// voiced by the speak service when its WAV is missing (or with --speak),
// transcribed with the vocabulary as the prompt, and handed to the Front
// voice, whose hand_off message is the cleaned text; the raw and cleaned text
// written back. Prints the before/after as a Markdown table. The services are
// config.json's voice block, else the local ones docs/voice.md sets up; the
// Front voice is voice.front, else opencode go (its key in OPENCODE_API_KEY).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_RATE, resampler } from "../src/app/talk";
import { type VoiceConfig, defaultConfigDir, frontVoice, loadConfig } from "../src/config";
import { RealWorld } from "../src/real-world";
import { frontVoiceReply, transcribe, wav } from "../src/voice";

const DIR = join(import.meta.dir, "../test/fixtures/scribe");
const FILE = join(DIR, "utterances.json");

const LOCAL: Required<Pick<VoiceConfig, "transcribe" | "speak">> = {
  transcribe: { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" },
  speak: { url: "http://127.0.0.1:8880/v1", model: "kokoro", voice: "af_heart" },
};

interface Fixtures {
  about: string;
  vocabulary: string;
  recent: string[];
  utterances: { file: string; said: string; raw: string; cleaned: string }[];
}

const world = new RealWorld();
const configured = loadConfig(defaultConfigDir(process.env)).voice;
const voice = { ...LOCAL, ...configured, front: frontVoice(configured) };
const fixtures = JSON.parse(readFileSync(FILE, "utf8")) as Fixtures;
const respeak = process.argv.includes("--speak");

/**
 * What the Front voice hands off of `raw`, with the fixtures' vocabulary and
 * conversation; its own words in brackets when it answers instead.
 */
async function handOff(raw: string): Promise<string> {
  const context = `Terms: ${fixtures.vocabulary}\n\nThe conversation so far, oldest first:\n${fixtures.recent.join("\n")}`;
  const reply = await frontVoiceReply(world, voice.front, { heard: raw, context });
  if ("error" in reply) throw new Error(`${reply.error}. ${reply.help}`);
  let said = "";
  for await (const part of reply.parts) {
    if ("text" in part) said += part.text;
    else if (part.call.name === "hand_off") return String(JSON.parse(part.call.arguments).message ?? "").trim();
  }
  return `[answered: ${said.trim()}]`;
}

/** `text` read by the speak service, as a 16kHz mono WAV. */
async function speak(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const { url, model, voice: reader } = voice.speak;
  const response = await fetch(`${url}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: text, voice: reader, response_format: "wav" }),
  });
  if (!response.ok) throw new Error(`speak answered ${response.status}: ${await response.text()}`);
  const file = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(file.buffer);
  const rate = view.getUint32(24, true);
  let at = 12;
  while (new TextDecoder().decode(file.slice(at, at + 4)) !== "data") at += 8 + view.getUint32(at + 4, true);
  const pcm = new Int16Array(file.buffer.slice(at + 8, file.byteLength - ((file.byteLength - at - 8) % 2)));
  const samples = Float32Array.from(pcm, (s) => s / 32768);
  return wav(new Uint8Array(resampler(rate)(samples).buffer), SAMPLE_RATE);
}

const rows: string[] = [];
for (const [i, utterance] of fixtures.utterances.entries()) {
  const path = join(DIR, utterance.file);
  if (respeak || !existsSync(path)) writeFileSync(path, await speak(utterance.said));
  const audio = new Uint8Array(readFileSync(path));
  const heard = await transcribe(world, voice.transcribe, audio, fixtures.vocabulary);
  if ("error" in heard) throw new Error(`${utterance.file}: ${heard.error}. ${heard.help}`);
  const started = performance.now();
  const cleaned = await handOff(heard.returned);
  const ms = Math.round(performance.now() - started);
  Object.assign(utterance, { raw: heard.returned, cleaned });
  const cell = (text: string) => text.replaceAll("|", "\\|");
  rows.push(`| ${i + 1} | ${cell(utterance.said)} | ${cell(heard.returned)} | ${cell(cleaned)} | ${heard.ms}ms + ${ms}ms |`);
  console.error(`${utterance.file}: ${heard.returned} -> ${cleaned}`);
}
writeFileSync(FILE, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(["| # | Said | Raw | Cleaned | ms |", "| - | ---- | --- | ------- | -- |", ...rows].join("\n"));
