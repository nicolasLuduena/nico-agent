import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { HarnessesJson } from "../src/app/actions";
import {
  type Conversation, type LeadStatusJson, type OpenItem, type ProposalJson, cards, freshItems, itemLine, declineArgs, leadChoice, openItems, leadControl, leadStartArgs, followsNewEntries, notices, proposalLines, reduce, researchMessage, sayArgs,
} from "../src/app/lead";
import { append } from "../src/conversation";
import { setup } from "./harness";

const CLAUDE = { lead: { harness: "claude", model: "opus", effort: "high" }, scheduler: { harness: "claude", model: "opus", effort: "high" } };

/** A Lead's conversation as the panel loads it: `/api/lead/log` and `/api/proposals`, each a second apart. */
function withLead() {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], ...CLAUDE }));
  const cli = async (...argv: string[]) => {
    await ctx.world.tick(1000);
    return ctx.cli(...argv);
  };
  const loaded = async (state: Conversation = EMPTY): Promise<Conversation> => {
    const log = JSON.parse((await ctx.web("/api/lead/log")).body);
    const proposals = JSON.parse((await ctx.web("/api/proposals")).body);
    return reduce(reduce(state, { type: "log", entries: log.entries }), { type: "proposals", proposals: proposals.proposals });
  };
  return { ...ctx, cli, loaded };
}

const EMPTY: Conversation = { entries: [], proposals: [], sends: [] };
const NOW = "2026-09-30T13:00:00.000Z";

describe("the conversation's cards", () => {
  test("the user's and the Lead's messages, oldest first", async () => {
    const { cli, loaded } = withLead();
    await cli("say", "Finish billing first");
    await cli("lead", "say", "Will do");
    expect(cards(await loaded())).toMatchObject([
      { kind: "message", who: "user", text: "Finish billing first" },
      { kind: "message", who: "lead", text: "Will do" },
    ]);
  });

  test("the Front voice's lines are its own messages, with what the user said that it answered itself", async () => {
    const { cli, configDir, world, loaded } = withLead();
    await cli("say", "--raw", "um dispatch acme api seven", "--", "Dispatch acme/api#7.");
    await append(configDir, { type: "front-voice", text: "I'll ask the Lead." }, world.now());
    await append(configDir, { type: "front-voice", text: "Two issues are Ready.", heard: "what's ready" }, world.now());
    expect(cards(await loaded())).toEqual([
      expect.objectContaining({ who: "user", text: "Dispatch acme/api#7." }),
      { kind: "message", key: "entry-2", who: "front-voice", text: "I'll ask the Lead.", at: expect.any(String) },
      { kind: "message", key: "entry-3", who: "front-voice", text: "Two issues are Ready.", heard: "what's ready", at: expect.any(String) },
    ]);
  });

  test("a question is a card with its choices, open until answered; the answer shows on it, not as a card of its own", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    await cli("lead", "ask", "Anything else?");
    expect(cards(await loaded())).toMatchObject([
      { kind: "question", id: 1, text: "Which first?", choices: ["billing", "search"], answer: undefined },
      { kind: "question", id: 2, choices: [] },
    ]);

    await cli("say", "--answer", "1", "billing");
    const after = cards(await loaded());
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ kind: "question", id: 1, answer: { text: "billing" } });
  });

  test("a spoken answer shows what was heard beside the choice it picked, and while it is on its way", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    const answering = reduce(await loaded(), { type: "send", key: "s1", text: "search", question: 1, raw: "the second one", at: NOW });
    expect(cards(answering)).toMatchObject([{ kind: "question", id: 1, answer: { text: "search", raw: "the second one", sending: true } }]);

    await cli("say", "--answer", "1", "--raw", "the second one", "--", "search");
    expect(cards(await loaded())).toMatchObject([{ kind: "question", id: 1, answer: { text: "search", raw: "the second one" } }]);
    await cli("lead", "ask", "And then?", "billing", "search");
    await cli("say", "--answer", "3", "--raw", "billing", "--", "billing");
    expect(cards(await loaded())[1]).toEqual(expect.objectContaining({ answer: { text: "billing" } }));
  });

  test("a Proposal is a card in its place in time, with its action, reason and status; its decision is no card of its own", async () => {
    const { cli, loaded } = withLead();
    await cli("say", "Keep going");
    await cli("lead", "propose", "--reason", "It is next in the Queue", "advance");
    await cli("lead", "say", "Proposed it");
    await cli("proposals", "decline", "1", "Finish billing first");
    expect(cards(await loaded())).toMatchObject([
      { kind: "message", text: "Keep going" },
      { kind: "proposal", id: 1, action: "nico-agent advance", reason: "It is next in the Queue", status: "declined", declineReason: "Finish billing first" },
      { kind: "message", text: "Proposed it" },
    ]);
  });

  test("a Proposal to write a Spec is a card carrying the Repo and the whole text, which approving leaves without an outcome", async () => {
    const { cli, loaded, world } = withLead();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    await cli("lead", "propose", "--reason", "The billing Spec we agreed on", "--write", "acme/api", "--text", "# Spec: billing\n");
    await cli("proposals", "approve", "1");
    const [card] = cards(await loaded()) as ProposalJson[];
    expect(card).toMatchObject({ kind: "proposal", id: 1, write: { repo: "acme/api", text: "# Spec: billing\n" }, reason: "The billing Spec we agreed on", status: "approved" });
    expect(card!.action).toBeUndefined();
    expect(proposalLines(card!)).toEqual([]);
  });

  test("a decided Proposal shows what its action did, or why it failed", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "propose", "--reason", "Next", "advance");
    await cli("lead", "propose", "--reason", "Wrong", "--", "queue", "acme/api#9", "--repo", "acme/api");
    await cli("proposals", "approve", "1");
    await cli("proposals", "approve", "2");
    const [approved, failed] = cards(await loaded()) as ProposalJson[];
    expect(approved).toMatchObject({ status: "approved" });
    expect(proposalLines(approved!)).toEqual([{ text: "Nothing to do: no running Spec needs a step and no queued Spec could start.", error: false }]);
    expect(failed).toMatchObject({ status: "failed" });
    expect(proposalLines(failed!)).toEqual([{ text: "acme/api is not a configured Repo", error: true }]);
  });
});

