import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { sayArgs } from "../src/app/lead";
import { ASKING_THE_LEAD } from "../src/front-voice";
import fixtures from "./fixtures/scribe/utterances.json";
import { setup } from "./harness";

const TRANSCRIBE = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
const ENDPOINT = "http://127.0.0.1:8010/v1/audio/transcriptions";
const FRONT = { url: "http://127.0.0.1:4100/v1", model: "glm-5.3-flash" };
const CHAT = "http://127.0.0.1:4100/v1/chat/completions";
const SPEAK = { url: "http://127.0.0.1:8880/v1", model: "kokoro" };
const SPEECH = "http://127.0.0.1:8880/v1/audio/speech";

/** A second of 16kHz mono 16-bit PCM, as the app streams it. */
const SECOND = 32_000;

/** `seconds` of PCM, a tone so it is not all zeros. */
function pcm(seconds: number) {
  const samples = new Int16Array(Math.round((seconds * SECOND) / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(8000 * Math.sin(i / 10));
  return new Uint8Array(samples.buffer);
}

/** A Repo with a glossary and a Ready issue, and transcription and the Front voice in config. */
async function withVoice(voice: unknown = { transcribe: TRANSCRIBE, front: FRONT }) {
  const ctx = setup();
  const repo = mkdtempSync(join(tmpdir(), "nico-agent-repo-"));
  writeFileSync(join(repo, "GLOSSARY.md"), "# acme\n\n## Language\n\n**Stackable**:\nAn issue that waits on a PR.\n_Avoid_: Blocked\n\n**Held**:\nA Dispatch paused by the user.\n");
  ctx.world.addClone(repo, "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", repo);
  ctx.world.addIssue("acme/api", { number: 7, title: "Add retries to the herdr client" });
  const file = join(ctx.configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), voice }));
  return ctx;
}

/** What a fake Front voice streams back: sentences in pieces, then maybe a hand-off. */
interface Reply {
  say?: string[];
  handOff?: { message: string; choice?: number };
}

