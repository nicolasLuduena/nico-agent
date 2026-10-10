import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const TRANSCRIBE = { url: "http://127.0.0.1:8010/v1", model: "Systran/faster-whisper-small.en" };
const TRANSCRIPTIONS = "http://127.0.0.1:8010/v1/audio/transcriptions";
const FRONT = { url: "http://127.0.0.1:4100/v1", model: "glm-5.3-flash" };
const CHAT = "http://127.0.0.1:4100/v1/chat/completions";
const SPEAK = { url: "http://127.0.0.1:8880/v1", model: "kokoro" };
const SPEECH = "http://127.0.0.1:8880/v1/audio/speech";

type Ctx = ReturnType<typeof setup>;

/** Half a second of 16kHz mono 16-bit PCM, a tone so it is not all zeros. */
function speech() {
  const samples = new Int16Array(8000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(8000 * Math.sin(i / 10));
  return new Uint8Array(samples.buffer);
}

/** A Repo, transcription, speech and the Front voice in config, Voice on, and the tab's Partner started: a Review partner on its PR, as the merged `partner start` asks. */
async function withPartner(tab: "review" | "idea" = "review") {
  const ctx = setup();
  const repo = mkdtempSync(join(tmpdir(), "nico-agent-repo-"));
  ctx.world.addClone(repo, "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", repo);
  const file = join(ctx.configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), voice: { transcribe: TRANSCRIBE, speak: SPEAK, front: FRONT } }));
  if (tab === "review") ctx.world.addPr({ repo: "acme/api", number: 12, headBranch: "retries" });
  const target = tab === "review" ? ["--pr", "acme/api#12"] : ["--repo", "acme/api"];
  const started = await ctx.cli("partner", "start", tab, ...target, "--harness", "claude", "--model", "opus", "--effort", "high");
  expect(started.exitCode).toBe(0);
  await ctx.cli("voice", "on");
  return ctx;
}

/** What a fake Front voice streams back: sentences, then maybe a hand-off. */
interface Reply {
  say?: string[];
  handOff?: { message: string };
}

