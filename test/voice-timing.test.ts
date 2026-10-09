import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { sayArgs } from "../src/app/lead";
import { setup } from "./harness";

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const TRANSCRIBE = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
const SCRIBE = { url: "http://127.0.0.1:11434/v1", model: "qwen2.5:3b" };

/** When the user stops talking in each test. */
const SPOKE = new Date("2026-09-30T12:00:00.000Z");

/** Half a second of 16kHz mono 16-bit PCM. */
const AUDIO = new Uint8Array(16_000);

/** Voice configured, and the clock at SPOKE; the Lead started (idle) when `lead`. */
async function withVoice({ voice = { transcribe: TRANSCRIBE, scribe: SCRIBE } as Record<string, unknown>, lead = true } = {}) {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], voice, lead: LAUNCH, scheduler: LAUNCH }));
  if (lead) {
    expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
    ctx.world.agentStates.set("lead", "idle");
  }
  ctx.world.clock = SPOKE;
  const talk = await ctx.socket("/api/voice");
  if ("refused" in talk) throw new Error(`refused: ${talk.refused!.body}`);
  return { ...ctx, talk };
}

/** Move the fake clock on by `ms`. */
function later(world: { clock: Date }, ms: number) {
  world.clock = new Date(world.clock.getTime() + ms);
}

/** The lines of the timing log, parsed. */
function timings(configDir: string) {
  let text = "";
  try {
    text = readFileSync(join(configDir, "voice-timing.jsonl"), "utf8");
  } catch {}
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("the voice timing log", () => {
  test("a spoken message is one line, with when each step happened and how long it took after the one before", async () => {
    const ctx = await withVoice();
    const { world, talk } = ctx;
    await ctx.cli("voice", "on");
    // Transcription takes 1.2s, the Scribe 0.9s.
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 1200);
      return Response.json({ text: "um what is running" });
    });
    world.endpoint(`${SCRIBE.url}/chat/completions`, async () => {
      later(world, 900);
      return Response.json({ choices: [{ message: { role: "assistant", content: "What is running?" } }] });
    });

    talk.json({ type: "start", utterance: 4 });
    talk.send(AUDIO);
    talk.json({ type: "end", spokeAt: SPOKE.getTime() });
    const final = await talk.next();
    expect(final).toMatchObject({ type: "final", text: "What is running?" });

    // The page posts it 0.1s later, and the idle Lead is Nudged at once.
    later(world, 100);
    await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs(final.text, undefined, final.raw) }) });
    await ctx.look();
    expect(timings(ctx.configDir)).toEqual([]);

    // The Lead says something 6s later, and the page plays it 0.4s after that.
    later(world, 6000);
    const said = (await ctx.cli("lead", "say", "--json", "--", "Two Dispatches are running.")).json();
    await ctx.look();
    talk.json({ type: "played", entry: said.said, at: world.clock.getTime() + 400 });

    expect(timings(ctx.configDir)).toEqual([{
      utterance: 4,
      text: "What is running?",
      spoke: "2026-09-30T12:00:00.000Z",
      transcribed: "2026-09-30T12:00:01.200Z",
      scribed: "2026-09-30T12:00:02.100Z",
      written: "2026-09-30T12:00:02.200Z",
      nudged: "2026-09-30T12:00:02.200Z",
      said: "2026-09-30T12:00:08.200Z",
      played: "2026-09-30T12:00:08.600Z",
      took: { transcribed: 1200, scribed: 900, written: 100, nudged: 0, said: 6000, played: 400 },
      total: 8600,
      slowest: "said",
    }]);

    // A second report of the same audio, from another page, writes nothing more.
    talk.json({ type: "played", entry: said.said, at: world.clock.getTime() + 500 });
    expect(timings(ctx.configDir)).toHaveLength(1);
  });

  test("with Voice off the line is written when the Lead first says something, and the steps that did not happen are null", async () => {
    // No Scribe: the transcript is sent as heard. No Lead running: nobody is Nudged.
    const ctx = await withVoice({ voice: { transcribe: TRANSCRIBE }, lead: false });
    const { world, talk } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 1000);
      return Response.json({ text: "what is running" });
    });

    talk.json({ type: "start", utterance: 1 });
    talk.send(AUDIO);
    talk.json({ type: "end", spokeAt: SPOKE.getTime() });
    const final = await talk.next();
    await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs(final.text, undefined, final.raw) }) });
    await ctx.look();
    later(world, 3000);
    await ctx.cli("lead", "say", "--", "Nothing is running.");
    await ctx.look();

    expect(timings(ctx.configDir)).toEqual([{
      utterance: 1,
      text: "what is running",
      spoke: "2026-09-30T12:00:00.000Z",
      transcribed: "2026-09-30T12:00:01.000Z",
      scribed: null,
      written: "2026-09-30T12:00:01.000Z",
      nudged: null,
      said: "2026-09-30T12:00:04.000Z",
      played: null,
      took: { transcribed: 1000, scribed: null, written: 0, nudged: null, said: 3000, played: null },
      total: null,
      slowest: "said",
    }]);
  });

  test("an utterance whose transcription fails is a line of its own, with only the end of speech", async () => {
    const ctx = await withVoice();
    const { world, talk } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => new Response("model not loaded", { status: 500 }));

    talk.json({ type: "start", utterance: 2 });
    talk.send(AUDIO);
    talk.json({ type: "end", spokeAt: SPOKE.getTime() });
    expect(await talk.next()).toMatchObject({ type: "error", utterance: 2 });

    expect(timings(ctx.configDir)).toEqual([{
      utterance: 2,
      text: "",
      spoke: "2026-09-30T12:00:00.000Z",
      transcribed: null,
      scribed: null,
      written: null,
      nudged: null,
      said: null,
      played: null,
      took: { transcribed: null, scribed: null, written: null, nudged: null, said: null, played: null },
      total: null,
      slowest: null,
    }]);
  });

  test("a line is written with what happened once the Lead has not answered in five minutes", async () => {
    const ctx = await withVoice();
    const { world, talk } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => Response.json({ text: "what is running" }));
    world.endpoint(`${SCRIBE.url}/chat/completions`, async () => Response.json({ choices: [{ message: { role: "assistant", content: "What is running?" } }] }));

    talk.json({ type: "start", utterance: 3 });
    talk.send(AUDIO);
    talk.json({ type: "end", spokeAt: SPOKE.getTime() });
    const final = await talk.next();
    await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs(final.text, undefined, final.raw) }) });
    await ctx.look();

    later(world, 4 * 60_000);
    await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs("typed, not spoken") }) });
    await ctx.look();
    expect(timings(ctx.configDir)).toEqual([]);

    // serve's next tick, or anything else it hears, writes it.
    later(world, 60_000);
    await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs("still there?") }) });
    expect(timings(ctx.configDir)).toMatchObject([{ utterance: 3, written: "2026-09-30T12:00:00.000Z", nudged: "2026-09-30T12:00:00.000Z", said: null, played: null, slowest: "transcribed" }]);
  });
});
