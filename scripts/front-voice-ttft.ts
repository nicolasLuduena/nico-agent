#!/usr/bin/env bun
// Measures the Front voice's endpoint (#185): whether it streams
// `/chat/completions` with the hand_off tool, and its time to first token.
// For each model, a few requests exactly as the Front voice sends them: one
// it should answer itself, one it should hand off.
//
//   OPENCODE_API_KEY=… bun scripts/front-voice-ttft.ts [model …]
//
// The endpoint is opencode go, the Front voice's default; FRONT_URL and
// FRONT_KEY_ENV point it elsewhere. Prints a line per request and the
// medians per model.
import { FRONT_VOICE_DEFAULT } from "../src/config";
import { RealWorld } from "../src/real-world";
import { frontVoiceReply } from "../src/voice";

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ["deepseek-v4.1-flash", "glm-5.3-flash", "mimo-v2.6-flash", "kimi-k2.6"];
const ROUNDS = 3;
const URL = process.env.FRONT_URL ?? FRONT_VOICE_DEFAULT.url;
const KEY_ENV = process.env.FRONT_KEY_ENV ?? FRONT_VOICE_DEFAULT.keyEnv;

/** What the Front voice reads, cut down to a Board of one issue. */
const CONTEXT = "Terms: Board, Lead, Dispatch, acme/api#7.\n\nThe Board (board --json):\n" +
  JSON.stringify({ issues: [{ issue: "acme/api#7", title: "Add retries to the herdr client", state: "Ready" }] });
const SAID = { answer: "hey how's it going", "hand off": "um dispatch the uh acme api seven" };

const world = new RealWorld();
const rows: { model: string; kind: string; ttft: number | null; total: number; got: string }[] = [];
for (const model of MODELS) {
  for (let round = 0; round < ROUNDS; round++) {
    for (const [kind, heard] of Object.entries(SAID)) {
      const started = performance.now();
      let first: number | null = null;
      let got = "";
      const reply = await frontVoiceReply(world, { url: URL, model, ...(KEY_ENV && { keyEnv: KEY_ENV }) }, { heard, context: CONTEXT });
      if ("error" in reply) {
        got = `${reply.error}. ${reply.help}`;
      } else {
        try {
          for await (const part of reply.parts) {
            first ??= performance.now() - started;
            got += "text" in part ? part.text : ` [${part.call.name} ${part.call.arguments}]`;
          }
        } catch (e) {
          got += ` stopped: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      const row = { model, kind, ttft: first === null ? null : Math.round(first), total: Math.round(performance.now() - started), got: got.replace(/\s+/g, " ").trim().slice(0, 100) };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log("\nmodel, kind: median time to first token / whole reply (ms)");
for (const model of MODELS) {
  for (const kind of Object.keys(SAID)) {
    const mine = rows.filter((r) => r.model === model && r.kind === kind);
    const ttfts = mine.flatMap((r) => (r.ttft === null ? [] : [r.ttft]));
    console.log(`${model}, ${kind}: ${ttfts.length ? median(ttfts) : "none"} / ${median(mine.map((r) => r.total))}`);
  }
}
