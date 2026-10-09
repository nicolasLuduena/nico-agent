import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { sayArgs } from "../src/app/lead";
import fixtures from "./fixtures/scribe/utterances.json";
import { setup } from "./harness";

const TRANSCRIBE = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
const ENDPOINT = "http://127.0.0.1:8010/v1/audio/transcriptions";
const SCRIBE = { url: "http://127.0.0.1:11434/v1", model: "qwen2.5:3b" };
const CHAT = "http://127.0.0.1:11434/v1/chat/completions";

/** A second of 16kHz mono 16-bit PCM, as the app streams it. */
const SECOND = 32_000;

/** `seconds` of PCM, a tone so it is not all zeros. */
function pcm(seconds: number) {
  const samples = new Int16Array(Math.round((seconds * SECOND) / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(8000 * Math.sin(i / 10));
  return new Uint8Array(samples.buffer);
}

/** A Repo with a glossary and a Ready issue, and transcription and the Scribe in config. */
async function withVoice(voice: unknown = { transcribe: TRANSCRIBE, scribe: SCRIBE }) {
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

/** Answer transcriptions with how much audio each one carried, keeping the forms sent; the Scribe hands the text back as it is. */
function transcriber(world: ReturnType<typeof setup>["world"]) {
  const sent: FormData[] = [];
  world.endpoint(CHAT, async (request) => {
    const { messages } = await request.json() as { messages: { content: string }[] };
    return Response.json({ choices: [{ message: { role: "assistant", content: messages.at(-1)!.content.replace(/^Transcript: /, "") } }] });
  });
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

    expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "heard 0.5s", raw: "heard 0.5s" });
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
    expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "heard 2.25s", raw: "heard 2.25s" });
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

    expect(await talk.next()).toEqual({ type: "final", utterance: 2, text: "heard 0.25s", raw: "heard 0.25s" });
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
    expect(answers).toContainEqual({ type: "final", utterance: 1, text: "heard 0.5s", raw: "heard 0.5s" });
    expect(answers).toContainEqual({ type: "final", utterance: 2, text: "heard 0.25s", raw: "heard 0.25s" });
  });

  test("finals arrive in the order spoken, even when a later utterance is cleaned first", async () => {
    const ctx = await withVoice();
    transcriber(ctx.world);
    // The Scribe takes longer over the first, longer utterance.
    ctx.world.endpoint(CHAT, async (request) => {
      const { messages } = await request.json() as { messages: { content: string }[] };
      const heard = messages.at(-1)!.content.replace(/^Transcript: /, "");
      if (heard === "heard 0.5s") await Bun.sleep(80);
      return Response.json({ choices: [{ message: { role: "assistant", content: heard } }] });
    });
    const talk = await open(ctx);

    talk.json({ type: "start", utterance: 1 });
    talk.send(pcm(0.5));
    talk.json({ type: "end" });
    talk.json({ type: "start", utterance: 2 });
    talk.send(pcm(0.25));
    talk.json({ type: "end" });

    expect([await talk.next(), await talk.next()]).toMatchObject([{ utterance: 1 }, { utterance: 2 }]);
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

  describe("the Scribe", () => {
    /** Transcription that hears `raw`, keeping nothing. */
    function hears(world: ReturnType<typeof setup>["world"], raw: string) {
      world.endpoint(ENDPOINT, () => Response.json({ text: ` ${raw}` }));
    }

    /** A Scribe answering `cleaned`, keeping the bodies it was sent. */
    function scribe(world: ReturnType<typeof setup>["world"], cleaned: string) {
      const sent: any[] = [];
      world.endpoint(CHAT, async (request) => {
        sent.push(await request.json());
        return Response.json({ choices: [{ message: { role: "assistant", content: `${cleaned}\n` } }] });
      });
      return sent;
    }

    test("the final transcript is cleaned, primed with the vocabulary and the last entries, and keeps what was heard", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, scribe: SCRIBE });
      await ctx.cli("say", "What is running?");
      await ctx.cli("lead", "say", "Nothing yet; acme/api#7 is Ready.");
      hears(ctx.world, "um dispatch the uh acme api seven");
      const sent = scribe(ctx.world, "Dispatch acme/api#7.");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "Dispatch acme/api#7.", raw: "um dispatch the uh acme api seven" });
      expect(sent).toHaveLength(1);
      expect(sent[0].model).toBe(SCRIBE.model);
      const prompt = sent[0].messages.map((m: { content: string }) => m.content).join("\n");
      for (const term of ["acme/api#7", "Add retries to the herdr client", "Stackable", "claude"]) expect(prompt).toContain(term);
      expect(prompt).toContain("What is running?");
      expect(prompt).toContain("Nothing yet; acme/api#7 is Ready.");
      expect(sent[0].messages.at(-1)).toEqual({ role: "user", content: "Transcript: um dispatch the uh acme api seven" });
    });

    test("each recorded utterance's raw transcript becomes a cleaned user entry that keeps the raw", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, scribe: SCRIBE });
      const talk = await open(ctx);

      for (const [i, { raw, cleaned }] of fixtures.utterances.entries()) {
        hears(ctx.world, raw);
        const sent = scribe(ctx.world, cleaned);
        talk.json({ type: "start", utterance: i + 1 });
        talk.send(pcm(0.5));
        talk.json({ type: "end" });
        const final = await talk.next();
        expect(final).toEqual({ type: "final", utterance: i + 1, text: cleaned, raw });
        expect(sent[0].messages.at(-1).content).toBe(`Transcript: ${raw}`);
        const said = await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs(final.text, undefined, final.raw) }) });
        expect(said.status).toBe(200);
      }

      const entries = (await ctx.cli("lead", "log", "--json")).json().entries;
      expect(entries.map(({ text, raw }: { text: string; raw: string }) => ({ text, raw }))).toEqual(fixtures.utterances.map(({ raw, cleaned }) => ({ text: cleaned, raw })));
      // "No, I said …" in the set corrects the message before it.
      expect(entries.filter((e: { supersedes?: number }) => e.supersedes).map((e: { id: number; supersedes: number }) => [e.id, e.supersedes])).toEqual([[5, 4], [20, 19]]);
    });

    test("Scribe down: what was heard is sent as it is, with a warning, so the conversation never stalls", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, scribe: SCRIBE });
      hears(ctx.world, "dispatch acme api seven");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toEqual({
        type: "final",
        utterance: 1,
        text: "dispatch acme api seven",
        raw: "dispatch acme api seven",
        warning: {
          error: `could not reach ${CHAT}: connection refused`,
          help: ["Sent as heard. Start the scribe service (see docs/voice.md) or fix voice.scribe.url"],
        },
      });
    });

    test("an empty answer from the Scribe never drops what was said", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, scribe: SCRIBE });
      hears(ctx.world, "dispatch acme api seven");
      scribe(ctx.world, "  ");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toMatchObject({ type: "final", text: "dispatch acme api seven", warning: { error: "answered with an empty message", help: ["Sent as heard. Check voice.scribe.url and voice.scribe.model"] } });
    });

    test("a Scribe that answers the message instead of cleaning it is not taken at its word", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, scribe: SCRIBE });
      hears(ctx.world, "what's uh what's on the board right now");
      scribe(ctx.world, "acme/api#7 Add retries to the herdr client; acme/web#9 Fix the login redirect; BLE-42 Export invoices as CSV.");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toMatchObject({
        type: "final",
        text: "what's uh what's on the board right now",
        warning: { error: "the Scribe answered far more than was said", help: ["Sent as heard. Check voice.scribe.model, or try a larger one"] },
      });
    });

    test("without a Scribe in config, what was heard is sent with a warning saying where to set one up", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE });
      hears(ctx.world, "dispatch acme api seven");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toEqual({
        type: "final",
        utterance: 1,
        text: "dispatch acme api seven",
        raw: "dispatch acme api seven",
        warning: { error: "no Scribe is configured", help: ["Sent as heard. Add voice.scribe to config.json (see docs/voice.md)"] },
      });
    });

    describe("a spoken answer to the Lead's question", () => {
      /** A Scribe that cleans to `cleaned`, and picks `choice` when asked which choice an answer picks; keeping the choice requests. */
      function chooser(world: ReturnType<typeof setup>["world"], cleaned: string, choice: string) {
        const asked: any[] = [];
        world.endpoint(CHAT, async (request) => {
          const body = await request.json() as { messages: { content: string }[] };
          const picking = body.messages[0]!.content.includes("numbered choices");
          if (picking) asked.push(body);
          return Response.json({ choices: [{ message: { role: "assistant", content: picking ? choice : cleaned } }] });
        });
        return asked;
      }

      async function say(ctx: Awaited<ReturnType<typeof withVoice>>, raw: string) {
        hears(ctx.world, raw);
        const talk = await open(ctx);
        talk.json({ type: "start", utterance: 1 });
        talk.send(pcm(0.5));
        talk.json({ type: "end" });
        return await talk.next();
      }

      /** Post `final` as the app does: an answer to the question it names, else a message. */
      const post = (ctx: Awaited<ReturnType<typeof withVoice>>, final: { text: string; raw: string; answers?: number }) =>
        ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args: sayArgs(final.text, final.answers, final.raw) }) });

      test("\"the second one\" to a question with three choices records the second choice", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search", "Dark mode");
        const asked = chooser(ctx.world, "The second one.", "2");

        const final = await say(ctx, "the second one");

        expect(final).toEqual({ type: "final", utterance: 1, text: "Search", raw: "the second one", answers: 1 });
        const prompt = asked[0].messages.map((m: { content: string }) => m.content).join("\n");
        for (const line of ["Which Spec first?", "1. Billing", "2. Search", "3. Dark mode", "The second one."]) expect(prompt).toContain(line);
        expect((await post(ctx, final)).status).toBe(200);
        expect((await ctx.cli("lead", "inbox", "--json")).json().entries).toEqual([
          { id: 2, at: expect.any(String), type: "answer", question: 1, text: "Search", raw: "the second one", asked: "Which Spec first?" },
        ]);
      });

      test("an answer that picks no choice clearly is recorded as said", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search", "Dark mode");
        chooser(ctx.world, "Neither, finish the login fix first.", "0");

        const final = await say(ctx, "neither uh finish the login fix first");

        expect(final).toEqual({ type: "final", utterance: 1, text: "Neither, finish the login fix first.", raw: "neither uh finish the login fix first", answers: 1 });
        expect((await post(ctx, final)).status).toBe(200);
        expect((await ctx.cli("lead", "log", "--json")).json().entries.at(-1)).toMatchObject({ type: "answer", question: 1, text: "Neither, finish the login fix first." });
      });

      test("a question without choices takes what was said as its answer, with no choice to pick", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Why the rush?");
        const asked = chooser(ctx.world, "The demo is on Friday.", "1");

        expect(await say(ctx, "the demo is on friday")).toMatchObject({ text: "The demo is on Friday.", answers: 1 });
        expect(asked).toHaveLength(0);
      });

      test("\"No, I said …\" right after the question corrects the last message, never answers it", async () => {
        const ctx = await withVoice();
        await ctx.cli("say", "Dispatch acme/api#7.");
        await ctx.cli("lead", "ask", "Which Harness?", "claude", "codex");
        chooser(ctx.world, "No, I said acme/api#8.", "0");

        expect(await say(ctx, "no i said acme api eight")).toEqual({ type: "final", utterance: 1, text: "No, I said acme/api#8.", raw: "no i said acme api eight" });
      });

      test("once something was said after the question, speech is a message again", async () => {
        const ctx = await withVoice();
        await ctx.cli("lead", "ask", "Which Spec first?", "Billing", "Search");
        await ctx.cli("say", "Let me think.");
        const asked = chooser(ctx.world, "The second one.", "2");

        const final = await say(ctx, "the second one");

        expect(final).toEqual({ type: "final", utterance: 1, text: "The second one.", raw: "the second one" });
        expect(asked).toHaveLength(0);
      });
    });

    test("nothing heard is never sent to the Scribe", async () => {
      const ctx = await withVoice({ transcribe: TRANSCRIBE, scribe: SCRIBE });
      hears(ctx.world, "");
      const sent = scribe(ctx.world, "Something.");
      const talk = await open(ctx);

      talk.json({ type: "start", utterance: 1 });
      talk.send(pcm(0.5));
      talk.json({ type: "end" });

      expect(await talk.next()).toEqual({ type: "final", utterance: 1, text: "", raw: "" });
      expect(sent).toHaveLength(0);
    });
  });

  test("another site's page cannot open it", async () => {
    const ctx = await withVoice();
    const talk = await ctx.socket("/api/voice", { "sec-fetch-site": "cross-site" });
    expect(talk).toMatchObject({ refused: { status: 403 } });
  });
});
