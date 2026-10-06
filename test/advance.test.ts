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

  test("a running Spec without an open PR starts from the default branch, and re-running is a no-op while it Implements", async () => {
    const { cli, world } = await linearRepo();
    world.defaultBranches.set("/src/pdf", "trunk");
    world.remoteBranches.set("/src/pdf", ["trunk", "beta"]);
    world.addLinearIssue({ identifier: "BLE-99" });
    await cli("dispatch", "BLE-99", "--harness", "claude", "--model", "opus", "--effort", "high", "--base", "beta");
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" }, { identifier: "BLE-13" });
    world.calls.length = 0;

    const first = (await cli("advance", "--json")).json();
    expect(first.specs.find((s: { spec: string }) => s.spec === "BLE-10")).toEqual({
      spec: "BLE-10", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-12",
      reason: "BLE-12 is the first unblocked issue of BLE-10; the Spec has no open PR, so it starts from trunk",
    });
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf --branch nico/ble-12 --base origin/trunk --label pdf-diff:BLE-12 --no-focus");

    world.calls.length = 0;
    const again = await cli("advance", "--json");
    expect(again.exitCode).toBe(0);
    expect(again.json().specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "skipped", issue: "BLE-12", reason: "BLE-12 is Implementing; a Spec has one Implementer at a time" },
      { spec: "BLE-99", repo: "bleentr/pdf-diff", result: "skipped", issue: "BLE-99", reason: "BLE-99 is Implementing; a Spec has one Implementer at a time" },
    ]);
    expect(world.calls.filter((c) => c.startsWith("herdr") && c !== "herdr agent list")).toEqual([]);
  });

  test("a Dispatch that failed at a step is resumed from it on the next run, with its own launch", async () => {
    const { cli, world, configDir } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });
    world.failHerdr("agent start", "herdr is not running");

    const failed = await cli("advance", "--json");
    expect(failed.exitCode).toBe(1);
    expect(failed.json()).toEqual({
      specs: [{ spec: "BLE-10", repo: "bleentr/pdf-diff", result: "failed", issue: "BLE-12", reason: "herdr is not running" }],
      help: ["Run `nico-agent show BLE-12` to see the Dispatch", "Run `nico-agent advance` again to resume it", "Run `nico-agent` to see the Board"],
    });

    world.clearFailures();
    setConfig(configDir, { scheduler: { harness: "claude", model: "sonnet", effort: "low" } });
    world.calls.length = 0;
    const resumed = await cli("advance", "--json");
    expect(resumed.exitCode).toBe(0);
    expect(resumed.json().specs).toEqual([{ spec: "BLE-10", repo: "bleentr/pdf-diff", result: "resumed", issue: "BLE-12", reason: "BLE-12 resumed from agent start" }]);
    expect(world.calls).toContain("herdr agent start impl-pdf-diff-ble-12 --kind claude --pane w1:p2 -- --model opus --effort high");
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);
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

  test("Scheduler defaults naming an unknown Harness or model are a config error, not a skipped Spec", async () => {
    const { cli, world, configDir } = await linearRepo({ harness: "claude", model: "gpt-9", effort: "high" });
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });

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
