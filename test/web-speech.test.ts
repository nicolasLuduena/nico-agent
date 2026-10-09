import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const SPEAK = { url: "http://127.0.0.1:8880/v1", model: "kokoro", voice: "af_heart" };
const SPEECH = "http://127.0.0.1:8880/v1/audio/speech";

function writeConfig(configDir: string, voice: unknown) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ repos: [], voice }));
}

/** Speech in config, Voice on, and the app's socket open, as a page with Voice on keeps it. */
async function speaking({ voice = { speak: SPEAK }, on = true } = {}) {
  const ctx = setup();
  writeConfig(ctx.configDir, voice);
  if (on) await ctx.cli("voice", "on");
  const talk = await ctx.socket("/api/voice");
  if ("refused" in talk) throw new Error("refused");
  return { ...ctx, talk };
}

/** A speech service streaming each request's audio as `chunks`, keeping the bodies it was sent. */
function speech(world: ReturnType<typeof setup>["world"], chunks: Uint8Array[] = [new Uint8Array([1, 0, 2, 0]), new Uint8Array([3, 0])]) {
  const sent: any[] = [];
  world.endpoint(SPEECH, async (request) => {
    sent.push(await request.json());
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(chunk);
        c.close();
      },
    });
    return new Response(body, { headers: { "content-type": "audio/pcm" } });
  });
  return sent;
}

/** The Lead says `text`, and serve looks at the conversation, as it does after each tool call and tick. */
async function leadSays(ctx: Awaited<ReturnType<typeof speaking>>, text: string) {
  await ctx.cli("lead", "say", text);
  await ctx.look();
}