describe("the Questions list, as toasts", () => {
  test("every open question and Proposal, oldest first; answered and decided ones leave it", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    await cli("lead", "say", "Meanwhile, a thought");
    await cli("lead", "propose", "--reason", "It is next in the Queue", "advance");
    await cli("lead", "ask", "Anything else?");
    await cli("lead", "propose", "--reason", "Then this", "advance");
    expect(openItems(await loaded())).toMatchObject([
      { kind: "question", id: 1, text: "Which first?", choices: ["billing", "search"] },
      { kind: "proposal", id: 1, reason: "It is next in the Queue" },
      { kind: "question", id: 3, text: "Anything else?" },
      { kind: "proposal", id: 2, reason: "Then this" },
    ]);

    await cli("say", "--answer", "1", "billing");
    await cli("proposals", "decline", "2", "Not yet");
    await cli("proposals", "approve", "1");
    expect(openItems(await loaded())).toMatchObject([{ kind: "question", id: 3 }]);
    // They stay in the chat, answered and decided.
    expect(cards(await loaded()).filter((c) => c.kind !== "message")).toHaveLength(4);
  });

  test("an answer sent from a toast takes it off at once, and is the answer the chat sends; one not sent puts it back", async () => {
    const { cli, loaded, post } = withSay();
    await cli("lead", "ask", "Which first?", "billing", "search");
    await cli("lead", "ask", "Anything else?");
    const answering = reduce(await loaded(), { type: "send", key: "s1", text: "billing", question: 1, at: NOW });
    expect(openItems(answering)).toMatchObject([{ kind: "question", id: 2 }]);

    const refused = reduce(answering, { type: "failed", key: "s1", error: "Could not reach nico-agent serve; try again." });
    expect(openItems(refused)).toMatchObject([{ kind: "question", id: 1, failure: { text: "billing" } }, { kind: "question", id: 2 }]);

    await post(sayArgs("billing", 1));
    expect(cards(await loaded())[0]).toMatchObject({ kind: "question", id: 1, answer: { text: "billing" } });
    expect(openItems(await loaded())).toMatchObject([{ kind: "question", id: 2 }]);
  });

  test("a toast is new when it was not open before: one just asked, or one whose answer was refused", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    const before = openItems(await loaded());
    await cli("lead", "propose", "--reason", "Next", "advance");
    const after = await loaded();
    expect(freshItems(before, openItems(after))).toMatchObject([{ kind: "proposal", id: 1 }]);

    const answering = reduce(after, { type: "send", key: "s1", text: "billing", question: 1, at: NOW });
    const refused = reduce(answering, { type: "failed", key: "s1", error: "Could not reach nico-agent serve; try again." });
    expect(freshItems(openItems(answering), openItems(refused))).toMatchObject([{ kind: "question", id: 1 }]);
    expect(freshItems(openItems(refused), openItems(refused))).toEqual([]);
  });
});

