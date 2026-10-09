import { describe, expect, test } from "bun:test";
import { answerArgs, askingItems, screenChoices } from "../src/app/asking";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** acme/api#11 dispatched, as the first issue of Spec acme/api#10, and #12 dispatched on its own. */
async function dispatched() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Charge cards" });
  ctx.world.addIssue("acme/api", { number: 12, title: "Add retries" });
  expect((await ctx.cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
  expect((await ctx.cli("dispatch", "acme/api#12", ...FLAGS)).exitCode).toBe(0);
  ctx.world.calls.length = 0;
  const post = async (path: string, args: string[] = []) => {
    const { status, body } = await ctx.web(path, { method: "POST", body: JSON.stringify({ args }) });
    return { status, json: JSON.parse(body) };
  };
  return { ...ctx, post };
}

describe("/api/answer", () => {
  test("sends the user's text, verbatim, to an Asking Implementer", async () => {
    const { post, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    const text = "--force is fine here";
    const { status, json } = await post("/api/answer", answerArgs("acme/api#11", text));
    expect(status).toBe(200);
    expect(json).toMatchObject({ answered: "acme/api#11", agent: "impl-api-11" });
    expect(world.calls).toContain(`herdr agent prompt impl-api-11 ${text}`);
  });

  test("is refused, saying why, once the Implementer is no longer Asking", async () => {
    const { post, world } = await dispatched();
    world.agentStates.set("impl-api-11", "working");
    const { status, json } = await post("/api/answer", answerArgs("acme/api#11", "2"));
    expect(status).toBe(422);
    expect(json.error).toBe("acme/api#11's Implementer is not waiting on the user (it is working)");
    expect(world.calls.some((c) => c.startsWith("herdr agent prompt"))).toBe(false);
  });
});

/** Claude Code asking with its question tool: options with descriptions, then a choice after a rule. */
const CLAUDE_QUESTION = `⏺ I need one decision before going on.

────────────────────────────────────────────────────────────
 ☐ Storage

Where should the cache live?

❯ 1. In memory
     Fast, lost on restart
  2. On disk
     Survives restarts
  3. Type something.
────────────────────────────────────────────────────────────
  4. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`;

/** Claude Code asking for permission, in its box. */
const CLAUDE_PERMISSION = `╭──────────────────────────────────────────────────────────╮
│ Bash command                                             │
│                                                          │
│   bun test                                               │
│   Run the tests                                          │
│                                                          │
│ Do you want to proceed?                                  │
│ ❯ 1. Yes                                                 │
│   2. Yes, and don't ask again for bun test commands      │
│   3. No, and tell Claude what to do differently (esc)    │
╰──────────────────────────────────────────────────────────╯`;

/** Codex asking for approval. */
const CODEX_APPROVAL = `  Would you like to run the following command?

  $ bun test

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (a)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel`;

/** A question in prose, with only the input box below it. */
const PROSE_QUESTION = `⏺ The spec says to retry on 5xx, but the client already retries
  twice. Should I keep both, or drop the client's?

╭──────────────────────────────────────────────────────────╮
│ >                                                        │
╰──────────────────────────────────────────────────────────╯`;

describe("the choices on an Asking Implementer's screen", () => {
  test("Claude Code's question: each numbered option, its description left out", () => {
    expect(screenChoices(CLAUDE_QUESTION)).toEqual([
      { number: "1", label: "In memory" },
      { number: "2", label: "On disk" },
      { number: "3", label: "Type something." },
      { number: "4", label: "Chat about this" },
    ]);
  });

  test("Claude Code's permission prompt, out of its box", () => {
    expect(screenChoices(CLAUDE_PERMISSION)).toEqual([
      { number: "1", label: "Yes" },
      { number: "2", label: "Yes, and don't ask again for bun test commands" },
      { number: "3", label: "No, and tell Claude what to do differently (esc)" },
    ]);
  });

  test("Codex's approval", () => {
    expect(screenChoices(CODEX_APPROVAL).map((c) => c.label)).toEqual([
      "Yes, proceed (y)",
      "Yes, and don't ask again for this command (a)",
      "No, and tell Codex what to do differently (esc)",
    ]);
  });

  test("none for a question in prose", () => {
    expect(screenChoices(PROSE_QUESTION)).toEqual([]);
  });

  test("the last list shown, when an earlier one scrolled by", () => {
    const screen = `⏺ Done:\n  1. Added the client\n  2. Wrote its tests\n  3. Updated the docs\n\n${CLAUDE_PERMISSION}`;
    expect(screenChoices(screen).map((c) => c.label)).toEqual(["Yes", "Yes, and don't ask again for bun test commands", "No, and tell Claude what to do differently (esc)"]);
  });
});

describe("Asking Implementers as toasts", () => {
  /** The Board as the app reads it. */
  const board = async (web: Awaited<ReturnType<typeof dispatched>>["web"]) => JSON.parse((await web("/api/board")).body);

  test("each Asking Implementer, naming its issue, its title and Spec, its question and its choices", async () => {
    const { web, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    world.screens.set("impl-api-11", CLAUDE_PERMISSION);
    world.agentStates.set("impl-api-12", "working");
    expect(askingItems(await board(web))).toEqual([{
      kind: "asking", key: "asking-acme/api#11", issue: "acme/api#11", title: "Charge cards", spec: "acme/api#10",
      question: CLAUDE_PERMISSION, choices: screenChoices(CLAUDE_PERMISSION),
    }]);
  });

  test("none once the Implementer stops Asking, whoever answered", async () => {
    const { web, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    expect(askingItems(await board(web))).toHaveLength(1);
    world.agentStates.set("impl-api-11", "working");
    expect(askingItems(await board(web))).toEqual([]);
  });

  test("an unreadable screen still shows, with why and no choices", async () => {
    const { web, world } = await dispatched();
    world.agentStates.set("impl-api-12", "blocked");
    world.failCall("herdr agent read impl-api-12", "herdr is not running");
    expect(askingItems(await board(web))).toMatchObject([{ issue: "acme/api#12", question: "", error: expect.stringContaining("herdr is not running"), choices: [] }]);
  });

  test("a Gardener's question is not a toast", () => {
    expect(askingItems({ asking: [{ gardener: "acme/api", question: "Keep both?" }] })).toEqual([]);
  });

  test("one just answered hides until its question changes", async () => {
    const { web, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    world.screens.set("impl-api-11", CLAUDE_PERMISSION);
    const answered = { "acme/api#11": CLAUDE_PERMISSION };
    expect(askingItems(await board(web), answered)).toEqual([]);
    world.screens.set("impl-api-11", CODEX_APPROVAL);
    expect(askingItems(await board(web), answered)).toMatchObject([{ issue: "acme/api#11", question: CODEX_APPROVAL }]);
  });
});
