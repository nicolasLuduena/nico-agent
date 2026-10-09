import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

/** A Repo claiming Linear team BLE, with the Scheduler defaults set and `repo` over its config entry. */
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

/** A Linear issue's open PR in bleentr/pdf-diff, on `base`. */
function openPr(world: ReturnType<typeof setup>["world"], identifier: string, base = "main") {
  const number = Number(identifier.split("-")[1]);
  world.linearAttachments.set(identifier, [`https://github.com/bleentr/pdf-diff/pull/${number}`]);
  world.addPr({ repo: "bleentr/pdf-diff", number, headBranch: `nico/${identifier.toLowerCase()}`, baseBranch: base });
}

type Row = { result: string; issue: string; reason: string };
const started = (rows: Row[]) => rows.map((r) => `${r.result} ${r.issue}`);
const worktreeBases = (calls: string[]) =>
  calls.filter((c) => c.startsWith("herdr worktree create")).map((c) => c.match(/--branch (\S+) --base (\S+)/)!.slice(1).join(" on "));

describe("several Implementers per Spec", () => {
  test("advance starts each startable issue of a running Spec together, each from the Base when it has no open Blocker PR", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" }, { identifier: "BLE-13" },
      { identifier: "BLE-14", blockers: [{ identifier: "BLE-12", state: "unstarted" }] });
    openPr(world, "BLE-11");

    const { specs } = (await cli("advance", "--json")).json();
    expect(specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-12", reason: "BLE-12 has no open Blocker PR, so it starts from main" },
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-13", reason: "BLE-13 has no open Blocker PR, so it starts from main" },
    ]);
    expect(worktreeBases(world.calls)).toEqual(["nico/ble-12 on origin/main", "nico/ble-13 on origin/main"]);
  });

  test("the cap of Implementers per Spec is read per Repo, less the Spec's issues already In flight", async () => {
    const { cli, world } = await linearRepo({ maxImplementersPerSpec: 2 });
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11" }, { identifier: "BLE-12" }, { identifier: "BLE-13" }, { identifier: "BLE-14" });
    expect((await cli("dispatch", "BLE-11", "--harness", "claude", "--model", "opus", "--effort", "high", "--repo", "bleentr/pdf-diff")).exitCode).toBe(0);
    world.calls.length = 0;

    expect(started((await cli("advance", "--json")).json().specs)).toEqual(["started BLE-12"]);
    world.linearIssueNamed("BLE-12")!.state = "started";
    world.calls.length = 0;
    expect((await cli("advance", "--json")).json()).toEqual({ specs: [], help: ["Run `nico-agent` to see the Board"] });
    expect(worktreeBases(world.calls)).toEqual([]);
    expect((await cli("--json")).json().specs[0]).toMatchObject({ running: true, reason: "2 issues of BLE-10 are In flight, its cap of 2 Implementers" });
  });

  test("by default a Spec runs up to 5 Implementers, and the cap must be a positive integer", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "started" }, ...[12, 13, 14, 15, 16, 17].map((n) => ({ identifier: `BLE-${n}` })));
    openPr(world, "BLE-11");
    expect(started((await cli("advance", "--json")).json().specs)).toEqual(["BLE-12", "BLE-13", "BLE-14", "BLE-15", "BLE-16"].map((i) => `started ${i}`));

    const bad = await linearRepo({ maxImplementersPerSpec: 0 });
    expect((await bad.cli("advance", "--json")).json()).toMatchObject({
      error: `${join(bad.configDir, "config.json")}: repos[0].maxImplementersPerSpec is not a positive integer`,
    });
  });

  test("each issue stacks on its own Blocker's open PR, or on the top one when its Blockers' PRs share a Stack", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", state: "started" }, { identifier: "BLE-13", state: "started" },
      { identifier: "BLE-14", blockers: [{ identifier: "BLE-11", state: "started" }] },
      { identifier: "BLE-15", blockers: [{ identifier: "BLE-13", state: "started" }] },
      { identifier: "BLE-16", blockers: [{ identifier: "BLE-12", state: "started" }, { identifier: "BLE-11", state: "started" }] });
    openPr(world, "BLE-11");
    openPr(world, "BLE-12", "nico/ble-11");
    openPr(world, "BLE-13");

    const { specs } = (await cli("advance", "--json")).json();
    expect(specs.map((r: Row) => r.reason)).toEqual([
      "BLE-14 stacks on its Blocker BLE-11's open PR",
      "BLE-15 stacks on its Blocker BLE-13's open PR",
      "BLE-16 stacks on its Blocker BLE-12's open PR",
    ]);
    expect(worktreeBases(world.calls)).toEqual([
      "nico/ble-14 on origin/nico/ble-11", "nico/ble-15 on origin/nico/ble-13", "nico/ble-16 on origin/nico/ble-12",
    ]);
    expect((await cli("show", "BLE-16", "--json")).json()).toMatchObject({ stackedOn: { pr: { url: "https://github.com/bleentr/pdf-diff/pull/12" } } });
  });

  test("an issue whose Blockers' open PRs sit on two branches waits, with its reason on the Board, while the rest start", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", state: "started" },
      { identifier: "BLE-13", blockers: [{ identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", state: "started" }] },
      { identifier: "BLE-14" });
    openPr(world, "BLE-11");
    openPr(world, "BLE-12");
    const reason = "BLE-13 waits for its Blockers' open PRs https://github.com/bleentr/pdf-diff/pull/11, https://github.com/bleentr/pdf-diff/pull/12 to merge down to one; they sit on different branches";

    const board = (await cli("--json")).json();
    expect(board.specs[0]).toMatchObject({
      running: true,
      next: [{ issue: "BLE-14", base: "main", reason: "BLE-14 has no open Blocker PR, so it starts from main" }],
      waiting: [{ issue: "BLE-13", blockers: ["BLE-11", "BLE-12"], reason }],
    });
    expect(started((await cli("advance", "--json")).json().specs)).toEqual(["started BLE-14"]);
    world.linearIssueNamed("BLE-14")!.state = "started";

    // Once one of them merges, it stacks on the other.
    world.addPr({ repo: "bleentr/pdf-diff", number: 11, headBranch: "nico/ble-11", state: "merged" });
    world.linearIssueNamed("BLE-13")!.blockers[0]!.state = "completed";
    world.calls.length = 0;
    expect((await cli("advance", "--json")).json().specs.map((r: Row) => `${r.result} ${r.issue}: ${r.reason}`))
      .toEqual(["started BLE-13: BLE-13 stacks on its Blocker BLE-12's open PR"]);
  });

  test("a Failed Dispatch Holds its Spec: advance starts none of its other issues, that run or the next", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" }, { identifier: "BLE-13" });
    openPr(world, "BLE-11");
    world.failHerdr("agent start", "herdr is not running");

    const failed = (await cli("advance", "--json")).json();
    expect(failed.specs).toEqual([{ spec: "BLE-10", repo: "bleentr/pdf-diff", result: "failed", issue: "BLE-12", reason: "herdr is not running" }]);
    expect(worktreeBases(world.calls)).toEqual(["nico/ble-12 on origin/main"]);

    world.clearFailures();
    world.calls.length = 0;
    expect((await cli("advance", "--json")).json().specs).toEqual([
      { spec: "BLE-10", repo: "bleentr/pdf-diff", result: "skipped", issue: "BLE-12", reason: "Held: BLE-12's Dispatch Failed at agent start: herdr is not running" },
    ]);
    expect(worktreeBases(world.calls)).toEqual([]);
  });

  test("a queued Spec starts all its first issues at once, taking one slot of the Repo's room", async () => {
    const { cli, world } = await linearRepo({ maxRunningSpecs: 1 });
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11" }, { identifier: "BLE-12" });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    expect((await cli("queue", "BLE-10", "--repo", "bleentr/pdf-diff")).exitCode).toBe(0);
    expect((await cli("queue", "BLE-20", "--repo", "bleentr/pdf-diff")).exitCode).toBe(0);

    expect(started((await cli("advance", "--json")).json().specs)).toEqual(["started BLE-11", "started BLE-12"]);
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: ["BLE-10"], room: 0, queue: ["BLE-20"] });
  });
});