describe("a question's and a Proposal's line in the conversation", () => {
  test("an open question says the Lead asked, with its text; answered, it carries the answer and what was heard", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    const [open] = cards(await loaded());
    expect(itemLine(open as OpenItem)).toEqual({ verb: "asked", text: "Which first?", status: "open", outcome: [] });

    await cli("say", "--answer", "1", "--raw", "the second one", "--", "search");
    const [answered] = cards(await loaded());
    expect(itemLine(answered as OpenItem)).toEqual({ verb: "asked", text: "Which first?", status: "answered", answer: "search", raw: "the second one", outcome: [] });
  });

  test("an answer on its way shows on the line as answering; one refused leaves it open", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    const answering = reduce(await loaded(), { type: "send", key: "s1", text: "billing", question: 1, at: NOW });
    expect(itemLine(cards(answering)[0] as OpenItem)).toMatchObject({ status: "answering", answer: "billing" });
    const refused = reduce(answering, { type: "failed", key: "s1", error: "question 1 was already answered" });
    expect(itemLine(cards(refused)[0] as OpenItem)).toEqual({ verb: "asked", text: "Which first?", status: "open", outcome: [] });
  });

  test("a Proposal says the Lead proposed its action, with its reason; decided, it carries the decision and what the action did", async () => {
    const { cli, loaded, world } = withLead();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    await cli("lead", "propose", "--reason", "It is next in the Queue", "advance");
    await cli("lead", "propose", "--reason", "Wrong", "--", "queue", "acme/api#9", "--repo", "acme/nope");
    await cli("lead", "propose", "--reason", "Not now", "advance");
    await cli("lead", "propose", "--reason", "The billing Spec", "--write", "acme/api", "--text", "# Spec: billing\n");
    const open = cards(await loaded()) as OpenItem[];
    expect(open.map(itemLine)).toEqual([
      { verb: "proposed", action: "nico-agent advance", text: "It is next in the Queue", status: "open", outcome: [] },
      { verb: "proposed", action: "nico-agent queue acme/api#9 --repo acme/nope", text: "Wrong", status: "open", outcome: [] },
      { verb: "proposed", action: "nico-agent advance", text: "Not now", status: "open", outcome: [] },
      { verb: "proposed", action: "Write to acme/api’s Source", text: "The billing Spec", status: "open", outcome: [] },
    ]);

    await cli("proposals", "approve", "1");
    await cli("proposals", "approve", "2");
    await cli("proposals", "decline", "3", "Finish billing first");
    await cli("proposals", "approve", "4");
    expect((cards(await loaded()) as OpenItem[]).map(itemLine)).toEqual([
      expect.objectContaining({ status: "approved", outcome: [{ text: "Nothing to do: no running Spec needs a step and no queued Spec could start.", error: false }] }),
      expect.objectContaining({ status: "failed", outcome: [{ text: "acme/nope is not a configured Repo", error: true }] }),
      expect.objectContaining({ status: "declined", answer: "Finish billing first", outcome: [] }),
      expect.objectContaining({ status: "approved", outcome: [] }),
    ]);
  });
});

