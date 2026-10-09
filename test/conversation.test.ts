import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

type Web = ReturnType<typeof setup>["web"];

/** Calls one of the Lead's MCP tools at /mcp, returning its structured content and whether it was a tool error. */
async function tool(web: Web, name: string, args: Record<string, unknown> = {}) {
  const response = await web("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const reply = JSON.parse(response.body);
  if (reply.error) throw new Error(reply.error.message);
  return { content: reply.result.structuredContent, isError: reply.result.isError as boolean };
}

describe("the conversation with the Lead", () => {
  test("`say` reaches the Lead's inbox once; a second inbox returns nothing new", async () => {
    const { cli, web, world } = setup();
    const said = await cli("say", "hi", "--json");
    expect(said.exitCode).toBe(0);
    expect(said.json()).toMatchObject({ said: 1 });

    const first = await tool(web, "inbox");
    expect(first.isError).toBe(false);
    expect(first.content.entries).toEqual([{ id: 1, type: "user", at: "2026-09-30T12:00:00.000Z", text: "hi" }]);
    expect((await tool(web, "inbox")).content.entries).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("the Lead's `say` and `ask` appear in `lead log` in order, with who and when", async () => {
    const { cli, web, world } = setup();
    await cli("say", "what is running?");
    world.clock = new Date("2026-09-30T12:01:00.000Z");
    expect((await tool(web, "say", { text: "Two Specs are running." })).content).toMatchObject({ said: 2 });
    world.clock = new Date("2026-09-30T12:02:00.000Z");
    expect((await tool(web, "ask", { question: "Close acme/api#7?", choices: ["yes", "no"] })).content).toMatchObject({ asked: 3 });
    expect((await tool(web, "ask", { question: "Anything else?" })).content).toMatchObject({ asked: 4 });

    const log = await cli("lead", "log", "--json");
    expect(log.exitCode).toBe(0);
    expect(log.json().entries).toEqual([
      { id: 1, who: "user", type: "user", at: "2026-09-30T12:00:00.000Z", text: "what is running?" },
      { id: 2, who: "lead", type: "lead", at: "2026-09-30T12:01:00.000Z", text: "Two Specs are running." },
      { id: 3, who: "lead", type: "ask", at: "2026-09-30T12:02:00.000Z", text: "Close acme/api#7?", choices: ["yes", "no"] },
      { id: 4, who: "lead", type: "ask", at: "2026-09-30T12:02:00.000Z", text: "Anything else?" },
    ]);
    expect(log.json().help).toContain("Run `nico-agent say --answer <id> <text>` to answer the Lead's open questions (3, 4)");

    const toon = await cli("lead", "log");
    expect(toon.stdout).toContain("Two Specs are running.");
    // The Lead's own words never come back in its Inbox.
    expect((await tool(web, "inbox")).content.entries.map((e: { id: number }) => e.id)).toEqual([1]);
  });

  test("`lead log` is read-only: it leaves the Lead's Inbox unread", async () => {
    const { cli, web } = setup();
    expect((await cli("lead", "log", "--json")).json()).toMatchObject({ log: "0 entries", entries: [] });
    await cli("say", "hi");
    await cli("lead", "log");
    expect((await tool(web, "inbox")).content.entries).toHaveLength(1);
  });

  test("`say --answer` answers an open question; the Lead sees it with the question's id", async () => {
    const { cli, web, world } = setup();
    await tool(web, "ask", { question: "Close acme/api#7?", choices: ["yes", "no"] });
    world.clock = new Date("2026-09-30T12:05:00.000Z");
    const answered = await cli("say", "--answer", "1", "yes", "--json");
    expect(answered.exitCode).toBe(0);
    expect(answered.json()).toMatchObject({ answered: 1, id: 2 });

    expect((await tool(web, "inbox")).content.entries).toEqual([
      { id: 2, type: "answer", at: "2026-09-30T12:05:00.000Z", question: 1, asked: "Close acme/api#7?", text: "yes" },
    ]);
    expect((await cli("lead", "log", "--json")).json().help).not.toContainEqual(expect.stringContaining("open questions"));
  });

  test("`say --answer` on an unknown or already answered question is refused with help, and nothing is written", async () => {
    const { cli, web } = setup();
    await tool(web, "ask", { question: "Close acme/api#7?" });
    await tool(web, "ask", { question: "Start billing?" });
    await cli("say", "--answer", "1", "yes");

    for (const [id, text, error] of [
      ["1", "yes", "question 1 was already answered"],
      ["1", "no", "question 1 was already answered"],
      ["9", "no", "no question has id 9"],
      ["x", "no", "no question has id x"],
    ] as const) {
      const refused = await cli("say", "--answer", id, text, "--json");
      expect(refused.exitCode).toBe(1);
      expect(refused.json()).toEqual({ error, help: ["Run `nico-agent lead log` to see the Lead's questions (the open ones are 2)"] });
    }
    expect((await cli("lead", "log", "--json")).json().entries).toHaveLength(3);
  });

  test("only the Lead's questions can be answered: a user message is not one", async () => {
    const { cli } = setup();
    await cli("say", "hi");
    expect((await cli("say", "--answer", "1", "yes", "--json")).json()).toEqual({
      error: "no question has id 1",
      help: ["Run `nico-agent lead log` to see the Lead's questions (none is open)"],
    });
  });

  test("the conversation and the cursor are files in the config dir: a fresh server picks them up", async () => {
    const first = setup();
    await first.cli("say", "one");
    await tool(first.web, "inbox");
    await first.cli("say", "two");

    // Another process (a restarted `serve`) over the same config dir.
    const { webHandler } = await import("../src/web");
    const { run } = await import("../src/cli");
    const context = { world: first.world, configDir: first.configDir, bin: "nico-agent" };
    const handler = webHandler({ ...context, runCli: (argv) => run(argv, context) });
    const web: Web = async (path, init) => {
      const response = await handler(new Request(`http://127.0.0.1:42069${path}`, init));
      return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
    };
    expect((await tool(web, "inbox")).content.entries.map((e: { text: string }) => e.text)).toEqual(["two"]);
  });

  test("blank text and bad tool arguments are refused before anything is written", async () => {
    const { cli, web } = setup();
    expect(await cli("say")).toMatchObject({ exitCode: 2, stdout: expect.stringContaining("<text> is required") });
    expect(await cli("say", " ")).toMatchObject({ exitCode: 2, stdout: expect.stringContaining("<text> is required") });
    expect(await cli("lead", "say", "")).toMatchObject({ exitCode: 2, stdout: expect.stringContaining("<text> is required") });
    expect(await cli("lead", "ask")).toMatchObject({ exitCode: 2, stdout: expect.stringContaining("<question> is required") });
    for (const [name, args] of [
      ["say", {}], ["say", { text: " " }], ["say", { text: "hi", to: "x" }],
      ["ask", { question: "Q?", choices: "yes" }], ["ask", { question: "Q?", choices: [""] }], ["ask", { choices: ["a"] }],
      ["inbox", { all: true }],
    ] as const) {
      await expect(tool(web, name, args)).rejects.toThrow(name);
    }
    expect((await cli("lead", "log", "--json")).json().entries).toEqual([]);
  });

  test("text starting with a dash goes through the tools as typed", async () => {
    const { cli, web } = setup();
    await tool(web, "say", { text: "--json is fine" });
    await tool(web, "ask", { question: "--force?", choices: ["--yes", "--no"] });
    expect((await cli("lead", "log", "--json")).json().entries.map(({ text, choices }: { text: string; choices?: string[] }) => [text, choices])).toEqual([
      ["--json is fine", undefined],
      ["--force?", ["--yes", "--no"]],
    ]);
  });

  test("every inbox carries an orient packet, saying so when there is no Intent or Notes", async () => {
    const { cli, web, configDir } = setup();
    const empty = (await tool(web, "inbox")).content.orient;
    expect(empty).toEqual({
      intent: `none yet: ${join(configDir, "intent.md")} is missing or empty`,
      notes: `none yet: ${join(configDir, "notes.md")} is missing or empty`,
      open: [],
      last: [],
    });

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "intent.md"), "# Intent\n\nShip billing by Friday.\n");
    writeFileSync(join(configDir, "notes.md"), "  \n");
    await cli("say", "hi");
    await tool(web, "ask", { question: "Close acme/api#7?", choices: ["yes", "no"] });
    await tool(web, "ask", { question: "Start billing?" });
    await cli("say", "--answer", "3", "yes");
    await tool(web, "inbox");

    // Nothing new, and the packet comes all the same.
    const { entries, orient } = (await tool(web, "inbox")).content;
    expect(entries).toEqual([]);
    expect(orient.intent).toBe("# Intent\n\nShip billing by Friday.\n");
    expect(orient.notes).toBe(`none yet: ${join(configDir, "notes.md")} is missing or empty`);
    expect(orient.open).toEqual([{ id: 2, at: "2026-09-30T12:00:00.000Z", type: "ask", text: "Close acme/api#7?", choices: ["yes", "no"] }]);
    expect(orient.last.map((e: { id: number; who: string }) => [e.id, e.who])).toEqual([[1, "user"], [2, "lead"], [3, "lead"], [4, "user"]]);
  });

  test("the orient packet's last exchanges are the last ten entries, the Lead's own included", async () => {
    const { cli, web } = setup();
    for (let i = 1; i <= 12; i++) await (i % 2 ? cli("say", `user ${i}`) : tool(web, "say", { text: `lead ${i}` }));
    const { last } = (await tool(web, "inbox")).content.orient;
    expect(last.map((e: { text: string }) => e.text)).toEqual(["user 3", "lead 4", "user 5", "lead 6", "user 7", "lead 8", "user 9", "lead 10", "user 11", "lead 12"]);
  });

  test("recall finds a word in an old entry, with its id and time; a time range narrows it; no match says so", async () => {
    const { cli, web, world } = setup();
    world.clock = new Date("2026-08-01T09:00:00.000Z");
    await cli("say", "Billing waits until the Stripe contract is signed");
    world.clock = new Date("2026-09-15T09:00:00.000Z");
    await tool(web, "say", { text: "Noted: billing is on hold." });
    world.clock = new Date("2026-09-30T12:00:00.000Z");
    await tool(web, "ask", { question: "Start billing now?", choices: ["yes", "BILLING later"] });
    await cli("say", "unrelated");

    const all = (await tool(web, "recall", { query: "billing" })).content;
    expect(all.recall).toBe("3 entries match \"billing\"");
    expect(all.entries.map((e: { id: number; at: string; who: string }) => [e.id, e.at, e.who])).toEqual([
      [1, "2026-08-01T09:00:00.000Z", "user"],
      [2, "2026-09-15T09:00:00.000Z", "lead"],
      [3, "2026-09-30T12:00:00.000Z", "lead"],
    ]);

    const range = (await tool(web, "recall", { query: "Billing", since: "2026-09-01", until: "2026-09-20T00:00:00Z" })).content;
    expect(range.entries.map((e: { id: number }) => e.id)).toEqual([2]);
    // A bare date runs through the end of that day.
    expect((await cli("lead", "recall", "billing", "--until", "2026-08-01", "--json")).json().entries.map((e: { id: number }) => e.id)).toEqual([1]);
    expect((await cli("lead", "recall", "billing", "--until", "2026-08-01T08:00:00Z", "--json")).json().entries).toEqual([]);

    const none = await tool(web, "recall", { query: "kubernetes" });
    expect(none.isError).toBe(false);
    expect(none.content).toMatchObject({ recall: "0 entries match \"kubernetes\"", entries: [] });
    // Recall reads; the Inbox is untouched.
    expect((await tool(web, "inbox")).content.entries).toHaveLength(2);
  });

  test("recall refuses a blank query or a time it cannot read", async () => {
    const { cli, web } = setup();
    expect(await cli("lead", "recall", " ")).toMatchObject({ exitCode: 2, stdout: expect.stringContaining("<query> is required") });
    const bad = await cli("lead", "recall", "x", "--since", "last week", "--json");
    expect(bad.exitCode).toBe(2);
    expect(bad.json()).toEqual({ error: "--since must be a date or time such as 2026-09-01 or 2026-09-01T12:00:00Z (got `last week`)", help: ["Usage: `nico-agent lead recall <query> [--since <time>] [--until <time>]`"] });
    for (const args of [{}, { query: "" }, { query: "x", since: 3 }, { query: "x", from: "2026" }]) {
      await expect(tool(web, "recall", args)).rejects.toThrow("recall");
    }
    expect((await tool(web, "recall", { query: "x", since: "someday" })).isError).toBe(true);
  });
});
