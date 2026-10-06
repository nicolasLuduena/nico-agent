import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** A Repo claiming Linear team BLE, with the Scheduler defaults set. */
async function linearRepo(repo: Record<string, unknown> = {}) {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  const file = join(ctx.configDir, "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.scheduler = { harness: "claude", model: "opus", effort: "high" };
  config.repos[0] = { ...config.repos[0], ...repo };
  writeFileSync(file, JSON.stringify(config));
  ctx.world.calls.length = 0;
  return ctx;
}

describe("room per Repo", () => {
  test("the Board shows per Repo the running Specs, the room left, and the candidate Specs with their bodies", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/11"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 11, headBranch: "nico/ble-11" });
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser", body: "## Problem\nParsing is slow." },
      { identifier: "BLE-21" }, { identifier: "BLE-22" });
    world.addLinearIssue({ identifier: "BLE-30", title: "A bug from triage", body: "It crashes." });
    world.addLinearSpec({ identifier: "BLE-40", title: "Not ready" }, { identifier: "BLE-41", labels: [] });

    const { rooms } = (await cli("--json")).json();
    expect(rooms).toEqual([{
      repo: "bleentr/pdf-diff", running: ["BLE-10"], room: 1,
      candidates: [
        { spec: "BLE-20", title: "Parser", url: "https://linear.app/bleentr/issue/BLE-20/title", issue: "BLE-21", body: "## Problem\nParsing is slow." },
        { spec: "BLE-30", title: "A bug from triage", url: "https://linear.app/bleentr/issue/BLE-30/title", issue: "BLE-30", body: "It crashes." },
      ],
    }]);
  });

  test("the cap is read per Repo from config, and a Spec whose issues all have PRs or that only waits on another Spec's merges frees its slot", async () => {
    const { cli, world } = await linearRepo({ runningSpecs: 1 });
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/11"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 11, headBranch: "nico/ble-11" });

    const full = (await cli("--json")).json().rooms[0];
    expect(full).toMatchObject({ running: ["BLE-10"], room: 0 });

    world.linearIssueNamed("BLE-12").state = "started";
    world.linearAttachments.set("BLE-12", ["https://github.com/bleentr/pdf-diff/pull/12"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 12, headBranch: "nico/ble-12" });
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: [], room: 1 });

    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31", state: "completed" }, { identifier: "BLE-32", blockers: [{ identifier: "BLE-21", state: "unstarted" }] });
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: [], room: 1 });
  });

  test("a stalled Spec frees its slot only when every remaining issue waits on another Spec, directly or through a Blocker in its own Spec", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31", state: "started" },
      { identifier: "BLE-32", blockers: [{ identifier: "BLE-21", state: "unstarted" }] }, { identifier: "BLE-33", labels: [] });
    world.linearAttachments.set("BLE-31", ["https://github.com/bleentr/pdf-diff/pull/31"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 31, headBranch: "nico/ble-31" });

    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: ["BLE-30"], room: 1 });

    world.linearIssueNamed("BLE-33").blockers = [{ identifier: "BLE-32", state: "unstarted" }];
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: [], room: 2 });
  });

  test("a GitHub candidate Spec carries its body too", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addGitHubSpec("acme/api", { number: 10, title: "Retries", body: "Retry failed calls." }, { number: 11 });

    expect((await cli("--json")).json().rooms).toEqual([{
      repo: "acme/api", running: [], room: 2,
      candidates: [{ spec: "acme/api#10", title: "Retries", url: "https://github.com/acme/api/issues/10", issue: "acme/api#11", body: "Retry failed calls." }],
    }]);
  });

  test("a running-Specs cap that is not a positive integer is a config error", async () => {
    const { cli, configDir } = await linearRepo({ runningSpecs: 0 });
    expect((await cli("--json")).json()).toEqual({
      error: `${join(configDir, "config.json")}: repos[0].runningSpecs is not a positive integer`,
      help: ["Fix or delete the file and run `nico-agent repo add` again"],
    });
  });
});

describe("advance --start", () => {
  test("it starts a candidate Spec's first issue from the default branch when its Repo has room, and keeps the running ones moving", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/11"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 11, headBranch: "nico/ble-11" });
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" }, { identifier: "BLE-21" }, { identifier: "BLE-22" });

    const { exitCode, stdout } = await cli("advance", "--start", "BLE-20", "--json");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-12",
        reason: "BLE-12 is the first unblocked issue of BLE-10; it stacks on the Spec's newest open PR" },
      { spec: "BLE-20", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-21",
        reason: "BLE-21 is the first unblocked issue of BLE-20; the Spec has no open PR, so it starts from main" },
    ]);
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf --branch nico/ble-21 --base origin/main --label pdf-diff:BLE-21 --no-focus");
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: ["BLE-10", "BLE-20"], room: 0, candidates: [] });
  });

  test("it refuses a full Repo, a Spec that is not a candidate, and one already running, before dispatching anything", async () => {
    const { cli, world } = await linearRepo({ runningSpecs: 1 });
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11" });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-40" }, { identifier: "BLE-41", labels: [] });
    expect((await cli("advance", "--start", "BLE-10")).exitCode).toBe(0);
    world.calls.length = 0;

    const full = await cli("advance", "--start", "BLE-20", "--json");
    expect(full.exitCode).toBe(1);
    expect(full.json()).toEqual({
      error: "bleentr/pdf-diff has no room for BLE-20; its running Specs: BLE-10",
      help: ["Run `nico-agent advance` to keep the running Specs moving", "Run `nico-agent` to see the Board"],
    });

    expect((await cli("advance", "--start", "BLE-10", "--json")).json()).toEqual({
      error: "BLE-10 is already running",
      help: ["Run `nico-agent advance` to keep the running Specs moving", "Run `nico-agent` to see the Board"],
    });
    expect((await cli("advance", "--start", "BLE-40", "--json")).json()).toEqual({
      error: "BLE-40 is not a candidate Spec: none of its issues is Ready",
      help: ["Run `nico-agent` to see the candidate Specs of each Repo"],
    });
    expect((await cli("advance", "--start", "BLE-99", "--json")).json()).toEqual({
      error: "BLE-99 is not a candidate Spec: no Spec of a Repo has that name",
      help: ["Run `nico-agent` to see the candidate Specs of each Repo"],
    });
    expect(world.calls.some((c) => c.startsWith("herdr") && c !== "herdr agent list")).toBe(false);
  });

  test("it refuses a Held Spec with the hold's reason", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" }, { identifier: "BLE-22" });
    world.failHerdr("agent start", "herdr is not running");
    expect((await cli("advance", "--start", "BLE-20", "--json")).json().specs[0]).toMatchObject({ spec: "BLE-20", result: "failed" });
    world.clearFailures();
    world.calls.length = 0;

    const held = await cli("advance", "--start", "BLE-20", "--json");
    expect(held.exitCode).toBe(1);
    expect(held.json()).toEqual({
      error: "BLE-20 is Held: BLE-21's Dispatch Failed at agent start: herdr is not running",
      help: ["Run `nico-agent` to see the Board"],
    });
    expect(world.calls.some((c) => c.startsWith("herdr") && c !== "herdr agent list")).toBe(false);
  });

  test("dispatching a Spec by hand makes it running too, and its Repo's room shrinks", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11" });
    await cli("dispatch", "BLE-11", ...FLAGS);
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: ["BLE-10"], room: 1 });
  });
});
