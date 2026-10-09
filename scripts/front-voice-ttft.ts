#!/usr/bin/env bun
// Measures the Front voice's endpoint (#185): whether it streams
// `/chat/completions` with the hand_off tool, and its time to first token.
// For each model, a few streamed requests of the kind the Front voice sends:
// one it should answer itself, one it should hand off.
//
//   OPENCODE_API_KEY=… bun scripts/front-voice-ttft.ts [model …]
//
// The URL and key variable are opencode go's unless FRONT_URL and
// FRONT_KEY_ENV say otherwise. Prints a line per request and a median per model.
import { HAND_OFF } from "../src/voice";

const URL = process.env.FRONT_URL ?? "https://opencode.ai/zen/go/v1";
const KEY_ENV = process.env.FRONT_KEY_ENV ?? "OPENCODE_API_KEY";
const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ["deepseek-v4.1-flash", "glm-5.3-flash", "mimo-v2.6-flash", "kimi-k2.6"];
const ROUNDS = 3;

const key = process.env[KEY_ENV];
if (!key) {
  console.error(`${KEY_ENV} is not set`);
  process.exit(1);
}

const SYSTEM = "You are the Front voice of nico-agent, in front of the Lead, an agent that runs coding agents on a Board of issues. " +
  "Answer small talk yourself in one short sentence; hand anything that needs an action to the Lead with hand_off, writing nothing yourself.\n\n" +
  "The Board: acme/api#7 Add retries to the herdr client (Ready).";
const SAID = { answer: "hey how's it going", "hand off": "um dispatch the uh acme api seven" };

const rows: { model: string; kind: string; ttft: number | null; total: number; got: string }[] = [];
for (const model of MODELS) {
  for (let round = 0; round < ROUNDS; round++) {
    for (const [kind, heard] of Object.entries(SAID)) {
      const started = performance.now();
      let first: number | null = null;
      let got = "";
      try {
        const response = await fetch(`${URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: 0, stream: true, tools: [HAND_OFF], messages: [{ role: "system", content: SYSTEM }, { role: "user", content: heard }] }),
        });
        if (!response.ok || !response.body) {
          got = `answered ${response.status}: ${(await response.text()).slice(0, 120)}`;
        } else {
          const decoder = new TextDecoder();
          for await (const chunk of response.body) {
            for (const line of decoder.decode(chunk, { stream: true }).split("\n")) {
              const data = /^data:\s?(.*)$/.exec(line.trim())?.[1];
              if (!data || data === "[DONE]") continue;
              const delta = JSON.parse(data)?.choices?.[0]?.delta;
              const piece = delta?.content || delta?.tool_calls?.[0]?.function?.name || delta?.tool_calls?.[0]?.function?.arguments;
              if (!piece) continue;
              first ??= performance.now() - started;
              got += delta?.tool_calls?.[0]?.function?.name ? `[${piece}] ` : piece;
            }
          }
        }
      } catch (e) {
        got = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      const row = { model, kind, ttft: first === null ? null : Math.round(first), total: Math.round(performance.now() - started), got: got.replace(/\s+/g, " ").slice(0, 100) };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}

const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log("\nmodel, kind: median time to first token / whole reply (ms)");
for (const model of MODELS) {
  for (const kind of Object.keys(SAID)) {
    const mine = rows.filter((r) => r.model === model && r.kind === kind);
    const ttfts = mine.flatMap((r) => (r.ttft === null ? [] : [r.ttft]));
    console.log(`${model}, ${kind}: ${ttfts.length ? median(ttfts) : "none"} / ${median(mine.map((r) => r.total))}`);
  }
}
