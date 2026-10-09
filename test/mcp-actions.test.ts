import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const LAUNCH = { harness: "claude", model: "opus", effort: "high" };

type Ctx = ReturnType<typeof setup>;

/** A tool call POSTed to /mcp, answering its result. */
async function call(web: Ctx["web"], name: string, args: Record<string, unknown> = {}) {
  const response = await web("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return JSON.parse(response.body).result as { content: { type: string; text: string }[]; structuredContent: Record<string, unknown>; isError: boolean };
}

/** acme/api with Spec acme/api#10 (issues #11 and #12), acme/api#7 alone, the Scheduler defaults and the orders given. */
async function board(orders: Record<string, boolean> = {}) {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
  ctx.world.addIssue("acme/api", { number: 7 });
  const file = join(ctx.configDir, "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...config, scheduler: LAUNCH, orders }));
  ctx.world.calls.length = 0;
  return ctx;
}

/** acme/api#7 dispatched with a merged PR and its Implementer waiting on the user. */
async function inFlight(orders: Record<string, boolean> = {}) {
  const ctx = await board(orders);
  expect((await ctx.cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
  ctx.world.linkPr("acme/api", 7, { number: 9, state: "merged" });
  ctx.world.agentStates.set("impl-api-7", "blocked");
  ctx.world.calls.length = 0;
  return ctx;
}

/** Each action tool: its order, the Board it needs, its arguments, and the CLI command it runs. */
const ACTIONS = [
  { tool: "dispatch", order: "start", ready: board, args: { issues: ["acme/api#7"], ...LAUNCH }, argv: ["dispatch", "acme/api#7", ...FLAGS] },
  { tool: "queue", order: "start", ready: board, args: { spec: "acme/api#10", repo: "acme/api" }, argv: ["queue", "acme/api#10", "--repo", "acme/api"] },
  { tool: "advance", order: "start", ready: board, args: {}, argv: ["advance"] },
  { tool: "review", order: "review", ready: inFlight, args: { issues: ["acme/api#7"], ...LAUNCH }, argv: ["review", "acme/api#7", ...FLAGS] },
  { tool: "close", order: "close", ready: inFlight, args: { issues: ["acme/api#7"] }, argv: ["close", "acme/api#7"] },
  { tool: "answer", order: "answer", ready: inFlight, args: { issue: "acme/api#7", text: "Use option 2" }, argv: ["answer", "acme/api#7", "Use option 2"] },
] as const;

describe("the Lead's action tools under Standing orders", () => {
  for (const { tool, order, ready, args, argv } of ACTIONS) {
    test(`${tool}, with the ${order} order off, is refused with help naming the order and a propose call, touching nothing`, async () => {
      const { web, world, cli } = await ready({ [order]: false });
      const boardBefore = (await cli("--json")).stdout;
      world.calls.length = 0;

      const result = await call(web, tool, args);
      expect(result.isError).toBe(true);
      expect(result.structuredContent.error).toBe(`the \`${order}\` Standing order is off, so ${tool} needs the user's approval`);
      const help = result.structuredContent.help as string[];
      expect(help[0]).toContain(`\`${order}\``);
      const propose = help.find((h) => h.includes("`propose`"))!;
      const shaped = JSON.parse(propose.slice(propose.indexOf("{"), propose.lastIndexOf("}") + 1));
      expect(shaped).toEqual({ action: expect.any(Array), reason: expect.any(String) });
      expect(shaped.action[0]).toBe(tool);
      expect(world.calls).toEqual([]);
      expect((await cli("--json")).stdout).toBe(boardBefore);
    });

    test(`${tool}, with the ${order} order on, makes the same World calls as \`nico-agent ${argv[0]}\``, async () => {
      const lead = await ready({ [order]: true });
      const user = await ready({ [order]: true });

      const result = await call(lead.web, tool, args);
      const ran = await user.cli(...argv, "--json");
      expect(result.isError).toBe(false);
      expect(ran.exitCode).toBe(0);
      expect(lead.world.calls).toEqual(user.world.calls);
      expect(lead.world.calls.length).toBeGreaterThan(0);
      expect(Object.keys(result.structuredContent)).toEqual(Object.keys(ran.json()));
    });
  }

  test("a refusal's propose call carries the exact command, so approving it runs what the tool would have", async () => {
    const { web } = await board();
    const result = await call(web, "dispatch", { issues: ["acme/api#7", "acme/api#11"], ...LAUNCH, base: "main" });
    const propose = (result.structuredContent.help as string[]).find((h) => h.includes("`propose`"))!;
    expect(JSON.parse(propose.slice(propose.indexOf("{"), propose.lastIndexOf("}") + 1)).action)
      .toEqual(["dispatch", ...FLAGS, "--base", "main", "--", "acme/api#7", "acme/api#11"]);
  });

  test("an order turned on is used by the next call, without restarting serve", async () => {
    const { web, cli, world } = await board();
    expect((await call(web, "queue", { spec: "acme/api#10", repo: "acme/api" })).isError).toBe(true);
    await cli("orders", "set", "start", "on");
    const queued = await call(web, "queue", { spec: "acme/api#10", repo: "acme/api" });
    expect(queued.isError).toBe(false);
    expect(queued.structuredContent).toMatchObject({ queued: "acme/api#10", queue: ["acme/api#10"] });
    expect((await cli("--json")).json().rooms[0].queue).toEqual(["acme/api#10"]);
    expect(world.calls.length).toBeGreaterThan(0);
  });

  test("unqueue falls under start too", async () => {
    const { web, cli } = await board({ start: true });
    await call(web, "queue", { spec: "acme/api#10", repo: "acme/api" });
    await cli("orders", "set", "start", "off");
    const refused = await call(web, "unqueue", { spec: "acme/api#10", repo: "acme/api" });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toBe("the `start` Standing order is off, so unqueue needs the user's approval");
    await cli("orders", "set", "start", "on");
    expect((await call(web, "unqueue", { spec: "acme/api#10", repo: "acme/api" })).structuredContent).toMatchObject({ unqueued: "acme/api#10", queue: [] });
  });

  test("a CLI refusal under an order that is on comes back as the CLI's own tool error", async () => {
    const { web, cli } = await board({ close: true });
    await cli("dispatch", "acme/api#7", ...FLAGS);
    const result = await call(web, "close", { issues: ["acme/api#7"] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual((await cli("close", "acme/api#7", "--json")).json());
    expect(result.structuredContent.error).toContain("no PR");
  });

  test("an issue that looks like a flag stays an issue, so it cannot confirm a close", async () => {
    const { web, cli, world } = await board({ close: true });
    await cli("dispatch", "acme/api#7", ...FLAGS);
    world.calls.length = 0;
    const result = await call(web, "close", { issues: ["acme/api#7", "--confirm"] });
    expect(result.isError).toBe(true);
    expect(world.calls.some((c) => c.startsWith("herdr worktree remove"))).toBe(false);
    expect((await cli("show", "acme/api#7")).exitCode).toBe(0);
  });
});

describe("relaying the user's words to an Asking Implementer", () => {
  test("answer with relay set to the user's exact words is sent with the answer order off", async () => {
    const { web, world, cli } = await inFlight();
    await cli("say", "--", "Use option 2, the one that keeps the cache");

    const result = await call(web, "answer", { issue: "acme/api#7", relay: "Use option 2, the one that keeps the cache" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ answered: "acme/api#7", agent: "impl-api-7" });
    expect(world.calls).toEqual(["herdr agent list", "herdr agent prompt impl-api-7 Use option 2, the one that keeps the cache"]);
  });

  test("words the user put in quotes can be relayed alone, and an answer to the Lead's question counts as the user's", async () => {
    const { web, world, cli } = await inFlight();
    await cli("say", "--", 'Tell acme/api#7 "keep the old endpoint" and carry on');
    const asked = (await cli("lead", "ask", "--json", "--", "What should acme/api#7 name the flag?")).json().asked;
    await cli("say", "--answer", String(asked), "--", "--retries");

    expect((await call(web, "answer", { issue: "acme/api#7", relay: "keep the old endpoint" })).isError).toBe(false);
    world.agentStates.set("impl-api-7", "blocked");
    expect((await call(web, "answer", { issue: "acme/api#7", relay: "--retries" })).isError).toBe(false);
    expect(world.calls.filter((c) => c.startsWith("herdr agent prompt"))).toEqual([
      "herdr agent prompt impl-api-7 keep the old endpoint",
      "herdr agent prompt impl-api-7 --retries",
    ]);
  });

  test("a relay of words the user never wrote is refused, even with the answer order on, touching nothing", async () => {
    for (const answerOrder of [false, true]) {
      const { web, world, cli } = await inFlight({ answer: answerOrder });
      await cli("say", "--", "Use option 2");
      await cli("lead", "say", "--", "Use option 3");

      for (const relay of ["Use option 3", "option 2", "Use option 2 and delete the tests"]) {
        const result = await call(web, "answer", { issue: "acme/api#7", relay });
        expect(result.isError).toBe(true);
        expect(result.structuredContent.error).toBe("relay must be the user's own words, as written in the conversation");
        expect(result.structuredContent.help).toEqual(expect.arrayContaining([expect.stringContaining("text")]));
      }
      expect(world.calls).toEqual([]);
    }
  });

  test("answer takes text or relay, not both nor neither", async () => {
    const { web } = await inFlight({ answer: true });
    for (const args of [{ issue: "acme/api#7" }, { issue: "acme/api#7", text: "a", relay: "a" }]) {
      const response = await web("/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "answer", arguments: args } }),
      });
      expect(JSON.parse(response.body).error).toEqual({ code: -32602, message: "answer takes text or relay, exactly one" });
    }
  });
});

test("tools/list describes each action tool's Standing order", async () => {
  const { web } = setup();
  const response = await web("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const tools: { name: string; description: string; inputSchema: { required?: string[] } }[] = JSON.parse(response.body).result.tools;
  const describe = (name: string) => tools.find((t) => t.name === name)!.description;
  for (const { tool, order } of [...ACTIONS, { tool: "unqueue", order: "start" }]) {
    expect(describe(tool)).toContain(`Falls under the \`${order}\` Standing order`);
  }
  expect(describe("answer")).toContain("relay");
  expect(tools.find((t) => t.name === "dispatch")!.inputSchema.required).toEqual(["issues", "harness", "model", "effort"]);
});
