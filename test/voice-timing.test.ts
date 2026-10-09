import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { sayArgs } from "../src/app/lead";
import { loadConversation } from "../src/conversation";
import { TIMING_FILE } from "../src/voice-timing";
import { setup } from "./harness";

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const TRANSCRIBE = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
const FRONT = { url: "http://127.0.0.1:4100/v1", model: "glm-5.3-flash" };

/** When the user stops talking in each test. */
const SPOKE = new Date("2026-09-30T12:00:00.000Z");

/** Half a second of 16kHz mono 16-bit PCM. */
const AUDIO = new Uint8Array(16_000);

/** Voice configured, and the clock at SPOKE; the Lead started (idle) when `lead`. */
async function withVoice({ voice = { transcribe: TRANSCRIBE, front: FRONT } as Record<string, unknown>, lead = true } = {}) {
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
    text = readFileSync(join(configDir, TIMING_FILE), "utf8");
  } catch {}
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

type Voiced = Awaited<ReturnType<typeof withVoice>>;

/** Say something into the page as `utterance`, having stopped talking at SPOKE; its final transcript, or the error. */
async function speak({ talk }: Voiced, utterance: number) {
  talk.json({ type: "start", utterance });
  talk.send(AUDIO);
  talk.json({ type: "end", spokeAt: SPOKE.getTime() });
  return await talk.next();
}

/** A Front voice that hands `message` off, after `ms` on the clock. */
function handsOff(world: Voiced["world"], message: string, ms = 0) {
  world.endpoint(`${FRONT.url}/chat/completions`, async () => {
    later(world, ms);
    const call = { index: 0, function: { name: "hand_off", arguments: JSON.stringify({ message }) } };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
}

/** Wait for the Front voice to hand the user's message to the Lead, and let serve see its entry. */
async function handedOff(ctx: Voiced) {
  for (const end = Date.now() + 1000; !loadConversation(ctx.configDir).some((e) => e.type === "user"); await Bun.sleep(2)) {
    if (Date.now() > end) throw new Error("never handed off");
  }
  await ctx.look();
}

/** Post `text` as the page does, heard as `raw` when spoken, and let serve see the new entry. */
async function post(ctx: Voiced, text: string, raw?: string) {
  await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs(text, undefined, raw) }) });
  await ctx.look();
}

describe("the voice timing log", () => {
  test("a spoken message is one line, with when each step happened and how long it took after the one before", async () => {
    const ctx = await withVoice();
    const { world, talk } = ctx;
    await ctx.cli("voice", "on");
    // Transcription takes 1.2s, the Front voice 0.9s to hand it off; the idle Lead is Nudged at once.
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 1200);
      return Response.json({ text: "um what is running" });
    });
    handsOff(world, "What is running?", 900);

    expect(await speak(ctx, 4)).toMatchObject({ type: "final", text: "um what is running" });
    await handedOff(ctx);
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
      handed: "2026-09-30T12:00:02.100Z",
      written: "2026-09-30T12:00:02.100Z",
      nudged: "2026-09-30T12:00:02.100Z",
      said: "2026-09-30T12:00:08.100Z",
      played: "2026-09-30T12:00:08.500Z",
      took: { transcribed: 1200, handed: 900, written: 0, nudged: 0, said: 6000, played: 400 },
      total: 8500,
      slowest: "said",
    }]);

    // A second report of the same audio, from another page, writes nothing more.
    talk.json({ type: "played", entry: said.said, at: world.clock.getTime() + 500 });
    expect(timings(ctx.configDir)).toHaveLength(1);
  });

  test("with Voice off the line is written when the Lead first says something, and the steps that did not happen are null", async () => {
    // The Front voice's key not set: the transcript is sent as heard. No Lead running: nobody is Nudged.
    const ctx = await withVoice({ voice: { transcribe: TRANSCRIBE }, lead: false });
    const { world } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 1000);
      return Response.json({ text: "what is running" });
    });

    await speak(ctx, 1);
    await handedOff(ctx);
    later(world, 3000);
    await ctx.cli("lead", "say", "--", "Nothing is running.");
    await ctx.look();

    expect(timings(ctx.configDir)).toEqual([{
      utterance: 1,
      text: "what is running",
      spoke: "2026-09-30T12:00:00.000Z",
      transcribed: "2026-09-30T12:00:01.000Z",
      handed: null,
      written: "2026-09-30T12:00:01.000Z",
      nudged: null,
      said: "2026-09-30T12:00:04.000Z",
      played: null,
      took: { transcribed: 1000, handed: null, written: 0, nudged: null, said: 3000, played: null },
      total: null,
      slowest: "said",
    }]);
  });

  test("an utterance whose transcription fails is a line of its own, with only the end of speech", async () => {
    const ctx = await withVoice();
    const { world } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => new Response("model not loaded", { status: 500 }));

    expect(await speak(ctx, 2)).toMatchObject({ type: "error", utterance: 2 });

    expect(timings(ctx.configDir)).toEqual([{
      utterance: 2,
      text: "",
      spoke: "2026-09-30T12:00:00.000Z",
      transcribed: null,
      handed: null,
      written: null,
      nudged: null,
      said: null,
      played: null,
      took: { transcribed: null, handed: null, written: null, nudged: null, said: null, played: null },
      total: null,
      slowest: null,
    }]);
  });

  test("a line is written with what happened once the Lead has not answered in five minutes", async () => {
    const ctx = await withVoice();
    const { world } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => Response.json({ text: "what is running" }));
    handsOff(world, "What is running?");

    await speak(ctx, 3);
    await handedOff(ctx);

    later(world, 4 * 60_000);
    await post(ctx, "typed, not spoken");
    expect(timings(ctx.configDir)).toEqual([]);

    // serve's next tick, or anything else it hears, writes it.
    later(world, 60_000);
    await post(ctx, "still there?");
    expect(timings(ctx.configDir)).toMatchObject([{ utterance: 3, written: "2026-09-30T12:00:00.000Z", nudged: "2026-09-30T12:00:00.000Z", said: null, played: null, slowest: "transcribed" }]);
  });
});
