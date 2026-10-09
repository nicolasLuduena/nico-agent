import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** acme/api#7 dispatched, its Implementer's screen showing a test run. */
async function dispatched() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  expect((await ctx.cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
  ctx.world.screens.set("impl-api-7", "$ bun test\n 3 pass\n 1 fail\n\n");
  ctx.world.calls.length = 0;
  return ctx;
}

/** A tool call POSTed to /mcp, answering its result. */
async function call(web: ReturnType<typeof setup>["web"], name: string, args: Record<string, unknown> = {}) {
  const response = await web("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return JSON.parse(response.body) as { result?: { structuredContent: Record<string, unknown>; isError: boolean }; error?: { message: string } };
}

describe("nico-agent peek", () => {
  test("returns the screen of an In-flight issue's Implementer", async () => {
    const { cli, world } = await dispatched();
    const result = await cli("peek", "acme/api#7", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      issue: "acme/api#7",
      agent: "impl-api-7",
      screen: "$ bun test\n 3 pass\n 1 fail",
      help: ["Run `nico-agent show acme/api#7` to see the Dispatch", "Run `nico-agent` to see the Board"],
    });
    expect(world.calls).toEqual(["herdr agent read impl-api-7 --source visible"]);
  });

  test("returns the Reviewer's screen with --reviewer once one runs, and refuses it before", async () => {
    const { cli, world } = await dispatched();
    const before = await cli("peek", "acme/api#7", "--reviewer", "--json");
    expect(before.exitCode).toBe(1);
    expect(before.json()).toEqual({
      error: "acme/api#7 has no Reviewer",
      help: ["Run `nico-agent review acme/api#7 --harness <harness> --model <model> --effort <effort>` to start one", "Run `nico-agent peek acme/api#7` for its Implementer"],
    });

    world.linkPr("acme/api", 7, { number: 9 });
    expect((await cli("review", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
    world.screens.set("rev-api-7", "Reviewing PR #9: 2 findings");
    const result = await cli("peek", "acme/api#7", "--reviewer", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ issue: "acme/api#7", agent: "rev-api-7", screen: "Reviewing PR #9: 2 findings" });
  });

  test("an issue that is not In flight is refused with help", async () => {
    const { cli, world } = await dispatched();
    world.addIssue("acme/api", { number: 8 });
    const result = await cli("peek", "acme/api#8", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json()).toEqual({
      error: "acme/api#8 is not In flight",
      help: ["Run `nico-agent` to see the Board and what is In flight", "Run `nico-agent peek` with no issue for the Lead's own screen"],
    });
    expect(world.calls).toEqual([]);
  });

  test("with no issue, returns the Lead's own screen", async () => {
    const { cli, world } = await dispatched();
    world.screens.set("lead", "Reading the Inbox");
    const result = await cli("peek", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({ agent: "lead", screen: "Reading the Inbox", help: ["Run `nico-agent lead status` to see the Lead"] });
  });

  test("a screen herdr cannot read is an error", async () => {
    const { cli, world } = await dispatched();
    world.failHerdr("agent read", "agent_not_found: impl-api-7");
    const result = await cli("peek", "acme/api#7", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json()).toEqual({ error: "agent_not_found: impl-api-7" });
  });
});

describe("the Lead's peek tool", () => {
  test("runs `nico-agent peek`, for the Implementer, the Reviewer, or the Lead itself", async () => {
    const { web, world } = await dispatched();
    const implementer = await call(web, "peek", { issue: "acme/api#7" });
    expect(implementer.result!.isError).toBe(false);
    expect(implementer.result!.structuredContent).toMatchObject({ agent: "impl-api-7", screen: "$ bun test\n 3 pass\n 1 fail" });

    const reviewer = await call(web, "peek", { issue: "acme/api#7", reviewer: true });
    expect(reviewer.result!.isError).toBe(true);
    expect(reviewer.result!.structuredContent.error).toBe("acme/api#7 has no Reviewer");

    world.screens.set("lead", "Thinking");
    const lead = await call(web, "peek");
    expect(lead.result!.structuredContent).toMatchObject({ agent: "lead", screen: "Thinking" });
  });

  test("an unknown issue is refused with help", async () => {
    const { web } = await dispatched();
    const result = await call(web, "peek", { issue: "acme/api#8" });
    expect(result.result!.isError).toBe(true);
    expect(result.result!.structuredContent).toMatchObject({ error: "acme/api#8 is not In flight" });
    expect((result.result!.structuredContent.help as string[]).length).toBeGreaterThan(0);
  });

  test("reviewer without an issue is an invalid call", async () => {
    const { web } = await dispatched();
    expect((await call(web, "peek", { reviewer: true })).error!.message).toBe("peek's reviewer needs an issue");
  });
});
