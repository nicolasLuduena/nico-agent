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
const SPEAK = { url: "http://127.0.0.1:8880/v1", model: "kokoro", voice: "af_heart" };

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

/** Say something into the page as `utterance`, having stopped talking at SPOKE, and the page ending it `pause` ms later; its final transcript, or the error. */
async function speak({ talk, world }: Voiced, utterance: number, pause = 0) {
  talk.json({ type: "start", utterance });
  talk.send(AUDIO);
  later(world, pause);
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

/**
 * A Front voice whose reply the test streams: `write` sends text as it comes,
 * `handOff` hands `message` off, `end` finishes it. The request is answered
 * after `ms` on the clock.
 */
function streams(world: Voiced["world"], ms = 0) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  world.endpoint(`${FRONT.url}/chat/completions`, async () => {
    later(world, ms);
    return new Response(new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } }), { headers: { "content-type": "text/event-stream" } });
  });
  const send = (data: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  return {
    asked: () => world.calls.includes(`http POST ${FRONT.url}/chat/completions`),
    write: (content: string) => send({ choices: [{ index: 0, delta: { content } }] }),
    handOff(message: string) {
      const call = { index: 0, function: { name: "hand_off", arguments: JSON.stringify({ message }) } };
      send({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: "tool_calls" }] });
    },
    end() {
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      stream.close();
    },
  };
}

/** Wait until `check` holds, as serve works in the background; fail after a second. */
async function until(check: () => boolean) {
  for (const end = Date.now() + 1000; !check(); await Bun.sleep(2)) {
    if (Date.now() > end) throw new Error("timed out waiting");
  }
}

/** Wait for the Front voice to hand the user's message to the Lead, and let serve see its entry. */
async function handedOff(ctx: Voiced) {
  await until(() => loadConversation(ctx.configDir).some((e) => e.type === "user"));
  await ctx.look();
}

