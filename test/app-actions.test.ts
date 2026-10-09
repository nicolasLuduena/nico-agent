import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { type HarnessesJson, advanceReport, batchPlan, closePlan, dispatchTarget, harnessWarnings, launchArgs, launchChoice, outcomeOf } from "../src/app/actions";
import type { BoardJson } from "../src/app/board";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return {
    ...ctx,
    board: async (): Promise<BoardJson> => (await ctx.cli("board", "--json")).json(),
    harnesses: async (): Promise<HarnessesJson> => JSON.parse((await ctx.web("/api/harnesses")).body),
  };
}

/** A Repo with issues 1 and 2 Ready, and 3 and 4 dispatched, 3 with an open PR. */
async function mixed() {
  const ctx = await githubRepo();
  for (const number of [1, 2, 3, 4]) ctx.world.addIssue("acme/api", { number });
  await ctx.cli("dispatch", "acme/api#3", ...FLAGS);
  await ctx.cli("dispatch", "acme/api#4", ...FLAGS);
  ctx.world.linkPr("acme/api", 3, { number: 13 });
  return ctx;
}

describe("the app's launch forms: Harness, model and Effort", () => {
  test("offer every Harness with models, starting on the first model's first Effort", async () => {
    const { harnesses } = await githubRepo();
    expect(launchChoice(await harnesses(), {})).toMatchObject({
      harnesses: ["claude", "codex", "opencode2"], harness: "claude", model: "fable", efforts: CLAUDE_EFFORTS, effort: "low",
    });
  });

  test("a chosen model offers only its own Efforts, falling back to its first", async () => {
    const { harnesses } = await githubRepo();
    expect(launchChoice(await harnesses(), { harness: "codex", model: "gpt-5.5", effort: "ultra" }))
      .toMatchObject({ harness: "codex", model: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"], effort: "low" });
  });

  test("switching Harness falls back to its first model, keeping the Effort while still valid", async () => {
    const { harnesses } = await githubRepo();
    expect(launchChoice(await harnesses(), { harness: "claude", model: "gpt-5.5", effort: "high" })).toMatchObject({ model: "fable", effort: "high" });
  });

  test("start on the last launch, with the Effort last used with each model", async () => {
    const { cli, world, harnesses } = await githubRepo();
    world.addIssue("acme/api", { number: 7 });
    world.addIssue("acme/api", { number: 8 });
    await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "sonnet", "--effort", "max");
    await cli("dispatch", "acme/api#8", "--harness", "codex", "--model", "gpt-6-sol", "--effort", "xhigh");
    const json = await harnesses();
    expect(launchChoice(json, {})).toMatchObject({ harness: "codex", model: "gpt-6-sol", effort: "xhigh" });
    expect(launchChoice(json, { harness: "claude", model: "sonnet" })).toMatchObject({ effort: "max" });
    expect(launchChoice(json, { harness: "codex", model: "gpt-5.5" })).toMatchObject({ effort: "low" });
  });

  test("a Harness whose discovery failed is left out, its error a warning", async () => {
    const { world, harnesses } = await githubRepo();
    world.failCall("codex debug models", "`codex` is not installed or not on PATH");
    const json = await harnesses();
    expect(launchChoice(json, {})!.harnesses).toEqual(["claude", "opencode2"]);
    expect(harnessWarnings(json)).toEqual(["could not discover codex models: `codex` is not installed or not on PATH"]);
  });

  test("no Harness with models, no form", () => {
    expect(launchChoice({ harnesses: [{ name: "claude", models: [] }], remembered: { efforts: {} } }, {})).toBeNull();
  });
});

describe("the app's launch forms: what they post", () => {
  test("a Ready issue's dispatch starts from its Base, or the one chosen while origin has it", async () => {
    const { world, board, harnesses } = await githubRepo();
    world.remoteBranches.set("/src/api", ["beta", "main"]);
    world.addIssue("acme/api", { number: 7 });
    const target = dispatchTarget(await board(), "acme/api#7", "acme/api")!;
    expect(target).toEqual({ issue: "acme/api#7", base: { branches: ["beta", "main"], selected: "main" } });
    const choice = launchChoice(await harnesses(), { harness: "claude", model: "opus", effort: "high" })!;
    expect(launchArgs("dispatch", target, choice, {})).toEqual(["acme/api#7", ...FLAGS, "--base", "main"]);
    expect(launchArgs("dispatch", target, choice, { base: "beta" })).toEqual(["acme/api#7", ...FLAGS, "--base", "beta"]);
    expect(launchArgs("dispatch", target, choice, { base: "gone" })).toEqual(["acme/api#7", ...FLAGS, "--base", "main"]);
  });

  test("a Linear issue's dispatch names the Repo of its row", async () => {
    const { cli, world, board, harnesses } = await githubRepo();
    await cli("repo", "add", "acme/api", "--path", "/src/api", "--linear-team", "BLE");
    world.addLinearIssue({ identifier: "BLE-27", title: "Search" });
    const target = dispatchTarget(await board(), "BLE-27", "acme/api")!;
    expect(target).toMatchObject({ issue: "BLE-27", repo: "acme/api" });
    expect(launchArgs("dispatch", target, launchChoice(await harnesses(), { harness: "claude", model: "opus", effort: "high" })!, {}))
      .toEqual(["BLE-27", ...FLAGS, "--repo", "acme/api", "--base", "main"]);
  });

  test("a Stackable issue's dispatch stacks on its first Blocker PR, or the one chosen, and has no Base", async () => {
    const { world, board, harnesses } = await githubRepo();
    world.addIssue("acme/api", { number: 5, labels: [] });
    world.addIssue("acme/api", { number: 6, labels: [] });
    world.linkPr("acme/api", 5, { number: 40, headBranch: "agent/api-5" });
    world.linkPr("acme/api", 6, { number: 41, headBranch: "agent/api-6" });
    world.linkPr("acme/api", 6, { number: 42, headBranch: "agent/api-6b" });
    world.addIssue("acme/api", { number: 7, blockers: [{ slug: "acme/api", number: 5, state: "open" }, { slug: "acme/api", number: 6, state: "open" }] });
    const target = dispatchTarget(await board(), "acme/api#7", "acme/api")!;
    expect(target.stack).toEqual([
      { value: "acme/api#5", label: "acme/api#5 · PR #40 · base agent/api-5" },
      // A Blocker with several PRs is named by the PR's URL.
      { value: "https://github.com/acme/api/pull/41", label: "acme/api#6 · PR #41 · base agent/api-6" },
      { value: "https://github.com/acme/api/pull/42", label: "acme/api#6 · PR #42 · base agent/api-6b" },
    ]);
    const choice = launchChoice(await harnesses(), { harness: "claude", model: "opus", effort: "high" })!;
    expect(launchArgs("dispatch", target, choice, {})).toEqual(["acme/api#7", ...FLAGS, "--stack-on", "acme/api#5"]);
    expect(launchArgs("dispatch", target, choice, { stackOn: "https://github.com/acme/api/pull/42" }))
      .toEqual(["acme/api#7", ...FLAGS, "--stack-on", "https://github.com/acme/api/pull/42"]);
  });

  test("a review posts the issue and the launch", async () => {
    const { harnesses } = await githubRepo();
    const choice = launchChoice(await harnesses(), { harness: "claude", model: "sonnet", effort: "max" })!;
    expect(launchArgs("review", { issue: "acme/api#3" }, choice, {})).toEqual(["acme/api#3", "--harness", "claude", "--model", "sonnet", "--effort", "max"]);
  });

  test("a choice in progress outlives the Board it was made on", async () => {
    const { world, board, harnesses } = await githubRepo();
    world.remoteBranches.set("/src/api", ["beta", "main"]);
    world.addIssue("acme/api", { number: 7 });
    const chosen = { harness: "codex", model: "gpt-5.5", effort: "high", base: "beta" };
    const before = launchArgs("dispatch", dispatchTarget(await board(), "acme/api#7", "acme/api")!, launchChoice(await harnesses(), chosen)!, chosen);
    // Something else changes on the Board, and the app fetches it again.
    world.addIssue("acme/api", { number: 8 });
    const after = launchArgs("dispatch", dispatchTarget(await board(), "acme/api#7", "acme/api")!, launchChoice(await harnesses(), chosen)!, chosen);
    expect(after).toEqual(before);
    expect(after).toEqual(["acme/api#7", "--harness", "codex", "--model", "gpt-5.5", "--effort", "high", "--base", "beta"]);
  });
});

describe("the app's batch actions", () => {
  test("each action counts the ticked issues it applies to", async () => {
    const { board } = await mixed();
    const plan = batchPlan(await board(), ["acme/api#1", "acme/api#2", "acme/api#3", "acme/api#4"]);
    expect(plan.dispatch.map((t) => t.issue)).toEqual(["acme/api#1", "acme/api#2"]);
    expect(plan.review).toEqual(["acme/api#3"]);
    expect(plan.close).toEqual(["acme/api#3", "acme/api#4"]);
  });

  test("Review leaves out an issue that has a Reviewer, is Failed or has no PR, saying why", async () => {
    const { cli, board } = await mixed();
    await cli("review", "acme/api#3", "--harness", "claude", "--model", "sonnet", "--effort", "max");
    const plan = batchPlan(await board(), ["acme/api#3", "acme/api#4", "acme/api#1"]);
    expect(plan.review).toEqual([]);
    expect(plan.skipped.review).toEqual(["acme/api#3: acme/api#3 already has a Reviewer", "acme/api#4: no PR is linked to acme/api#4 yet", "acme/api#1: acme/api#1 is not In flight"]);
    expect(plan.skipped.dispatch).toEqual(["acme/api#3: acme/api#3 is already In flight", "acme/api#4: acme/api#4 is already In flight"]);
  });

  test("an issue no longer on the Board is not counted", async () => {
    const { board } = await mixed();
    const plan = batchPlan(await board(), ["acme/api#99"]);
    expect([plan.dispatch, plan.review, plan.close]).toEqual([[], [], []]);
  });

  test("Close closes the issues with a PR straight away and asks to confirm the rest", async () => {
    const { board } = await mixed();
    expect(closePlan(await board(), ["acme/api#3", "acme/api#4"])).toEqual({ now: ["acme/api#3"], confirm: ["acme/api#4"] });
  });
});

describe("the app's action outcomes", () => {
  test("a failed action shows the CLI's message and help", () => {
    expect(outcomeOf({ error: "acme/api#4 has no PR yet; closing requires confirmation", help: ["Run `nico-agent close acme/api#4 --confirm` to remove its workspace"] }))
      .toEqual({ failed: true, lines: [{ text: "acme/api#4 has no PR yet; closing requires confirmation", error: true }], help: ["Run `nico-agent close acme/api#4 --confirm` to remove its workspace"] });
  });

  test("several issues report a line each, and help when one failed", async () => {
    const { web, world, cli } = await mixed();
    world.failCall("herdr worktree create --cwd /src/api --branch agent/api-2 ", "worktree already exists");
    const response = await web("/api/dispatch", { method: "POST", body: JSON.stringify({ args: ["acme/api#1", "acme/api#2", ...FLAGS] }) });
    const outcome = outcomeOf(JSON.parse(response.body));
    expect(outcome.failed).toBe(true);
    expect(outcome.lines).toEqual([
      { text: "acme/api#1: dispatched", error: false },
      { text: "acme/api#2: failed, worktree already exists", error: true },
    ]);
    expect(outcome.help.length).toBeGreaterThan(0);
    expect((await cli("show", "acme/api#2", "--json")).json().stage).toBe("Failed at worktree");
  });

  test("a done action has nothing to say", async () => {
    expect(outcomeOf({ closed: "acme/api#3", help: ["Run `nico-agent` to see the Board"] })).toEqual({ failed: false, lines: [], help: [] });
  });
});

describe("the app's Advance now", () => {
  /** A Repo claiming Linear team BLE, with the Scheduler defaults set. */
  async function linearRepo() {
    const ctx = setup();
    ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
    await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
    const file = join(ctx.configDir, "config.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), scheduler: { harness: "claude", model: "opus", effort: "high" } }));
    const advance = async () => JSON.parse((await ctx.web("/api/advance", { method: "POST", body: "{}" })).body);
    return { ...ctx, advance };
  }

  test("reports what advance did, a line per Spec", async () => {
    const { world, cli, advance } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" }, { identifier: "BLE-21", title: "Tokens" });
    await cli("queue", "BLE-20", "--repo", "bleentr/pdf-diff");
    const report = advanceReport(await advance());
    expect(report.lines).toMatchObject([{ result: "started", text: expect.stringMatching(/^BLE-21 of BLE-20: BLE-20 is the head of the Queue;/) }]);
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(true);
  });

  test("with nothing to do, says so", async () => {
    const { advance } = await linearRepo();
    expect(advanceReport(await advance()).lines).toEqual([{ result: "empty", text: "Nothing to do: no running Spec needs a step and no queued Spec could start." }]);
  });

  test("an error stopping the run shows with its help", async () => {
    const { world, cli, configDir, advance } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    await cli("queue", "BLE-20", "--repo", "bleentr/pdf-diff");
    const file = join(configDir, "config.json");
    const { scheduler: _, ...config } = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify(config));
    const report = advanceReport(await advance());
    expect(report.lines).toMatchObject([{ result: "failed", text: expect.stringContaining("the Scheduler defaults") }]);
    expect(report.help).toEqual([expect.stringContaining('"scheduler"')]);
  });

  test("while another advance runs, says it left it to finish", async () => {
    const { world, cli, configDir, advance } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    await cli("queue", "BLE-20", "--repo", "bleentr/pdf-diff");
    writeFileSync(join(configDir, "advance.lock"), "777");
    const report = advanceReport(await advance());
    expect(report.lines.map((l) => l.text).join("\n")).toContain("another advance is running (pid 777); left it to finish");
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);
  });
});