describe("optimistic sends", () => {
  test("a message shows at once, then stays one card once the log has it", async () => {
    const { cli, loaded, post } = withSay();
    const before = await loaded();
    const sending = reduce(before, { type: "send", key: "s1", text: "Hello", at: NOW });
    expect(cards(sending)).toEqual([{ kind: "message", key: "s1", who: "user", text: "Hello", at: NOW, sending: true }]);

    const { said } = await post(["--", "Hello"]);
    const sent = reduce(sending, { type: "sent", key: "s1", id: said });
    // The answer came before the log was fetched again: still one card.
    expect(cards(sent)).toMatchObject([{ kind: "message", text: "Hello" }]);
    await cli("lead", "say", "Hi");
    const after = await loaded(sent);
    expect(after.sends).toEqual([]);
    expect(cards(after)).toMatchObject([{ kind: "message", key: "entry-1", who: "user", text: "Hello" }, { kind: "message", who: "lead", text: "Hi" }]);
    expect(cards(after)[0]).not.toHaveProperty("sending");
  });

  test("a message the log has before `say` answers is one card once it does", async () => {
    const { loaded, post } = withSay();
    const sending = reduce(await loaded(), { type: "send", key: "s1", text: "Hello", at: NOW });
    const { said } = await post(["--", "Hello"]);
    // `conversation-entry` came first: the refetched log holds the message while the send waits on its answer.
    const refetched = await loaded(sending);
    const sent = reduce(refetched, { type: "sent", key: "s1", id: said });
    expect(sent.sends).toEqual([]);
    expect(cards(sent)).toMatchObject([{ kind: "message", key: "entry-1", text: "Hello" }]);
  });

  test("a message that failed stays with its error, after the log, until dismissed", async () => {
    const { loaded } = withLead();
    const failed = reduce(reduce(EMPTY, { type: "send", key: "s1", text: "Hello", at: NOW }), { type: "failed", key: "s1", error: "Could not reach nico-agent serve; try again." });
    const after = await loaded(failed);
    expect(cards(after)).toEqual([{ kind: "message", key: "s1", who: "user", text: "Hello", at: NOW, error: "Could not reach nico-agent serve; try again." }]);
    expect(cards(reduce(after, { type: "dismiss", key: "s1" }))).toEqual([]);
  });

  test("an answer shows on its question at once; one refused leaves the question open, with why", async () => {
    const { cli, loaded } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");
    const answering = reduce(await loaded(), { type: "send", key: "s1", text: "billing", question: 1, at: NOW });
    expect(cards(answering)).toMatchObject([{ kind: "question", id: 1, answer: { text: "billing", sending: true } }]);
    const refused = reduce(answering, { type: "failed", key: "s1", error: "question 1 was already answered" });
    expect(cards(refused)).toMatchObject([{ kind: "question", id: 1, answer: undefined, failure: { key: "s1", text: "billing", error: "question 1 was already answered" } }]);
  });
});

/** A Lead whose messages are sent as the panel does: posted to `/api/say`. */
function withSay() {
  const ctx = withLead();
  const post = async (args: string[]) => JSON.parse((await ctx.web("/api/say", { method: "POST", body: JSON.stringify({ args }) })).body) as { said: number };
  return { ...ctx, post };
}