/** The next speech the page is sent, past any audio. */
async function nextSpeech(talk: Voiced["talk"]) {
  for (;;) {
    const message = await talk.next();
    if (!(message instanceof Uint8Array) && message.type === "speech") return message;
  }
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

    // The page hears the end of speech in a pause of 0.5s.
    expect(await speak(ctx, 4, 500)).toMatchObject({ type: "final", text: "um what is running" });
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
      ended: "2026-09-30T12:00:00.500Z",
      transcribed: "2026-09-30T12:00:01.700Z",
      asked: "2026-09-30T12:00:01.700Z",
      firstToken: "2026-09-30T12:00:02.600Z",
      firstSentence: null,
      handed: "2026-09-30T12:00:02.600Z",
      written: "2026-09-30T12:00:02.600Z",
      nudged: "2026-09-30T12:00:02.600Z",
      said: "2026-09-30T12:00:08.600Z",
      played: "2026-09-30T12:00:09.000Z",
      took: { ended: 500, transcribed: 1200, asked: 0, firstToken: 900, firstSentence: null, handed: 0, written: 0, nudged: 0, said: 6000, played: 400 },
      total: 9000,
      slowest: "said",
    }]);

    // A second report of the same audio, from another page, writes nothing more.
    talk.json({ type: "played", entry: said.said, at: world.clock.getTime() + 500 });
    expect(timings(ctx.configDir)).toHaveLength(1);
  });

  test("a message the Front voice answers itself is timed to its first sentence played", async () => {
    const ctx = await withVoice({ voice: { transcribe: TRANSCRIBE, front: FRONT, speak: SPEAK } });
    const { world, talk } = ctx;
    await ctx.cli("voice", "on");
    world.endpoint(`${SPEAK.url}/audio/speech`, async () => new Response(new Uint8Array([1, 0]), { headers: { "content-type": "audio/pcm" } }));
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 1200);
      return Response.json({ text: "hey how's it going" });
    });
    // The Front voice's endpoint answers in 0.3s; its first token comes 0.4s later, and its first sentence ends 0.2s after that.
    const reply = streams(world, 300);

    expect(await speak(ctx, 5, 500)).toMatchObject({ type: "final", text: "hey how's it going" });
    await until(reply.asked);
    later(world, 400);
    reply.write("Hi there");
    await Bun.sleep(20);
    later(world, 200);
    reply.write(". Anything else?");

    // The page plays the first sentence 0.25s after it went to speech.
    const speech = await nextSpeech(talk);
    expect(speech).toEqual({ type: "speech", line: expect.any(Number), rate: 24_000 });
    talk.json({ type: "played", line: speech.line, at: world.clock.getTime() + 250 });
    expect(timings(ctx.configDir)).toEqual([]);
    reply.end();

    await until(() => timings(ctx.configDir).length > 0);
    expect(timings(ctx.configDir)).toEqual([{
      utterance: 5,
      text: "hey how's it going",
      spoke: "2026-09-30T12:00:00.000Z",
      ended: "2026-09-30T12:00:00.500Z",
      transcribed: "2026-09-30T12:00:01.700Z",
      asked: "2026-09-30T12:00:01.700Z",
      firstToken: "2026-09-30T12:00:02.400Z",
      firstSentence: "2026-09-30T12:00:02.600Z",
      handed: null,
      written: null,
      nudged: null,
      said: null,
      played: "2026-09-30T12:00:02.850Z",
      took: { ended: 500, transcribed: 1200, asked: 0, firstToken: 700, firstSentence: 200, handed: null, written: null, nudged: null, said: null, played: 250 },
      total: 2850,
      slowest: "transcribed",
    }]);

    // A second report of the same audio, from another page, writes nothing more.
    talk.json({ type: "played", line: speech.line, at: world.clock.getTime() + 300 });
    expect(timings(ctx.configDir)).toHaveLength(1);
  });

  test("a message handed off after the Front voice spoke is timed to the Lead's reply, with when the Front voice was asked and first answered", async () => {
    const ctx = await withVoice({ voice: { transcribe: TRANSCRIBE, front: FRONT, speak: SPEAK } });
    const { world, talk } = ctx;
    await ctx.cli("voice", "on");
    world.endpoint(`${SPEAK.url}/audio/speech`, async () => new Response(new Uint8Array([1, 0]), { headers: { "content-type": "audio/pcm" } }));
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 1000);
      return Response.json({ text: "dispatch acme api seven" });
    });
    const reply = streams(world, 200);

    await speak(ctx, 6);
    await until(reply.asked);
    // Its first token, a sentence, comes 0.5s after it was asked; it hands off 0.4s later.
    later(world, 300);
    reply.write("Let me check. ");
    await Bun.sleep(20);
    later(world, 400);
    reply.handOff("Dispatch acme/api#7.");
    reply.end();
    await handedOff(ctx);

    // The page playing the Front voice's sentence times nothing.
    const first = await nextSpeech(talk);
    talk.json({ type: "played", line: first.line, at: world.clock.getTime() });
    expect(timings(ctx.configDir)).toEqual([]);

    later(world, 2000);
    const said = (await ctx.cli("lead", "say", "--json", "--", "Dispatched.")).json();
    await ctx.look();
    talk.json({ type: "played", entry: said.said, at: world.clock.getTime() + 100 });

    expect(timings(ctx.configDir)).toEqual([{
      utterance: 6,
      text: "Dispatch acme/api#7.",
      spoke: "2026-09-30T12:00:00.000Z",
      ended: "2026-09-30T12:00:00.000Z",
      transcribed: "2026-09-30T12:00:01.000Z",
      asked: "2026-09-30T12:00:01.000Z",
      firstToken: "2026-09-30T12:00:01.500Z",
      firstSentence: null,
      handed: "2026-09-30T12:00:01.900Z",
      written: "2026-09-30T12:00:01.900Z",
      nudged: "2026-09-30T12:00:01.900Z",
      said: "2026-09-30T12:00:03.900Z",
      played: "2026-09-30T12:00:04.000Z",
      took: { ended: 0, transcribed: 1000, asked: 0, firstToken: 500, firstSentence: null, handed: 400, written: 0, nudged: 0, said: 2000, played: 100 },
      total: 4000,
      slowest: "said",
    }]);
  });

  test("with Voice off the line is written when the Lead first says something, and the steps that did not happen are null", async () => {
    // The Front voice's key not set: it fails before its first token, and the transcript is sent as heard. No Lead running: nobody is Nudged.
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
      ended: "2026-09-30T12:00:00.000Z",
      transcribed: "2026-09-30T12:00:01.000Z",
      asked: "2026-09-30T12:00:01.000Z",
      firstToken: null,
      firstSentence: null,
      handed: null,
      written: "2026-09-30T12:00:01.000Z",
      nudged: null,
      said: "2026-09-30T12:00:04.000Z",
      played: null,
      took: { ended: 0, transcribed: 1000, asked: 0, firstToken: null, firstSentence: null, handed: null, written: 0, nudged: null, said: 3000, played: null },
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
      ended: "2026-09-30T12:00:00.000Z",
      transcribed: null,
      asked: null,
      firstToken: null,
      firstSentence: null,
      handed: null,
      written: null,
      nudged: null,
      said: null,
      played: null,
      took: { ended: 0, transcribed: null, asked: null, firstToken: null, firstSentence: null, handed: null, written: null, nudged: null, said: null, played: null },
      total: null,
      slowest: "ended",
    }]);
  });

  test("a phantom transcript is a line of its own, with what was heard and why it was dropped, and reaches no one", async () => {
    const ctx = await withVoice();
    const { world } = ctx;
    world.endpoint(`${TRANSCRIBE.url}/audio/transcriptions`, async () => {
      later(world, 800);
      return Response.json({ text: " Thanks for watching." });
    });
    handsOff(world, "Thanks for watching.");

    expect(await speak(ctx, 5)).toEqual({ type: "final", utterance: 5, text: "" });

    expect(timings(ctx.configDir)).toEqual([expect.objectContaining({
      utterance: 5,
      text: "Thanks for watching.",
      transcribed: "2026-09-30T12:00:00.800Z",
      handed: null,
      written: null,
      dropped: "phantom phrase",
    })]);
    await Bun.sleep(20);
    expect(loadConversation(ctx.configDir)).toEqual([]);
    expect(world.calls.filter((c) => c.includes("chat/completions"))).toEqual([]);
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
    expect(timings(ctx.configDir)).toMatchObject([{ utterance: 3, written: "2026-09-30T12:00:00.000Z", nudged: "2026-09-30T12:00:00.000Z", said: null, played: null, slowest: "ended" }]);
  });
});