/** `reply` as an OpenAI-compatible stream's events, the hand-off's arguments in two pieces; `done` ends it. */
function events({ say = [], handOff }: Reply, done = true) {
  const delta = (d: unknown) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d, finish_reason: null }] })}\n\n`;
  const args = handOff && JSON.stringify(handOff);
  return [
    ...say.map((content) => delta({ content })),
    ...(args ? [
      delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "hand_off", arguments: args.slice(0, 5) } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }),
    ] : []),
    ...(done ? [`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: args ? "tool_calls" : "stop" }] })}\n\n`, "data: [DONE]\n\n"] : []),
  ].join("");
}

/** A Front voice streaming `reply(body)` for each request to `url`, keeping the bodies; `seen` gets each request. */
function talker(world: ReturnType<typeof setup>["world"], reply: (body: any) => Reply, seen?: (request: Request) => void, url = CHAT) {
  const sent: any[] = [];
  world.endpoint(url, async (request) => {
    seen?.(request.clone());
    const body = await request.json();
    sent.push(body);
    return new Response(events(reply(body)), { headers: { "content-type": "text/event-stream" } });
  });
  return sent;
}

/** The conversation, as `lead log --json` prints it. */
async function log(ctx: ReturnType<typeof setup>): Promise<any[]> {
  return (await ctx.cli("lead", "log", "--json")).json().entries;
}

/** Wait until `check` holds, as the Front voice answers in the background; fail after a second. */
async function until(check: () => boolean | Promise<boolean>) {
  for (const end = Date.now() + 1000; Date.now() < end; await Bun.sleep(2)) if (await check()) return;
  throw new Error("timed out waiting");
}

/** Answer transcriptions with how much audio each one carried, keeping the forms sent; the Front voice hands the text off as it is. */
function transcriber(world: ReturnType<typeof setup>["world"]) {
  const sent: FormData[] = [];
  talker(world, (body) => ({ handOff: { message: body.messages.at(-1).content } }));
  world.endpoint(ENDPOINT, async (request) => {
    const form = await request.formData();
    sent.push(form);
    const wav = await (form.get("file") as File).arrayBuffer();
    return Response.json({ text: ` heard ${(wav.byteLength - 44) / SECOND}s` });
  });
  return sent;
}

async function open(ctx: Awaited<ReturnType<typeof withVoice>>) {
  const talk = await ctx.socket("/api/voice");
  if ("refused" in talk) throw new Error(`refused: ${talk.refused!.body}`);
  return talk;
}

describe("/api/voice", () => {
  test("an utterance is transcribed with the Board, the Harnesses and the Repo's glossary as the prompt", async () => {
    const ctx = await withVoice();
    const sent = transcriber(ctx.world);
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "end" });

    expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "heard 0.5s" });
    expect(sent).toHaveLength(1);
    const prompt = String(sent[0]!.get("prompt"));
    for (const term of ["acme/api#7", "Add retries to the herdr client", "Stackable", "Held", "claude", "codex", "acme/api"]) {
      expect(prompt).toContain(term);
    }
    // The glossary's definitions and avoided words are not vocabulary.
    expect(prompt).not.toContain("Blocked");
    expect(sent[0]!.get("model")).toBe(TRANSCRIBE.model);
    const wav = new Uint8Array(await (sent[0]!.get("file") as File).arrayBuffer());
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(wav.slice(44)).toEqual(pcm(0.5));
  });

  test("sends an interim transcript of what was heard so far while the user speaks", async () => {
    const ctx = await withVoice();
    transcriber(ctx.world);
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    expect(await talk.next(50)).toBeNull();
    talk.send(pcm(0.5));
    expect(await talk.next()).toEqual({ type: "interim", utterance: 1, text: "heard 1s" });
    talk.send(pcm(1));
    expect(await talk.next()).toEqual({ type: "interim", utterance: 1, text: "heard 2s" });
    talk.send(pcm(0.25));
    talk.json({ type: "end" });
    expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "heard 2.25s" });
  });

  test("each utterance starts afresh on the same socket, and a cancelled one is never transcribed", async () => {
    const ctx = await withVoice();
    const sent = transcriber(ctx.world);
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "cancel" });
    talk.json({ type: "start", utterance: 2 });
    talk.send(pcm(0.25));
    talk.json({ type: "end" });

    expect(await talk.next()).toEqual({ type: "final", utterance: 2, text: "heard 0.25s" });
    expect(sent).toHaveLength(1);
  });

  test("the next utterance may start while the last is transcribed; each answer names its own", async () => {
    const ctx = await withVoice();
    transcriber(ctx.world);
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "end" });
    talk.json({ type: "start", utterance: 2 });
    talk.send(pcm(0.25));
    talk.json({ type: "end" });

    const answers = [await talk.next(), await talk.next()];
    expect(answers).toContainEqual({ type: "final", utterance: 1, text: "heard 0.5s" });
    expect(answers).toContainEqual({ type: "final", utterance: 2, text: "heard 0.25s" });
  });

  test("the Front voice hears each final in the order spoken, after the one before it is answered", async () => {
    const ctx = await withVoice();
    transcriber(ctx.world);
    // The Front voice takes longer over the first, longer utterance.
    const answered: string[] = [];
    ctx.world.endpoint(CHAT, async (request) => {
      const heard = ((await request.json()) as { messages: { content: string }[] }).messages.at(-1)!.content;
      if (heard === "heard 0.5s") await Bun.sleep(80);
      answered.push(heard);
      return new Response(events({ handOff: { message: heard } }), { headers: { "content-type": "text/event-stream" } });
    });
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "end" });
    talk.json({ type: "start", utterance: 2 });
    talk.send(pcm(0.25));
    talk.json({ type: "end" });

    expect([await talk.next(), await talk.next()]).toMatchObject([{ utterance: 1 }, { utterance: 2 }]);
    await until(() => answered.length === 2);
    await until(async () => (await log(ctx)).length === 4);
    expect((await log(ctx)).map((e) => e.text)).toEqual(["heard 0.5s", ASKING_THE_LEAD, "heard 0.25s", ASKING_THE_LEAD]);
  });

  test("transcription down: a warning with what to do, and typing still reaches the Lead", async () => {
    const ctx = await withVoice();
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "end" });

    expect(await talk.next()).toEqual({
      type: "error",
      utterance: 1,
      error: `could not reach ${ENDPOINT}: connection refused`,
      help: ["Start the transcribe service (see docs/voice.md) or fix voice.transcribe.url; typing still works"],
    });
    const said = await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: ["--", "Dispatch acme/api#7"] }) });
    expect(said.status).toBe(200);
  });

  test("transcription failing while the user speaks warns at once and drops the utterance", async () => {
    const ctx = await withVoice();
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(1));

    expect(await talk.next()).toMatchObject({ type: "error", utterance: 1, error: `could not reach ${ENDPOINT}: connection refused` });
    talk.send(pcm(1));
    talk.json({ type: "end" });
    expect(await talk.next(50)).toBeNull();
  });

  test("an error answer from the service is the warning, in the service's words", async () => {
    const ctx = await withVoice();
    ctx.world.endpoint(ENDPOINT, () => Response.json({ error: { message: "model not found" } }, { status: 404 }));
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "end" });

    expect(await talk.next()).toMatchObject({ type: "error", utterance: 1, error: "answered 404: model not found" });
  });

  test("without a transcription service in config, says where to set one up", async () => {
    const ctx = await withVoice({ speak: { url: "http://127.0.0.1:8880/v1", model: "kokoro" } });
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });

    expect(await talk.next()).toEqual({
      type: "error",
      utterance: 1,
      error: "no transcription service is configured",
      help: ["Add voice.transcribe to config.json (see docs/voice.md); typing still works"],
    });
  });

  test("the final transcript, posted as the app does, is a user entry that keeps the raw text", async () => {
    const ctx = await withVoice();
    const post = (args: string[]) => ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args }) });

    const said = await post(["--raw", "dispatch acme api 7", "--", "dispatch acme api 7"]);

    expect(said.status).toBe(200);
    expect(JSON.parse((await ctx.web("/api/lead/log")).body).entries).toMatchObject([
      { id: 1, who: "user", type: "user", text: "dispatch acme api 7", raw: "dispatch acme api 7" },
    ]);
    expect((await ctx.cli("lead", "inbox", "--json")).json().entries).toMatchObject([{ type: "user", raw: "dispatch acme api 7" }]);
  });

  describe("the Front voice", () => {
    /** Transcription that hears `raw`, keeping nothing. */
    function hears(world: ReturnType<typeof setup>["world"], raw: string) {
      world.endpoint(ENDPOINT, () => Response.json({ text: ` ${raw}` }));
    }

    /** Say `raw` on a fresh socket, as one utterance; the socket, its final transcript already read. */
    async function say(ctx: Awaited<ReturnType<typeof withVoice>>, raw: string) {
      hears(ctx.world, raw);
      const talk = await open(ctx);
      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });
      expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: raw });
      return talk;
    }

    /** Speech in config and Voice on, keeping each line read aloud. */
    async function speaking(ctx: Awaited<ReturnType<typeof withVoice>>) {
      const spoken: string[] = [];
      ctx.world.endpoint(SPEECH, async (request) => {
        spoken.push(((await request.json()) as { input: string }).input);
        return new Response(new Uint8Array([1, 0]), { headers: { "content-type": "audio/pcm" } });
      });
      await ctx.cli("voice", "on");
      return spoken;
    }

    const VOICED = { transcribe: TRANSCRIBE, speak: SPEAK, front: FRONT };

    test("small talk is answered by the Front voice, sentence by sentence aloud, under its own name, and never reaches the Lead", async () => {
      const ctx = await withVoice(VOICED);
      const spoken = await speaking(ctx);
      talker(ctx.world, () => ({ say: ["Hi there", ". The Lead is ", "busy with acme/api#7.", " Anything else?"] }));

      const talk = await say(ctx, "hey how's it going");

      await until(async () => (await log(ctx)).length === 1);
      expect(await log(ctx)).toMatchObject([{ id: 1, who: "front-voice", type: "front-voice", text: "Hi there. The Lead is busy with acme/api#7. Anything else?", heard: "hey how's it going" }]);
      await until(() => spoken.length === 3);
      expect(spoken).toEqual(["Hi there.", "The Lead is busy with acme/api#7.", "Anything else?"]);
      // Its speech names no entry: the page never times it as the Lead's.
      expect(talk.received).toContainEqual({ type: "speech", rate: 24_000 });
      expect((await ctx.cli("lead", "inbox", "--json")).json().entries).toEqual([]);
    });

    test("anything that needs the Lead is handed off as the user's cleaned message, keeping what was heard, and the Front voice says it will ask", async () => {
      const ctx = await withVoice(VOICED);
      const spoken = await speaking(ctx);
      talker(ctx.world, () => ({ handOff: { message: "Dispatch acme/api#7." } }));

      await say(ctx, "um dispatch the uh acme api seven");

      await until(async () => (await log(ctx)).length === 2);
      expect(await log(ctx)).toMatchObject([
        { id: 1, who: "user", type: "user", text: "Dispatch acme/api#7.", raw: "um dispatch the uh acme api seven" },
        { id: 2, who: "front-voice", type: "front-voice", text: ASKING_THE_LEAD },
      ]);
      expect((await log(ctx))[1].heard).toBeUndefined();
      await until(() => spoken.length === 1);
      expect(spoken).toEqual([ASKING_THE_LEAD]);
      // The Lead reads the user's message, and the Front voice's line only in its orient packet.
      const inbox = (await ctx.cli("lead", "inbox", "--json")).json();
      expect(inbox.entries).toMatchObject([{ id: 1, type: "user", text: "Dispatch acme/api#7." }]);
      expect(inbox.orient.last).toMatchObject([{ id: 1, who: "user" }, { id: 2, who: "front-voice", text: ASKING_THE_LEAD }]);
    });

    test("it is sent the raw transcript, what it reads, and hand_off as its only tool, streamed", async () => {
      const ctx = await withVoice();
      await ctx.cli("intent", "set", "--text", "Ship billing this week.");
      await ctx.cli("say", "What is running?");
      await ctx.cli("lead", "say", "Nothing yet; acme/api#7 is Ready.");
      const sent = talker(ctx.world, () => ({ say: ["Nothing is running."] }));

      await say(ctx, "um what's running");
      await until(() => sent.length === 1);

      const body = sent[0];
      expect(body.model).toBe(FRONT.model);
      expect(body.stream).toBe(true);
      expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["hand_off"]);
      expect(body.tools[0].function.parameters.required).toEqual(["message"]);
      expect(body.messages.at(-1)).toEqual({ role: "user", content: "um what's running" });
      const prompt = body.messages[0].content;
      for (const read of ["Stackable", "claude", "Ship billing this week.", "User: What is running?", "Lead: Nothing yet; acme/api#7 is Ready.", "Add retries to the herdr client"]) {
        expect(prompt).toContain(read);
      }
    });

    test("the key is read from the environment variable voice.front.keyEnv names", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, front: { ...FRONT, keyEnv: "ZEN_KEY" } });
      ctx.world.environment.set("ZEN_KEY", "sk-zen");
      const sent: Request[] = [];
      talker(ctx.world, () => ({ say: ["Hello."] }), (request) => sent.push(request));

      await say(ctx, "hello");

      await until(() => sent.length === 1);
      expect(sent[0]!.headers.get("authorization")).toBe("Bearer sk-zen");
    });

    test("without voice.front it runs on opencode go, its key from OPENCODE_API_KEY", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE });
      ctx.world.environment.set("OPENCODE_API_KEY", "sk-go");
      const sent: Request[] = [];
      talker(ctx.world, () => ({ say: ["Hello."] }), (request) => sent.push(request), "https://opencode.ai/zen/go/v1/chat/completions");

      await say(ctx, "hello");

      await until(() => sent.length === 1);
      expect(sent[0]!.headers.get("authorization")).toBe("Bearer sk-go");
      expect((await sent[0]!.json()).model).toBe("deepseek-v4.1-flash");
    });

    test("its key not set: what was heard goes to the Lead as it is, with a warning saying which variable", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE });

      const talk = await say(ctx, "dispatch acme api seven");

      expect(await talk.next()).toEqual({
        type: "warning",
        utterance: 1,
        error: "OPENCODE_API_KEY is not set",
        help: ["Sent to the Lead as heard. Set OPENCODE_API_KEY in the environment nico-agent runs in, or drop voice.front.keyEnv for a service that needs no key"],
      });
      await until(async () => (await log(ctx)).length === 1);
      expect(await log(ctx)).toMatchObject([{ who: "user", text: "dispatch acme api seven", raw: "dispatch acme api seven" }]);
    });

    test("Front voice down: what was heard goes to the Lead as it is, with a warning, so the conversation never stalls", async () => {
      const ctx = await withVoice();

      const talk = await say(ctx, "dispatch acme api seven");

      expect(await talk.next()).toEqual({
        type: "warning",
        utterance: 1,
        error: `could not reach ${CHAT}: connection refused`,
        help: ["Sent to the Lead as heard. Start the front service (see docs/voice.md) or fix voice.front.url"],
      });
      await until(async () => (await log(ctx)).length === 1);
      expect(await log(ctx)).toMatchObject([{ who: "user", text: "dispatch acme api seven", raw: "dispatch acme api seven" }]);
    });

    test("an empty reply never drops what was said", async () => {
      const ctx = await withVoice();
      talker(ctx.world, () => ({}));

      const talk = await say(ctx, "dispatch acme api seven");

      expect(await talk.next()).toMatchObject({ type: "warning", error: "the Front voice answered nothing" });
      await until(async () => (await log(ctx)).length === 1);
      expect(await log(ctx)).toMatchObject([{ who: "user", text: "dispatch acme api seven" }]);
    });

    test("nothing heard is never sent to it", async () => {
      const ctx = await withVoice();
      const sent = talker(ctx.world, () => ({ say: ["Something."] }));
      hears(ctx.world, "");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "" });
      expect(await talk.next(50)).toBeNull();
      expect(sent).toHaveLength(0);
    });

    test("each recorded utterance is handed off cleaned, keeping the raw, in the order said", async () => {
      const ctx = await withVoice();
      const cleaned = new Map(fixtures.utterances.map((u) => [u.raw, u.cleaned]));
      talker(ctx.world, (body) => ({ handOff: { message: cleaned.get(body.messages.at(-1).content)! } }));
      const talk = await open(ctx);

      for (const [i, { raw }] of fixtures.utterances.entries()) {
        hears(ctx.world, raw);
        talk.json({ type: "start", utterance: i + 1 });
        talk.send(pcm(0.5));
        talk.json({ type: "end" });
        expect(await talk.next()).toEqual({ type: "final", utterance: i + 1, text: raw });
        await until(async () => (await log(ctx)).filter((e) => e.type === "user").length === i + 1);
      }

      const entries = (await log(ctx)).filter((e) => e.type === "user");
      expect(entries.map(({ text, raw }) => ({ text, raw }))).toEqual(fixtures.utterances.map(({ raw, cleaned }) => ({ text: cleaned, raw })));
      // "No, I said …" in the set corrects the message before it.
      const id = (n: number) => entries[n - 1].id;
      expect(entries.filter((e) => e.supersedes).map((e) => [e.id, e.supersedes])).toEqual([[id(5), id(4)], [id(20), id(19)]]);
    });

    describe("talked over", () => {
      /**
       * A reply the test streams itself: `write` sends parts, `raw` events as
       * they are, `end` closes it.
       * Its request stopped, the stream fails, as fetch's does, and `stopped` says so.
       */
      function controlled(world: ReturnType<typeof setup>["world"]) {
        let stream!: ReadableStreamDefaultController<Uint8Array>;
        const reply = { stopped: false };
        world.endpoint(CHAT, (request) => {
          request.signal.addEventListener("abort", () => {
            reply.stopped = true;
            stream.error(new DOMException("The operation was aborted.", "AbortError"));
          });
          return new Response(new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } }), { headers: { "content-type": "text/event-stream" } });
        });
        const send = (text: string) => {
          if (!reply.stopped) stream.enqueue(new TextEncoder().encode(text));
        };
        return Object.assign(reply, {
          write: (parts: Reply) => send(events(parts, false)),
          raw: send,
          end: () => {
            send(events({}, true));
            if (!reply.stopped) stream.close();
          },
        });
      }

      test("its reply and speech stop, and what it said stays recorded", async () => {
        const ctx = await withVoice(VOICED);
        const spoken = await speaking(ctx);
        const reply = controlled(ctx.world);

        const talk = await say(ctx, "tell me about the board");
        await until(() => ctx.world.calls.some((c) => c === `http POST ${CHAT}`));
        reply.write({ say: ["Two issues are Ready. "] });
        await until(() => spoken.length === 1);
        talk.json({ type: "hush" });
        reply.write({ say: ["The first is the herdr client. The second is the login fix."] });
        reply.end();

        await until(async () => (await log(ctx)).length === 1);
        expect(await log(ctx)).toMatchObject([{ who: "front-voice", text: "Two issues are Ready.", heard: "tell me about the board" }]);
        expect(reply.stopped).toBe(true);
        await Bun.sleep(20);
        expect(spoken).toEqual(["Two issues are Ready."]);
      });

      test("the hand-off is made and said the moment its call is whole, before the reply ends", async () => {
        const ctx = await withVoice(VOICED);
        const spoken = await speaking(ctx);
        const reply = controlled(ctx.world);

        await say(ctx, "dispatch acme api seven");
        await until(() => ctx.world.calls.some((c) => c === `http POST ${CHAT}`));
        reply.write({ handOff: { message: "Dispatch acme/api#7." } });
        reply.raw(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);

        await until(() => spoken.length === 1);
        expect(spoken).toEqual([ASKING_THE_LEAD]);
        await until(async () => (await log(ctx)).some((e) => e.type === "user"));
        reply.end();
      });

      test("a hand-off it began is still made, and its words are not said", async () => {
        const ctx = await withVoice(VOICED);
        const spoken = await speaking(ctx);
        const reply = controlled(ctx.world);

        const talk = await say(ctx, "dispatch acme api seven");
        await until(() => ctx.world.calls.some((c) => c === `http POST ${CHAT}`));
        reply.write({ say: ["Sure. "] });
        await until(() => spoken.length === 1);
        // The hand-off's first piece is in when the user talks over it.
        const args = JSON.stringify({ message: "Dispatch acme/api#7." });
        const piece = (d: unknown) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d, finish_reason: null }] })}\n\n`;
        reply.raw(piece({ tool_calls: [{ index: 0, function: { name: "hand_off", arguments: args.slice(0, 5) } }] }));
        await Bun.sleep(10);
        talk.json({ type: "hush" });
        reply.raw(piece({ tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }));
        reply.end();
        expect(reply.stopped).toBe(false);

        await until(async () => (await log(ctx)).length === 2);
        expect(await log(ctx)).toMatchObject([
          { who: "user", text: "Dispatch acme/api#7.", raw: "dispatch acme api seven" },
          { who: "front-voice", text: "Sure." },
        ]);
        await Bun.sleep(20);
        expect(spoken).toEqual(["Sure."]);
      });
    });

    describe("a spoken answer to the Lead's question", () => {
      test("\"the second one\" to a question with three choices is matched to the second choice", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search", "Dark mode");
        const sent = talker(ctx.world, () => ({ handOff: { message: "The second one.", choice: 2 } }));

        await say(ctx, "the second one");

        await until(async () => (await log(ctx)).length === 3);
        const prompt = sent[0].messages[0].content;
        for (const line of ["Which Spec first?", "1. Billing", "2. Search", "3. Dark mode"]) expect(prompt).toContain(line);
        expect((await ctx.cli("lead", "inbox", "--json")).json().entries).toEqual([
          { id: 2, at: expect.any(String), type: "answer", question: 1, text: "Search", raw: "the second one", asked: "Which Spec first?" },
        ]);
      });

      test("an answer that picks no choice clearly is recorded as the Front voice cleaned it", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search", "Dark mode");
        talker(ctx.world, () => ({ handOff: { message: "Neither, finish the login fix first." } }));

        await say(ctx, "neither uh finish the login fix first");

        await until(async () => (await log(ctx)).length === 3);
        expect((await log(ctx))[1]).toMatchObject({ type: "answer", question: 1, text: "Neither, finish the login fix first.", raw: "neither uh finish the login fix first" });
      });

      test("asking the Front voice to read the choices again answers nothing, and the answer after it still answers the question", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Harness?", "claude", "codex");
        talker(ctx.world, () => ({ say: ["The choices are claude and codex."] }));
        await say(ctx, "what were the choices");
        await until(async () => (await log(ctx)).length === 2);
        talker(ctx.world, () => ({ handOff: { message: "Codex.", choice: 2 } }));

        await say(ctx, "codex");

        await until(async () => (await log(ctx)).length === 4);
        expect((await log(ctx)).slice(1, 3)).toMatchObject([
          { who: "front-voice", heard: "what were the choices" },
          { type: "answer", question: 1, text: "codex", raw: "codex" },
        ]);
      });

      test("\"No, I said …\" right after the question corrects the last message, never answers it", async () => {
        const ctx = await withVoice();
        await ctx.cli("say", "Dispatch acme/api#7.");
        await ctx.cli("lead", "ask", "Which Harness?", "claude", "codex");
        talker(ctx.world, () => ({ handOff: { message: "No, I said acme/api#8." } }));

        await say(ctx, "no i said acme api eight");

        await until(async () => (await log(ctx)).length === 4);
        expect((await log(ctx))[2]).toMatchObject({ type: "user", text: "No, I said acme/api#8.", supersedes: 1 });
      });

      test("once the user said something else after the question, a hand-off is a message again", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search");
        await ctx.cli("say", "Let me think.");
        talker(ctx.world, () => ({ handOff: { message: "The second one.", choice: 2 } }));

        await say(ctx, "the second one");

        await until(async () => (await log(ctx)).length === 4);
        expect((await log(ctx))[2]).toMatchObject({ type: "user", text: "The second one.", raw: "the second one" });
      });
    });
  });

  test("another site's page cannot open it", async () => {
    const ctx = await withVoice();
    const talk = await ctx.socket("/api/voice", { "sec-fetch-site": "cross-site" });
    expect(talk).toMatchObject({ refused: { status: 403 } });
  });
});
