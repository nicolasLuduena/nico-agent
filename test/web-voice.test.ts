import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const TRANSCRIBE = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
const ENDPOINT = "http://127.0.0.1:8010/v1/audio/transcriptions";

/** A second of 16kHz mono 16-bit PCM, as the app streams it. */
const SECOND = 32_000;

/** `seconds` of PCM, a tone so it is not all zeros. */
function pcm(seconds: number) {
  const samples = new Int16Array(Math.round((seconds * SECOND) / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(8000 * Math.sin(i / 10));
  return new Uint8Array(samples.buffer);
}

/** A Repo with a glossary and a Ready issue, and a transcription service in config. */
async function withVoice(voice: unknown = { transcribe: TRANSCRIBE }) {
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

/** Answer transcriptions with how much audio each one carried, keeping the forms sent. */
function transcriber(world: ReturnType<typeof setup>["world"]) {
  const sent: FormData[] = [];
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
    // Only a message can be spoken, for now; an answer is typed or picked.
    const ask = await ctx.cli("lead", "ask", "Which first?");
    expect(ask.exitCode).toBe(0);
    expect((await post(["--answer", "2", "--raw", "billing", "--", "billing"])).status).toBe(400);
  });

  test("another site's page cannot open it", async () => {
    const ctx = await withVoice();
    const talk = await ctx.socket("/api/voice", { "sec-fetch-site": "cross-site" });
    expect(talk).toMatchObject({ refused: { status: 403 } });
  });
});