describe("what the panel posts", () => {
  test("a message, an answer and a decline put the text after `--`, so it is never read as a flag", () => {
    expect(sayArgs("--force is fine")).toEqual(["--", "--force is fine"]);
    expect(sayArgs("billing", 4)).toEqual(["--answer", "4", "--", "billing"]);
    expect(sayArgs("Billing", 4, "the first one")).toEqual(["--answer", "4", "--raw", "the first one", "--", "Billing"]);
    expect(declineArgs(3, "  ")).toEqual(["3"]);
    expect(declineArgs(3, "Finish billing first")).toEqual(["3", "--", "Finish billing first"]);
  });

  test("a research request is the question after the research mark, with the Repo when one is named", () => {
    expect(sayArgs(researchMessage("How does codex load skills?"))).toEqual(["--", "Research request: How does codex load skills?"]);
    expect(sayArgs(researchMessage("  How does codex load skills?\n", " acme/api "))).toEqual(["--", "Research request: How does codex load skills?\nRepo: acme/api"]);
    expect(sayArgs(researchMessage("--help, or not?", "  "))).toEqual(["--", "Research request: --help, or not?"]);
  });

  test("a research request reaches the Lead as the user's message, and shows in the conversation like any other", async () => {
    const { loaded, post } = withSay();
    const text = researchMessage("How does codex load skills?", "acme/api");
    const { said } = await post(sayArgs(text));
    expect(cards(await loaded())).toEqual([{ kind: "message", key: `entry-${said}`, who: "user", text, at: expect.any(String) }]);
  });

  test("a spoken message keeps what was heard, so the entry carries the raw transcript", () => {
    expect(sayArgs("Dispatch acme/api#7", undefined, "dispatch acme api 7")).toEqual(["--raw", "dispatch acme api 7", "--", "Dispatch acme/api#7"]);
  });

  test("a spoken message shows as spoken, while sending and once in the conversation", async () => {
    const { cli, loaded } = withLead();
    const sending = reduce(EMPTY, { type: "send", key: "s1", text: "Hello", raw: "Hello", at: NOW });
    expect(cards(sending)).toMatchObject([{ kind: "message", key: "s1", text: "Hello", sending: true, spoken: true }]);
    await cli("say", "--raw", "Hello", "--", "Hello");
    expect(cards(await loaded(reduce(sending, { type: "sent", key: "s1", id: 1 })))).toEqual([{ kind: "message", key: "entry-1", who: "user", text: "Hello", at: expect.any(String), spoken: true }]);
    await cli("say", "Typed");
    expect(cards(await loaded())[1]).not.toHaveProperty("spoken");
  });

  test("a message the Front voice cleaned shows what was heard beside it, while sending and once in the conversation", async () => {
    const { cli, loaded } = withLead();
    const sending = reduce(EMPTY, { type: "send", key: "s1", text: "Dispatch acme/api#7.", raw: "um dispatch acme api seven", at: NOW });
    expect(cards(sending)).toMatchObject([{ text: "Dispatch acme/api#7.", raw: "um dispatch acme api seven", sending: true }]);
    await cli("say", "--raw", "um dispatch acme api seven", "--", "Dispatch acme/api#7.");
    expect(cards(await loaded(reduce(sending, { type: "sent", key: "s1", id: 1 })))).toEqual([
      { kind: "message", key: "entry-1", who: "user", text: "Dispatch acme/api#7.", raw: "um dispatch acme api seven", at: expect.any(String), spoken: true },
    ]);
  });

  test("a correction marks the message it supersedes, and names it", async () => {
    const { cli, loaded } = withLead();
    await cli("say", "Dispatch acme/api#7");
    await cli("lead", "say", "Dispatching it.");
    await cli("say", "No, I said acme/api#8");
    expect(cards(await loaded())).toMatchObject([
      { key: "entry-1", text: "Dispatch acme/api#7", superseded: true },
      { key: "entry-2", who: "lead" },
      { key: "entry-3", text: "No, I said acme/api#8", corrects: 1 },
    ]);
    expect(cards(await loaded())[1]).not.toHaveProperty("superseded");
  });

  test("a start names the Harness, model and Effort picked and the port the page was served from", () => {
    const choice = { harnesses: ["claude"], harness: "claude", models: ["opus"], model: "opus", efforts: ["high"], effort: "high" };
    expect(leadStartArgs(choice, "8080")).toEqual(["--harness", "claude", "--model", "opus", "--effort", "high", "--port", "8080"]);
    // A page on the default port of its scheme names none.
    expect(leadStartArgs(choice, "")).toEqual(["--harness", "claude", "--model", "opus", "--effort", "high"]);
  });
});

