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

    // The same answer again is a no-op.
    expect((await cli("say", "--answer", "1", "yes", "--json")).json()).toMatchObject({ answered: "1 already, as given (no-op)", id: 3 });
    for (const [id, error] of [["1", "question 1 was already answered"], ["9", "no question has id 9"], ["x", "no question has id x"]] as const) {
      const refused = await cli("say", "--answer", id, "no", "--json");
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
});
