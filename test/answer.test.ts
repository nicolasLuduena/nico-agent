import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** acme/api#11 dispatched, as the first issue of Spec acme/api#10. */
async function dispatched() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
  expect((await ctx.cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
  ctx.world.calls.length = 0;
  return ctx;
}

/** acme/api#11 dispatched, and acme/api's Gardener started on claude. */
async function gardening() {
  const ctx = await dispatched();
  const file = join(ctx.configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), gardener: { harness: "claude", model: "opus", effort: "high" } }));
  expect((await ctx.cli("garden", "acme/api")).exitCode).toBe(0);
  ctx.world.calls.length = 0;
  return ctx;
}

describe("nico-agent answer", () => {
  test("submits the text, verbatim, to an Implementer waiting on the user", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    const text = "Close it: the work is done in #48.  Thanks!";

    const result = await cli("answer", "acme/api#11", "--json", "--", text);
    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      answered: "acme/api#11",
      agent: "impl-api-11",
      help: ["Run `nico-agent show acme/api#11` to see the Dispatch", "Run `nico-agent` to see the Board"],
    });
    expect(world.calls).toEqual(["herdr agent list", `herdr agent prompt impl-api-11 ${text}`]);
  });

  test("joins the words of an unquoted answer, and takes a GitHub issue URL", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    const result = await cli("answer", "https://github.com/acme/api/issues/11", "2", "please");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith("answered: acme/api#11\n");
    expect(world.calls).toContain("herdr agent prompt impl-api-11 2 please");
  });

  test("refuses an Implementer that is not waiting on the user, and a second answer to the same question", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "working");
    const refused = await cli("answer", "acme/api#11", "yes", "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json()).toEqual({
      error: "acme/api#11's Implementer is not waiting on the user (it is working)",
      help: ["Run `herdr agent read impl-api-11` to see what it is doing", "Run `nico-agent` to see the Board"],
    });
    expect(world.calls).toEqual(["herdr agent list"]);

    world.agentStates.set("impl-api-11", "blocked");
    expect((await cli("answer", "acme/api#11", "yes")).exitCode).toBe(0);
    world.calls.length = 0;
    const again = await cli("answer", "acme/api#11", "yes", "--json");
    expect(again.exitCode).toBe(1);
    expect(again.json().error).toBe("acme/api#11's Implementer is not waiting on the user (it is working)");
    expect(world.calls.some((c) => c.startsWith("herdr agent prompt"))).toBe(false);
  });

  test("refuses an Implementer herdr doesn't report", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.delete("impl-api-11");
    const refused = await cli("answer", "acme/api#11", "yes", "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().error).toBe("acme/api#11's Implementer is not waiting on the user (it is unknown)");
  });

  test("refuses an issue with no Dispatch, as when it was Closed", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 11, { number: 16 });
    expect((await cli("close", "acme/api#11")).exitCode).toBe(0);
    world.calls.length = 0;

    const refused = await cli("answer", "acme/api#11", "yes", "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json()).toEqual({
      error: "acme/api#11 has no Dispatch (it was never dispatched, or was Closed)",
      help: ["Run `nico-agent` to see the Board and which agents are waiting on you"],
    });
    expect(world.calls).toEqual([]);
  });

  test("says when the Implementer got the answer but did not start working", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    world.stallPrompts(1);
    const result = await cli("answer", "acme/api#11", "yes", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({
      answered: "acme/api#11",
      warning: "the answer was submitted, but the Implementer has not started working",
    });
    expect(result.json().help).toContain("Run `herdr agent read impl-api-11` to see whether it took the answer");
  });

  test("an answer leaves the Dispatch as it is, even once the Implementer finishes without a PR", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    expect((await cli("answer", "acme/api#11", "Stop: it is already done")).exitCode).toBe(0);
    world.agentStates.set("impl-api-11", "idle");
    expect((await cli("show", "acme/api#11", "--json")).json()).toMatchObject({ issue: "acme/api#11", stage: "Implementing" });
  });

  test("needs an issue and a non-empty text", async () => {
    const { cli, world } = await dispatched();
    for (const argv of [["answer"], ["answer", "acme/api#11"], ["answer", "acme/api#11", ""]]) {
      const result = await cli(...argv, "--json");
      expect(result.exitCode).toBe(2);
      expect(result.json().help).toEqual(["Usage: `nico-agent answer <issue|repo> <text>`"]);
    }
    expect(world.calls).toEqual([]);
  });

  test("a Repo answers its Gardener while it waits on the user", async () => {
    const { cli, world } = await gardening();
    world.agentStates.set("garden-api", "blocked");
    const result = await cli("answer", "acme/api", "--json", "--", "Keep both changes");
    expect(result.exitCode).toBe(0);
    expect(result.json()).toEqual({
      answered: "acme/api",
      agent: "garden-api",
      help: ["Run `herdr agent read garden-api` to see the Gardener", "Run `nico-agent` to see the Board"],
    });
    expect(world.calls).toEqual(["herdr agent list", "herdr agent prompt garden-api Keep both changes"]);

    world.agentStates.set("garden-api", "working");
    const refused = await cli("answer", "acme/api", "again", "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().error).toBe("acme/api's Gardener is not waiting on the user (it is working)");
  });

  test("refuses a Repo with no Gardener", async () => {
    const { cli, world } = await dispatched();
    const refused = await cli("answer", "acme/api", "yes", "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json()).toEqual({
      error: "acme/api has no Gardener",
      help: ["Run `nico-agent` to see the Board and which agents are waiting on you"],
    });
    expect(world.calls).toEqual([]);
  });

  test("--help documents it", async () => {
    const { cli } = setup();
    const help = (await cli("answer", "--help", "--json")).json();
    expect(help.usage).toBe("nico-agent answer <issue|repo> <text>");
    expect(help.examples).toContain("nico-agent answer acme/api#7 \"2\"");
  });
});