describe("the Lead's controls", () => {
  const HARNESSES: HarnessesJson = {
    harnesses: [
      { name: "claude", models: [{ model: "opus", efforts: ["low", "high"] }, { model: "sonnet", efforts: ["low"] }] },
      { name: "codex", models: [{ model: "gpt-5.5", efforts: ["high"] }] },
    ],
    remembered: { last: { harness: "codex", model: "gpt-5.5" }, efforts: {} },
  };
  const RUNNING: LeadStatusJson = { lead: "running", harness: "claude", model: "opus", effort: "high", state: "idle" };

  test("the pickers start on the running Lead's launch, else on the last launch", () => {
    expect(leadChoice(HARNESSES, RUNNING, {})).toMatchObject({ harness: "claude", model: "opus", effort: "high" });
    expect(leadChoice(HARNESSES, { lead: "not running" }, {})).toMatchObject({ harness: "codex", model: "gpt-5.5", effort: "high" });
    expect(leadChoice(HARNESSES, RUNNING, { harness: "codex" })).toMatchObject({ harness: "codex", model: "gpt-5.5" });
  });

  test("a stopped Lead can be started; a running one restarted on another launch, and stopped", () => {
    const same = leadChoice(HARNESSES, RUNNING, {})!;
    const other = leadChoice(HARNESSES, RUNNING, { model: "sonnet" })!;
    expect(leadControl({ lead: "not running" }, same)).toEqual({ start: "Start", stop: false });
    expect(leadControl(RUNNING, same)).toEqual({ start: null, stop: true });
    expect(leadControl(RUNNING, other)).toEqual({ start: "Restart", stop: true });
    // One that failed, or is gone from herdr, starts again where it stopped, and can be forgotten.
    expect(leadControl({ ...RUNNING, lead: "Failed at agent start" }, same)).toEqual({ start: "Start", stop: true });
    // One still starting is neither started again nor restarted until it is running.
    expect(leadControl({ lead: "starting", harness: "claude", model: "opus", effort: "high" }, other)).toEqual({ start: null, stop: true });
  });
});

describe("the one quiet place for warnings", () => {
  const RUNNING: LeadStatusJson = { lead: "running", harness: "claude", model: "opus", effort: "high", state: "idle" };

  test("nothing while serve answers, the Lead runs and voice is fine", () => {
    expect(notices({ failure: null, status: RUNNING, talk: null })).toEqual([]);
    // Before the Lead's status loads, it is not said to be stopped.
    expect(notices({ failure: null, status: null, talk: null })).toEqual([]);
  });

  test("a Lead not running says so and where to start it; one that failed says why instead", () => {
    expect(notices({ failure: null, status: { lead: "not running" }, talk: null })).toEqual([
      { key: "lead", text: "The Lead is not running", help: ["Start it from Lead in the header"] },
    ]);
    expect(notices({ failure: null, status: { lead: "Failed at agent start", failure: { step: "agent start", error: "herdr is not running" } }, talk: null })).toEqual([
      { key: "lead", text: "The Lead failed at agent start: herdr is not running", help: ["Start it again from Lead in the header"] },
    ]);
    // One starting is on its way, not a problem.
    expect(notices({ failure: null, status: { lead: "starting" }, talk: null })).toEqual([]);
  });

  test("losing serve, the Lead's launch warnings and voice failing all show together, serve first", () => {
    const shown = notices({
      failure: "Lost nico-agent serve; reconnecting.",
      status: { ...RUNNING, warnings: ["the shaping skill x is left out"] },
      talk: { error: "The voice service is down", help: ["Typing still works"] },
    });
    expect(shown).toEqual([
      { key: "serve", text: "Lost nico-agent serve; reconnecting.", help: [] },
      { key: "lead-warning-0", text: "the shaping skill x is left out", help: [] },
      { key: "voice", text: "The voice service is down", help: ["Typing still works"] },
    ]);
  });

  test("a rate-limited GitHub or a Board that could not be read shows here; a Repo's own failure stays on its row", () => {
    const warning = "GitHub rate limit exceeded; nico-agent asks it again at 2026-10-09T19:00:00.000Z";
    expect(notices({ failure: null, status: RUNNING, talk: null, board: { warning, errors: [{ repo: "acme/api", error: "not found" }] } })).toEqual([
      { key: "board-warning", text: warning, help: [] },
    ]);
    expect(notices({ failure: null, status: RUNNING, talk: null, board: { error: "config.json is not valid JSON", help: ["Fix or delete the file and run `nico-agent repo add` again"] } })).toEqual([
      { key: "board", text: "The Repos could not be read: config.json is not valid JSON", help: ["Fix or delete the file and run `nico-agent repo add` again"] },
    ]);
  });
});

describe("following new entries", () => {
  test("the conversation follows new entries while the user is at its end, or within a line of it", () => {
    expect(followsNewEntries({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 600 })).toBe(true);
    expect(followsNewEntries({ scrollHeight: 2000, scrollTop: 1370, clientHeight: 600 })).toBe(true);
  });

  test("scrolled up to read, it stays where the user is", () => {
    expect(followsNewEntries({ scrollHeight: 2000, scrollTop: 900, clientHeight: 600 })).toBe(false);
  });
});