/** `reply` as an OpenAI-compatible stream's events. */
function events({ say = [], handOff }: Reply) {
  const delta = (d: unknown) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d, finish_reason: null }] })}\n\n`;
  return [
    ...say.map((content) => delta({ content })),
    ...(handOff ? [delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "hand_off", arguments: JSON.stringify(handOff) } }] })] : []),
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: handOff ? "tool_calls" : "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

/** A Front voice streaming `reply`, keeping the bodies it was sent. */
function talker(world: Ctx["world"], reply: Reply) {
  const sent: any[] = [];
  world.endpoint(CHAT, async (request) => {
    sent.push(await request.json());
    return new Response(events(reply), { headers: { "content-type": "text/event-stream" } });
  });
  return sent;
}

/** A speech service, keeping each line read aloud. */
function speaker(world: Ctx["world"]) {
  const spoken: string[] = [];
  world.endpoint(SPEECH, async (request) => {
    spoken.push(((await request.json()) as { input: string }).input);
    return new Response(new Uint8Array([1, 0]), { headers: { "content-type": "audio/pcm" } });
  });
  return spoken;
}

/** The app's socket, on `tab`. */
async function open(ctx: Ctx, tab: string) {
  const talk = await ctx.socket("/api/voice");
  if ("refused" in talk) throw new Error(`refused: ${talk.refused!.body}`);
  talk.json({ type: "tab", tab });
  return talk;
}

/** Say `raw` on `talk` as one utterance, its final transcript read. */
async function say(ctx: Ctx, talk: Awaited<ReturnType<typeof open>>, raw: string, utterance = 1) {
  ctx.world.endpoint(TRANSCRIPTIONS, () => Response.json({ text: ` ${raw}` }));
  talk.json({ type: "start", utterance });
  talk.send(speech());
  talk.json({ type: "end" });
  expect(await talk.next()).toEqual({ type: "final", utterance, text: raw });
}

/** The PR the Review partner reviews, with the brief it was given of it and its checkout's diff against its base. */
function reviewing(ctx: Ctx) {
  const file = join(ctx.configDir, "partners.json");
  const partners = JSON.parse(readFileSync(file, "utf8"));
  partners.review.pr = { number: 12, url: "https://github.com/acme/api/pull/12", title: "Back off between retries", base: "main", head: "retries" };
  writeFileSync(file, JSON.stringify(partners));
  const home = join(ctx.configDir, "partners", "review");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "PR.md"), "# acme/api#12: Back off between retries\n\n## Description\n\nRetries now wait twice as long each time.\n");
  ctx.world.diffs.set(partners.review.worktree, "diff --git a/src/retry.ts b/src/retry.ts\n@@ -1,1 +1,1 @@\n-const delay = 100;\n+const delay = 100 * 2 ** attempt;\n");
}

async function thread(ctx: Ctx, tab = "review"): Promise<any[]> {
  return (await ctx.cli("partner", "log", tab, "--json")).json().entries;
}

async function conversation(ctx: Ctx): Promise<any[]> {
  return (await ctx.cli("lead", "log", "--json")).json().entries;
}

/** Wait until `check` holds, as the Front voice answers in the background; fail after a second. */
async function until(check: () => boolean | Promise<boolean>) {
  for (const end = Date.now() + 1000; Date.now() < end; await Bun.sleep(2)) if (await check()) return;
  throw new Error("timed out waiting");
}

describe("voice in a Partner's tab", () => {
  test("a hand-off goes into that Partner's Thread as the user's cleaned message, typed into its pane, and never to the Lead", async () => {
    const ctx = await withPartner();
    const spoken = speaker(ctx.world);
    talker(ctx.world, { handOff: { message: "What does retry.ts do?" } });
    const talk = await open(ctx, "review");

    await say(ctx, talk, "um what does uh retry dot ts do");

    await until(async () => (await thread(ctx)).length === 2);
    expect(await thread(ctx)).toMatchObject([
      { id: 1, type: "user", text: "What does retry.ts do?", raw: "um what does uh retry dot ts do" },
      { id: 2, type: "front-voice", text: "I'll ask the Review partner." },
    ]);
    expect(ctx.world.calls).toContain("herdr agent prompt partner-review What does retry.ts do?");
    await until(() => spoken.length === 1);
    expect(spoken).toEqual(["I'll ask the Review partner."]);
    expect(await conversation(ctx)).toEqual([]);
  });

  test("in the Review tab it reads the PR's title, description and diff, and the Thread, never the Board or the Lead's", async () => {
    const ctx = await withPartner();
    reviewing(ctx);
    ctx.world.addIssue("acme/api", { number: 7, title: "Add retries to the herdr client" });
    await ctx.cli("intent", "set", "--text", "Ship billing this week.");
    await ctx.cli("say", "What is running?");
    await ctx.cli("partner", "reply", "review", "--", "The PR doubles the delay.");
    const spoken = speaker(ctx.world);
    const sent = talker(ctx.world, { say: ["It doubles the delay on each attempt."] });
    const talk = await open(ctx, "review");

    await say(ctx, talk, "what does this pr change");

    await until(async () => (await thread(ctx)).length === 2);
    const prompt = sent[0].messages[0].content;
    for (const read of ["the Review partner", "Back off between retries", "Retries now wait twice as long each time.", "+const delay = 100 * 2 ** attempt;", "Review partner: The PR doubles the delay."]) {
      expect(prompt).toContain(read);
    }
    for (const unread of ["Add retries to the herdr client", "Ship billing this week.", "What is running?", "the Board"]) {
      expect(prompt).not.toContain(unread);
    }
    expect(sent[0].tools[0].function.description).toContain("the Thread for the Review partner");
    expect((await thread(ctx))[1]).toMatchObject({ type: "front-voice", text: "It doubles the delay on each attempt.", heard: "what does this pr change" });
    await until(() => spoken.length === 1);
    expect(spoken).toEqual(["It doubles the delay on each attempt."]);
  });

  test("in the Ideas tab it reads the Idea partner's Thread, and hands off to the Idea partner", async () => {
    const ctx = await withPartner("idea");
    await ctx.cli("partner", "reply", "idea", "--", "We could cap the retry budget per Repo.");
    const sent = talker(ctx.world, { handOff: { message: "Cap it per Repo, then." } });
    const talk = await open(ctx, "idea");

    await say(ctx, talk, "cap it per repo then");

    await until(async () => (await thread(ctx, "idea")).length === 3);
    expect(sent[0].messages[0].content).toContain("Idea partner: We could cap the retry budget per Repo.");
    expect((await thread(ctx, "idea")).slice(1)).toMatchObject([
      { type: "user", text: "Cap it per Repo, then.", raw: "cap it per repo then" },
      { type: "front-voice", text: "I'll ask the Idea partner." },
    ]);
    expect(await conversation(ctx)).toEqual([]);
  });

  test("in a tab with no Partner, what was said reaches no one, the Lead included, and a warning says why", async () => {
    const ctx = await withPartner("review");
    const sent = talker(ctx.world, { handOff: { message: "Hello." } });
    const talk = await open(ctx, "idea");

    await say(ctx, talk, "hello");

    expect(await talk.next()).toEqual({ type: "warning", utterance: 1, error: "no Idea partner runs to hear it", help: ["Start the Idea partner in its tab, then talk again"] });
    expect(sent).toEqual([]);
    expect(await conversation(ctx)).toEqual([]);
    expect(await thread(ctx)).toEqual([]);
  });

  describe("speech", () => {
    /** The speeches `talk` was told of. */
    const speeches = (talk: Awaited<ReturnType<typeof open>>) => talk.received.filter((m: any) => m?.type === "speech");

    test("each page hears only the tab it shows: the Review partner's replies on the Review tab, the Lead's on the Lead's", async () => {
      const ctx = await withPartner();
      const spoken = speaker(ctx.world);
      const review = await open(ctx, "review");
      const lead = await open(ctx, "lead");

      await ctx.cli("partner", "reply", "review", "--", "It backs off exponentially.");
      await ctx.look();
      await until(() => spoken.length === 1);
      await ctx.cli("lead", "say", "Two Specs are running.");
      await ctx.look();
      await until(() => spoken.length === 2);
      await until(() => lead.received.some((m: any) => m?.type === "speech-end"));

      expect(spoken).toEqual(["It backs off exponentially.", "Two Specs are running."]);
      expect(speeches(review)).toEqual([{ type: "speech", rate: 24_000 }]);
      expect(speeches(lead)).toEqual([{ type: "speech", entry: 1, rate: 24_000 }]);
    });

    test("the user's messages and the hand-off drafts are not read aloud", async () => {
      const ctx = await withPartner();
      const spoken = speaker(ctx.world);
      await open(ctx, "review");

      await ctx.cli("partner", "say", "review", "--", "What does retry.ts do?");
      await ctx.cli("partner", "draft", "review", "--", "Ask for a retry test.");
      await ctx.cli("partner", "reply", "review", "--", "It backs off.");
      await ctx.look();

      await until(() => spoken.length === 1);
      await Bun.sleep(20);
      expect(spoken).toEqual(["It backs off."]);
    });

    test("a page that left a tab hears none of its replies, and with no page on it none are made", async () => {
      const ctx = await withPartner();
      const spoken = speaker(ctx.world);
      const talk = await open(ctx, "review");
      talk.json({ type: "tab", tab: "lead" });

      await ctx.cli("partner", "reply", "review", "--", "It backs off exponentially.");
      await ctx.look();
      await Bun.sleep(20);

      expect(spoken).toEqual([]);
      expect(speeches(talk)).toEqual([]);
    });

    test("the Front voice of a Partner's tab is heard on that tab only", async () => {
      const ctx = await withPartner();
      const spoken = speaker(ctx.world);
      talker(ctx.world, { say: ["Hi there."] });
      const review = await open(ctx, "review");
      const lead = await open(ctx, "lead");

      await say(ctx, review, "hey");

      await until(() => review.received.some((m: any) => m?.type === "speech-end"));
      expect(spoken).toEqual(["Hi there."]);
      expect(speeches(lead)).toEqual([]);
    });
  });
});