describe("the Board's asking list", () => {
  test("lists each Implementer waiting on the user, with its issue, Spec and question cut to its last lines", async () => {
    const { cli, world } = await dispatched();
    world.addIssue("acme/api", { number: 7 });
    expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
    world.agentStates.set("impl-api-11", "blocked");
    world.agentStates.set("impl-api-7", "blocked");
    const filler = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    world.screens.set("impl-api-11", `${filler}\nThis issue looks done already. What should I do?\n 1. Stop\n 2. Carry on\n\n\n`);
    world.screens.set("impl-api-7", "Allow `rm -rf build`? (y/n)");
    world.calls.length = 0;

    const board = (await cli("--json")).json();
    const [api11, api7] = board.asking;
    expect(api11.issue).toBe("acme/api#11");
    expect(api11.spec).toBe("acme/api#10");
    expect(api11.question).toEndWith("This issue looks done already. What should I do?\n 1. Stop\n 2. Carry on");
    expect(api11.question.split("\n")).toHaveLength(20);
    // An issue outside any Spec is its own Spec, which says nothing.
    expect(api7).toEqual({ issue: "acme/api#7", question: "Allow `rm -rf build`? (y/n)" });
    expect(world.calls.filter((c) => c.startsWith("herdr agent read"))).toEqual([
      "herdr agent read impl-api-11 --source visible",
      "herdr agent read impl-api-7 --source visible",
    ]);
    expect(board.help).toContain("Run `nico-agent answer <issue> <text>` to answer an Implementer waiting on you");
  });

  test("lists a Gardener waiting on the user, by its Repo", async () => {
    const { cli, world } = await gardening();
    world.agentStates.set("garden-api", "blocked");
    world.screens.set("garden-api", "Both sides rename `retry`. Which name wins?");
    const board = (await cli("--json")).json();
    expect(board.asking).toEqual([{ gardener: "acme/api", question: "Both sides rename `retry`. Which name wins?" }]);
    expect(board.help).toContain("Run `nico-agent answer <repo> <text>` to answer a Gardener waiting on you");
  });

  test("names a Linear issue's Spec too", async () => {
    const { cli, world } = setup();
    world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" });
    expect((await cli("dispatch", "BLE-11", ...FLAGS)).exitCode).toBe(0);
    const [agent] = [...world.agentStates.keys()];
    world.agentStates.set(agent!, "blocked");
    world.screens.set(agent!, "Which one?");
    expect((await cli("--json")).json().asking).toEqual([{ issue: "BLE-11", spec: "BLE-10", question: "Which one?" }]);
    expect((await cli("answer", "BLE-11", "the first")).exitCode).toBe(0);
    expect(world.calls).toContain(`herdr agent prompt ${agent} the first`);
  });

  test("cuts a long question to its last characters", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    world.screens.set("impl-api-11", `${"x".repeat(5000)}\nWhich one?`);
    const { question } = (await cli("--json")).json().asking[0];
    expect(question.length).toBeLessThanOrEqual(1000);
    expect(question).toStartWith("…");
    expect(question).toEndWith("\nWhich one?");
  });

  test("a screen that can't be read still lists the Implementer, with why", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    world.failHerdr("agent read", "herdr is not running");
    const board = await cli("--json");
    expect(board.exitCode).toBe(0);
    expect(board.json().asking).toEqual([{ issue: "acme/api#11", spec: "acme/api#10", question: "", error: "herdr is not running" }]);
  });

  test("reads no screen when no Implementer waits on the user, and a Reviewer's wait is not asking", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 11, { number: 16 });
    expect((await cli("review", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
    world.agentStates.set("impl-api-11", "working");
    world.agentStates.set("rev-api-11", "blocked");
    world.calls.length = 0;
    const board = (await cli("--json")).json();
    expect(board.asking).toBeUndefined();
    expect(world.calls.some((c) => c.startsWith("herdr agent read"))).toBe(false);
  });

  test("is left out of the TOON Board", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-11", "blocked");
    world.screens.set("impl-api-11", "Which one?");
    world.calls.length = 0;
    const { stdout } = await cli();
    expect(stdout).not.toContain("asking");
    expect(world.calls.some((c) => c.startsWith("herdr agent read"))).toBe(false);
  });
});