describe("the Lead speaks", () => {
  test("Voice on: a lead entry is one speech request, its audio streamed to the app between start and end", async () => {
    const ctx = await speaking();
    const sent = speech(ctx.world);

    await leadSays(ctx, "Two Specs are running.");

    expect(await ctx.talk.next()).toEqual({ type: "speech", entry: 1, rate: 24_000 });
    const audio: number[] = [];
    for (let message = await ctx.talk.next(); message instanceof Uint8Array; message = await ctx.talk.next()) audio.push(...message);
    expect(audio).toEqual([1, 0, 2, 0, 3, 0]);
    expect(ctx.talk.received.at(-1)).toEqual({ type: "speech-end", entry: 1 });
    expect(sent).toEqual([{ model: "kokoro", input: "Two Specs are running.", voice: "af_heart", response_format: "pcm" }]);
  });

  test("Voice off: no speech request, nothing on the socket", async () => {
    const ctx = await speaking({ on: false });
    const sent = speech(ctx.world);

    await leadSays(ctx, "Two Specs are running.");

    expect(await ctx.talk.next(50)).toBeNull();
    expect(sent).toEqual([]);
  });

  test("only what the Lead writes is spoken, never the user's messages or what was written before the page listened", async () => {
    const ctx = setup();
    await ctx.cli("lead", "say", "Said before.");
    writeConfig(ctx.configDir, { speak: SPEAK });
    await ctx.cli("voice", "on");
    const talk = await ctx.socket("/api/voice");
    if ("refused" in talk) throw new Error("refused");
    const sent = speech(ctx.world);

    await ctx.cli("say", "What is running?");
    await ctx.look();
    await ctx.cli("lead", "say", "Nothing yet.");
    await ctx.look();

    expect(await talk.next()).toEqual({ type: "speech", entry: 3, rate: 24_000 });
    expect(sent.map((s) => s.input)).toEqual(["Nothing yet."]);
  });

  test("a question is read with its choices as a numbered list", async () => {
    const ctx = await speaking();
    const sent = speech(ctx.world);

    await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search.", "Dark mode");
    await ctx.look();

    expect(await ctx.talk.next()).toEqual({ type: "speech", entry: 1, rate: 24_000 });
    expect(sent.map((s) => s.input)).toEqual(["Which Spec first? 1. Billing. 2. Search. 3. Dark mode."]);
  });

  test("entries are spoken one after another, in order", async () => {
    const ctx = await speaking();
    const sent = speech(ctx.world);

    await ctx.cli("lead", "say", "One.");
    await ctx.cli("lead", "say", "Two.");
    await ctx.look();

    const starts: unknown[] = [];
    for (let message = await ctx.talk.next(); message; message = await ctx.talk.next(50)) {
      if (!(message instanceof Uint8Array)) starts.push(message);
    }
    expect(starts).toEqual([
      { type: "speech", entry: 1, rate: 24_000 }, { type: "speech-end", entry: 1 },
      { type: "speech", entry: 2, rate: 24_000 }, { type: "speech-end", entry: 2 },
    ]);
    expect(sent.map((s) => s.input)).toEqual(["One.", "Two."]);
  });

  test("hush (the user spoke or tapped) stops the speech now and drops what waits to be spoken", async () => {
    const ctx = await speaking();
    const sent: string[] = [];
    let cancelled = false;
    ctx.world.endpoint(SPEECH, async (request) => {
      sent.push((await request.json()).input);
      // A long answer: one chunk now, the rest never.
      const body = new ReadableStream<Uint8Array>({
        start: (c) => c.enqueue(new Uint8Array([1, 0])),
        cancel: () => { cancelled = true; },
      });
      return new Response(body, { headers: { "content-type": "audio/pcm" } });
    });

    await ctx.cli("lead", "say", "A long answer.");
    await ctx.cli("lead", "say", "And more.");
    await ctx.look();
    expect(await ctx.talk.next()).toEqual({ type: "speech", entry: 1, rate: 24_000 });
    expect(await ctx.talk.next()).toEqual(new Uint8Array([1, 0]));

    ctx.talk.json({ type: "hush" });

    expect(await ctx.talk.next()).toEqual({ type: "speech-end", entry: 1 });
    expect(await ctx.talk.next(50)).toBeNull();
    expect(cancelled).toBe(true);
    expect(sent).toEqual(["A long answer."]);
  });

  test("a hush while the next entry's speech is being made stops it too", async () => {
    const ctx = await speaking();
    const sent: string[] = [];
    let answer = () => {};
    ctx.world.endpoint(SPEECH, async (request) => {
      sent.push((await request.json()).input);
      // The service takes a while to start answering.
      await new Promise<void>((resolve) => { answer = resolve; });
      return new Response(new Uint8Array([1, 0]), { headers: { "content-type": "audio/pcm" } });
    });

    await leadSays(ctx, "Two Specs are running.");
    for (; sent.length === 0;) await Bun.sleep(1);
    ctx.talk.json({ type: "hush" });
    answer();

    expect(await ctx.talk.next(50)).toBeNull();
  });

  test("a hush ends the speech for every page listening, so none waits on it", async () => {
    const ctx = await speaking();
    const other = await ctx.socket("/api/voice");
    if ("refused" in other) throw new Error("refused");
    ctx.world.endpoint(SPEECH, () => new Response(new ReadableStream({ start: (c) => c.enqueue(new Uint8Array([1, 0])) }), { headers: { "content-type": "audio/pcm" } }));

    await leadSays(ctx, "A long answer.");
    expect([await other.next(), await other.next()]).toEqual([{ type: "speech", entry: 1, rate: 24_000 }, new Uint8Array([1, 0])]);
    ctx.talk.json({ type: "hush" });

    expect(await other.next()).toEqual({ type: "speech-end", entry: 1 });
  });

  test("a chunk split inside a sample is sent whole samples only, the odd byte joining the next", async () => {
    const ctx = await speaking();
    speech(ctx.world, [new Uint8Array([1, 0, 2]), new Uint8Array([0, 3, 0])]);

    await leadSays(ctx, "Hello.");

    await ctx.talk.next();
    expect([await ctx.talk.next(), await ctx.talk.next()]).toEqual([new Uint8Array([1, 0]), new Uint8Array([2, 0, 3, 0])]);
  });

  test("speech down: the reply still shows, with a warning on the socket saying what to do", async () => {
    const ctx = await speaking();

    await leadSays(ctx, "Two Specs are running.");

    expect(await ctx.talk.next()).toEqual({
      type: "speech-error",
      entry: 1,
      error: `could not reach ${SPEECH}: connection refused`,
      help: ["Start the speak service (see docs/voice.md) or fix voice.speak.url; the Lead's replies still show in the panel"],
    });
    expect(JSON.parse((await ctx.web("/api/lead/log")).body).entries).toMatchObject([{ type: "lead", text: "Two Specs are running." }]);
  });

  test("without a speech service in config, says where to set one up", async () => {
    const ctx = await speaking({ voice: {} as never });

    await leadSays(ctx, "Two Specs are running.");

    expect(await ctx.talk.next()).toEqual({
      type: "speech-error",
      entry: 1,
      error: "no speech service is configured",
      help: ["Add voice.speak to config.json (see docs/voice.md); the Lead's replies still show in the panel"],
    });
  });

  test("a page that closed its socket hears nothing, and no speech is made for no one", async () => {
    const ctx = await speaking();
    const sent = speech(ctx.world);
    ctx.talk.close();

    await leadSays(ctx, "Two Specs are running.");

    expect(await ctx.talk.next(50)).toBeNull();
    expect(sent).toEqual([]);
  });
});
