import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const SCHEDULER = { harness: "claude", model: "opus", effort: "high" };

/** A Repo claiming Linear team BLE, with the Scheduler defaults set unless `scheduler` is null. */
async function linearRepo(scheduler: Record<string, string> | null = SCHEDULER) {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  if (scheduler) setConfig(ctx.configDir, { scheduler });
  ctx.world.calls.length = 0;
  return ctx;
}

function setConfig(configDir: string, settings: Record<string, unknown>) {
  const file = join(configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...settings }));
}

/** A Linear issue's merged PR in bleentr/pdf-diff: what a finished Dispatch leaves. */
function mergedPr(world: ReturnType<typeof setup>["world"], identifier: string) {
  const number = Number(identifier.split("-")[1]);
  world.linearAttachments.set(identifier, [`https://github.com/bleentr/pdf-diff/pull/${number}`]);
  world.addPr({ repo: "bleentr/pdf-diff", number, headBranch: `nico/${identifier.toLowerCase()}`, state: "merged" });
}

describe("advance", () => {
  test("without Scheduler defaults in config it fails before any outside call, saying what to set", async () => {
    const { cli, world, configDir } = await linearRepo(null);
    const { exitCode, stdout } = await cli("advance", "--json");
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      error: "the Scheduler defaults scheduler.harness, scheduler.model, scheduler.effort are not set",
      help: [`Set "scheduler": {"harness": "claude", "model": "opus", "effort": "high"} (your choice) in ${join(configDir, "config.json")}`],
    });
    expect(world.calls).toEqual([]);
  });

  test("it dispatches a running Spec's next issue with the Scheduler defaults, stacked on the Spec's newest open PR", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", title: "Compare pages" }, { identifier: "BLE-13" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11" });

    const { exitCode, stdout } = await cli("advance");
    expect(exitCode).toBe(0);
    expect(stdout).toBe([
      "specs[1]{spec,repo,result,issue,reason}:",
      "  BLE-10,bleentr/pdf-diff,started,BLE-12,BLE-12 is the first unblocked issue of BLE-10; it stacks on the Spec's newest open PR",
      "help[2]:",
      "  Run `nico-agent show <issue>` to see a Dispatch",
      "  Run `nico-agent` to see the Board",
      "",
    ].join("\n"));
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf --branch nico/ble-12 --base origin/nico/ble-11 --label pdf-diff:BLE-12 --no-focus");
    expect(world.calls).toContain("herdr agent start impl-pdf-diff-ble-12 --kind claude --pane w1:p2 -- --model opus --effort high");
    expect(world.calls.find((c) => c.startsWith("herdr agent prompt"))).toEndWith(
      "as the top of the stacked PRs on top of https://github.com/bleentr/pdf-diff/pull/16 - check gh-stack if you are not aware of github's stacked PRs");
    expect(world.calls.filter((c) => c.startsWith("herdr worktree create"))).toHaveLength(1);
    expect((await cli("show", "BLE-12", "--json")).json()).toMatchObject({ stackedOn: { pr: { url: "https://github.com/bleentr/pdf-diff/pull/16" } } });
  });

  test("a running Spec without an open PR starts from the default branch, and re-running while it Implements is quiet and stable", async () => {
    const { cli, world } = await linearRepo();
    world.defaultBranches.set("/src/pdf", "trunk");
    world.remoteBranches.set("/src/pdf", ["trunk", "beta"]);
    world.addLinearIssue({ identifier: "BLE-99" });
    await cli("dispatch", "BLE-99", "--harness", "claude", "--model", "opus", "--effort", "high", "--base", "beta");
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" }, { identifier: "BLE-13" });
    mergedPr(world, "BLE-11");
    world.calls.length = 0;

    const first = (await cli("advance", "--json")).json();
    expect(first.specs.find((s: { spec: string }) => s.spec === "BLE-10")).toEqual({
      spec: "BLE-10", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-12",
      reason: "BLE-12 is the first unblocked issue of BLE-10; the Spec has no open PR, so it starts from trunk",
    });
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf --branch nico/ble-12 --base origin/trunk --label pdf-diff:BLE-12 --no-focus");

    world.calls.length = 0;
    const again = await cli("advance");
    expect(again).toMatchObject({ exitCode: 0, stdout: "specs: []\nhelp[1]:\n  Run `nico-agent` to see the Board\n" });
    expect((await cli("advance")).stdout).toBe(again.stdout);
    expect(world.calls.filter((c) => c.startsWith("herdr") && c !== "herdr agent list")).toEqual([]);
  });

  test("a Spec whose Dispatch Failed is Held: the Board shows why, advance skips it, and other Specs keep moving", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });
    mergedPr(world, "BLE-11");
    world.failHerdr("agent start", "herdr is not running");

    const failed = await cli("advance", "--json");
    expect(failed.exitCode).toBe(1);
    expect(failed.json()).toEqual({
      specs: [{ spec: "BLE-10", repo: "bleentr/pdf-diff", result: "failed", issue: "BLE-12", reason: "herdr is not running" }],
      help: ["Run `nico-agent show BLE-12` to see the Dispatch", "Run `nico-agent advance` again to resume it", "Run `nico-agent` to see the Board"],
    });

    world.clearFailures();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21", state: "completed" }, { identifier: "BLE-22" });
    mergedPr(world, "BLE-21");
    const board = (await cli("--json")).json();
    expect(board.specs.find((s: { spec: string }) => s.spec === "BLE-10")).toMatchObject({
      running: true, held: { issue: "BLE-12", reason: "BLE-12's Dispatch Failed at agent start: herdr is not running" },
    });
    expect(board.specs.find((s: { spec: string }) => s.spec === "BLE-10").next).toBeUndefined();

    world.calls.length = 0;
    const held = await cli("advance", "--json");
    expect(held.exitCode).toBe(0);
    expect(held.json().specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "skipped", issue: "BLE-12", reason: "Held: BLE-12's Dispatch Failed at agent start: herdr is not running" },
      { spec: "BLE-20", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-22", reason: "BLE-22 is the first unblocked issue of BLE-20; the Spec has no open PR, so it starts from main" },
    ]);
    expect(held.json().help).toContain("Run `nico-agent dispatch BLE-12 --harness claude --model opus --effort high --repo bleentr/pdf-diff` to resume the Failed Dispatch, or `nico-agent close BLE-12` to Close it");
    expect(world.calls.filter((c) => c.startsWith("herdr agent start"))).toEqual(["herdr agent start impl-pdf-diff-ble-22 --kind claude --pane w2:p2 -- --model opus --effort high"]);
  });

  test("resuming the Failed Dispatch clears the hold without any other action", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });
    mergedPr(world, "BLE-11");
    world.failHerdr("agent start", "herdr is not running");
    await cli("advance");
    world.clearFailures();

    const resumed = await cli("dispatch", "BLE-12", "--harness", "claude", "--model", "opus", "--effort", "high", "--repo", "bleentr/pdf-diff", "--json");
    expect(resumed.exitCode).toBe(0);
    const spec = (await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10");
    expect(spec.held).toBeUndefined();
    expect((await cli("advance", "--json")).json()).toEqual({ specs: [], help: ["Run `nico-agent` to see the Board"] });
  });

  test("Closing the Failed Dispatch clears the hold, and the Spec dispatches the issue again", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });
    mergedPr(world, "BLE-11");
    world.failHerdr("agent start", "herdr is not running");
    await cli("advance");
    world.clearFailures();

    expect((await cli("close", "BLE-12", "--confirm")).exitCode).toBe(0);
    expect((await cli("advance", "--json")).json().specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-12", reason: "BLE-12 is the first unblocked issue of BLE-10; the Spec has no open PR, so it starts from main" },
    ]);
  });

  /** BLE-10's BLE-13 stacked by `advance` on BLE-12's PR #17, itself on BLE-11's PR #16; BLE-20 is another running Spec. */
  async function stackedSpec() {
    const ctx = await linearRepo();
    const { cli, world } = ctx;
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", state: "started" }, { identifier: "BLE-13" }, { identifier: "BLE-14" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.linearAttachments.set("BLE-12", ["https://github.com/bleentr/pdf-diff/pull/17"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11" });
    world.addPr({ repo: "bleentr/pdf-diff", number: 17, headBranch: "nico/ble-12", baseBranch: "nico/ble-11" });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21", state: "completed" }, { identifier: "BLE-22" }, { identifier: "BLE-23" });
    mergedPr(world, "BLE-21");
    expect((await cli("advance", "--json")).json().specs.map((s: { result: string; issue: string }) => `${s.result} ${s.issue}`)).toEqual(["started BLE-13", "started BLE-22"]);
    world.linearIssueNamed("BLE-13")!.state = "started";
    world.linearIssueNamed("BLE-22")!.state = "started";
    return ctx;
  }

  test("a Spec whose Stack is built on a PR closed without merging is Held, and other Specs keep moving", async () => {
    const { cli, world } = await stackedSpec();
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state: "closed" });
    world.addPr({ repo: "bleentr/pdf-diff", number: 22, headBranch: "nico/ble-22" });
    world.linearAttachments.set("BLE-22", ["https://github.com/bleentr/pdf-diff/pull/22"]);

    const spec = (await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10");
    expect(spec.held).toEqual({ issue: "BLE-13", reason: "BLE-13's Stack is built on https://github.com/bleentr/pdf-diff/pull/16, closed without merging" });
    world.calls.length = 0;
    const advanced = (await cli("advance", "--json")).json();
    expect(advanced.specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "skipped", issue: "BLE-13", reason: "Held: BLE-13's Stack is built on https://github.com/bleentr/pdf-diff/pull/16, closed without merging" },
      { spec: "BLE-20", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-23", reason: "BLE-23 is the first unblocked issue of BLE-20; it stacks on the Spec's newest open PR" },
    ]);
    expect(advanced.help).toContain("Run `nico-agent close BLE-13` to Close the orphaned Dispatch, or retarget its Stack");
    expect(world.calls.filter((c) => c.startsWith("herdr worktree create"))).toHaveLength(1);
  });

  test("a merged PR below the Stack holds nothing", async () => {
    const { cli, world } = await stackedSpec();
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state: "merged" });
    expect((await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10").held).toBeUndefined();
  });

  test("Closing the orphaned Dispatch clears the hold", async () => {
    const { cli, world } = await stackedSpec();
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state: "closed" });
    expect((await cli("close", "BLE-13", "--confirm")).exitCode).toBe(0);
    expect((await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10").held).toBeUndefined();
  });

  test("the orphaned Dispatch's own PR retargeted off the closed PR clears the hold", async () => {
    const { cli, world } = await stackedSpec();
    world.linearAttachments.set("BLE-13", ["https://github.com/bleentr/pdf-diff/pull/18"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 18, headBranch: "nico/ble-13", baseBranch: "nico/ble-12" });
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state: "closed" });
    expect((await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10").held)
      .toEqual({ issue: "BLE-13", reason: "BLE-13's Stack is built on https://github.com/bleentr/pdf-diff/pull/16, closed without merging" });

    world.addPr({ repo: "bleentr/pdf-diff", number: 17, headBranch: "nico/ble-12", baseBranch: "main" });
    expect((await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10").held).toBeUndefined();
  });

  test("with no running Spec it succeeds quietly with an empty result, and never starts a Spec", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11" });
    world.addLinearIssue({ identifier: "BLE-20" });

    const json = await cli("advance", "--json");
    expect(json.exitCode).toBe(0);
    expect(json.json()).toEqual({ specs: [], help: ["Run `nico-agent` to see the Board"] });
    const toon = await cli("advance");
    expect(toon).toMatchObject({ exitCode: 0, stdout: "specs: []\nhelp[1]:\n  Run `nico-agent` to see the Board\n" });
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);
  });

  test("a running Spec whose next issue waits on another Spec's Blocker is skipped with the reason", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21", state: "started" }, { identifier: "BLE-22" });
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12", blockers: [{ identifier: "BLE-21", state: "started" }] });
    mergedPr(world, "BLE-11");
    world.linearAttachments.set("BLE-21", ["https://github.com/bleentr/pdf-diff/pull/21"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 21, headBranch: "nico/ble-21" });

    const { exitCode, stdout } = await cli("advance", "--json");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "skipped", issue: "BLE-12", reason: "BLE-12 waits for BLE-21, in another Spec, to close; a Stack never mixes Specs" },
      { spec: "BLE-20", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-22", reason: "BLE-22 is the first unblocked issue of BLE-20; it stacks on the Spec's newest open PR" },
    ]);
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf --branch nico/ble-22 --base origin/nico/ble-21 --label pdf-diff:BLE-22 --no-focus");
  });

  test("it starts a running GitHub Spec's next issue, stacked on the Spec's newest open PR", async () => {
    const { cli, world, configDir } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    setConfig(configDir, { scheduler: SCHEDULER });
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
    expect((await cli("dispatch", "acme/api#11", "--harness", "claude", "--model", "opus", "--effort", "high")).exitCode).toBe(0);
    world.linkPr("acme/api", 11, { number: 16, headBranch: "agent/api-11" });
    world.calls.length = 0;

    const { exitCode, stdout } = await cli("advance", "--json");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).specs).toEqual([{
      spec: "acme/api#10", repo: "acme/api", result: "started", issue: "acme/api#12",
      reason: "acme/api#12 is the first unblocked issue of acme/api#10; it stacks on the Spec's newest open PR",
    }]);
    expect(world.calls.find((c) => c.startsWith("herdr worktree create"))).toContain("--base origin/agent/api-11");
    expect(world.calls.find((c) => c.startsWith("herdr agent prompt"))).toContain("on top of https://github.com/acme/api/pull/16");
  });

  test("a GitHub Spec whose Dispatch Failed is Held, with a resume command without --repo", async () => {
    const { cli, world, configDir } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    setConfig(configDir, { scheduler: SCHEDULER });
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
    world.failHerdr("agent start", "herdr is not running");
    expect((await cli("dispatch", "acme/api#11", "--harness", "claude", "--model", "opus", "--effort", "high")).exitCode).toBe(1);
    world.clearFailures();

    const advanced = (await cli("advance", "--json")).json();
    expect(advanced.specs).toEqual([{
      spec: "acme/api#10", repo: "acme/api", result: "skipped", issue: "acme/api#11",
      reason: "Held: acme/api#11's Dispatch Failed at agent start: herdr is not running",
    }]);
    expect(advanced.help).toContain("Run `nico-agent dispatch acme/api#11 --harness claude --model opus --effort high` to resume the Failed Dispatch, or `nico-agent close acme/api#11` to Close it");
  });

  test("Scheduler defaults naming an unknown Harness or model are a config error, not a skipped Spec", async () => {
    const { cli, world, configDir } = await linearRepo({ harness: "claude", model: "gpt-9", effort: "high" });
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });
    mergedPr(world, "BLE-11");

    const { exitCode, stdout } = await cli("advance", "--json");
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      error: `scheduler.model in ${join(configDir, "config.json")}: unknown model \`gpt-9\` for claude`,
      help: ["Valid models for claude: fable, opus, sonnet, haiku"],
    });
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);

    setConfig(configDir, { scheduler: { harness: 7 } });
    expect((await cli("advance", "--json")).json()).toEqual({
      error: `${join(configDir, "config.json")}: scheduler.harness is not a string`,
      help: ["Fix or delete the file and run `nico-agent repo add` again"],
    });
  });

  test("the Scheduler defaults survive `repo add` rewriting the config", async () => {
    const { cli, world, configDir } = await linearRepo();
    world.addClone("/src/web", "https://github.com/bleentr/web.git");
    await cli("repo", "add", "bleentr/web", "--path", "/src/web");
    expect(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).scheduler).toEqual(SCHEDULER);
  });
});
