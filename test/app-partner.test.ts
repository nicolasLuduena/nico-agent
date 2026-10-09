import { describe, expect, test } from "bun:test";
import { DRAFT_REQUESTS, type PartnerJson, type ThreadState, handOffArgs, pageOf, partnerSayArgs, partnerStanding, partnerStartArgs, reduceThread, threadCards } from "../src/app/partner";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** A Review partner on acme/api, and its Thread as the tab loads it from `/api/partner/log`. */
async function withPartner() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  await ctx.cli("partner", "start", "review", "--repo", "acme/api", ...FLAGS);
  const loaded = async (state: ThreadState = EMPTY): Promise<ThreadState> => {
    const log = JSON.parse((await ctx.web("/api/partner/log?tab=review")).body);
    return reduceThread(state, { type: "log", entries: log.entries });
  };
  return { ...ctx, loaded };
}

const EMPTY: ThreadState = { entries: [], sends: [] };

describe("the app's pages", () => {
  test("the address names the page, so the tab survives a reload", () => {
    expect(pageOf("")).toBe("lead");
    expect(pageOf("#/")).toBe("lead");
    expect(pageOf("#/stats")).toBe("stats");
    expect(pageOf("#/review")).toBe("review");
    expect(pageOf("#/ideas")).toBe("idea");
    expect(pageOf("#/nowhere")).toBe("lead");
  });
});

describe("a Thread's cards", () => {
  test("the user's messages and the Partner's replies, oldest first, then the sends not in it yet", async () => {
    const { cli, loaded } = await withPartner();
    await cli("partner", "say", "review", "--", "What changed?");
    await cli("partner", "reply", "review", "--", "Only retry.ts.");
    let state = await loaded();
    state = reduceThread(state, { type: "send", key: "send-1", text: "Why?", at: "2026-09-30T13:00:00.000Z" });
    expect(threadCards(state)).toMatchObject([
      { kind: "message", who: "user", text: "What changed?" },
      { kind: "message", who: "partner", text: "Only retry.ts." },
      { kind: "message", who: "user", text: "Why?", sending: true },
    ]);
  });

  test("a send leaves once the Thread holds the entry it wrote, and a failed one stays with why", async () => {
    const { web, loaded } = await withPartner();
    let state = reduceThread(EMPTY, { type: "send", key: "send-1", text: "Hi", at: "2026-09-30T13:00:00.000Z" });
    const answer = JSON.parse((await web("/api/partner/say", { method: "POST", body: JSON.stringify({ args: partnerSayArgs("review", "Hi") }) })).body);
    state = reduceThread(state, { type: "sent", key: "send-1", id: answer.said });
    state = await loaded(state);
    expect(threadCards(state)).toMatchObject([{ kind: "message", who: "user", text: "Hi" }]);
    expect(threadCards(state)).toHaveLength(1);
    state = reduceThread(state, { type: "send", key: "send-2", text: "Again", at: "2026-09-30T13:00:00.000Z" });
    state = reduceThread(state, { type: "failed", key: "send-2", error: "no Review partner runs" });
    expect(threadCards(state).at(-1)).toMatchObject({ text: "Again", error: "no Review partner runs" });
  });

  test("only the last draft is open to hand; an earlier one shows as replaced, a handed one as handed with the text sent", async () => {
    const { cli, loaded } = await withPartner();
    await cli("partner", "draft", "review", "--", "First");
    await cli("partner", "draft", "review", "--", "Second");
    expect(threadCards(await loaded())).toMatchObject([
      { kind: "draft", id: 1, text: "First", status: "replaced" },
      { kind: "draft", id: 2, text: "Second", status: "open" },
    ]);
    await cli("partner", "hand-off", "review", "2", "--text", "Second, edited");
    expect(threadCards(await loaded())).toMatchObject([
      { kind: "draft", id: 1, status: "replaced" },
      { kind: "draft", id: 2, text: "Second", status: "handed", handed: "Second, edited" },
    ]);
  });
});

describe("the tab's actions", () => {
  test("start posts the tab, the Repo, the launch and the page's port", () => {
    const choice = { harnesses: ["claude"], harness: "claude", models: ["opus"], model: "opus", efforts: ["high"], effort: "high" };
    expect(partnerStartArgs("idea", "acme/api", choice, "8080")).toEqual(["idea", "--repo", "acme/api", ...FLAGS, "--port", "8080"]);
    expect(partnerStartArgs("idea", "acme/api", choice, "")).toEqual(["idea", "--repo", "acme/api", ...FLAGS]);
  });

  test("a message goes after --, so it is never read as a flag", () => {
    expect(partnerSayArgs("review", "--json")).toEqual(["review", "--", "--json"]);
  });

  test("a hand-off posts the draft's id, with the text only when the user edited it", () => {
    expect(handOffArgs("review", { id: 3, text: "Ship it" }, "Ship it")).toEqual(["review", "3"]);
    expect(handOffArgs("review", { id: 3, text: "Ship it" }, "Ship it today")).toEqual(["review", "3", "--text", "Ship it today"]);
  });

  test("hand-off posted through the app lands in the Lead's Conversation", async () => {
    const { cli, web } = await withPartner();
    await cli("partner", "draft", "review", "--", "Ship it");
    const response = await web("/api/partner/hand-off", { method: "POST", body: JSON.stringify({ args: handOffArgs("review", { id: 1, text: "Ship it" }, "Ship it") }) });
    expect(response.status).toBe(200);
    expect(JSON.parse((await web("/api/lead/log")).body).entries.at(-1).text).toBe("Hand-off from the Review partner (acme/api):\n\nShip it");
  });
});

describe("asking for a draft", () => {
  test("the Ideas tab asks for the four parts its Hand-off is shaped in", () => {
    expect(DRAFT_REQUESTS.idea).toBe("Draft the hand-off for the Lead: the problem, the approach we chose, what we ruled out, and the open questions.");
    expect(DRAFT_REQUESTS.review).toBe("Draft the hand-off for the Lead: what we settled, what the Lead should do with it, and what is still open.");
  });
});

describe("where a tab's Partner stands", () => {
  const row = (partner: string): PartnerJson => ({ tab: "review", partner, state: "idle", repo: "acme/api", agent: "partner-review", harness: "claude", model: "opus", effort: "high", startedAt: "" });

  test("none, starting, running, or stopped short with a way on", () => {
    expect(partnerStanding(undefined)).toBe("none");
    expect(partnerStanding(row("starting"))).toBe("starting");
    expect(partnerStanding(row("running"))).toBe("running");
    expect(partnerStanding(row("Failed at worktree"))).toBe("stopped");
    expect(partnerStanding(row("gone from herdr"))).toBe("stopped");
  });

  test("the app reads the Partners from /api/partners", async () => {
    const { web } = await withPartner();
    const { partners } = JSON.parse((await web("/api/partners")).body) as { partners: PartnerJson[] };
    expect(partners.map((p) => [p.tab, p.repo, partnerStanding(p)])).toEqual([["review", "acme/api", "running"]]);
  });
});
