import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { type BoardJson, repoSections } from "../src/app/board";
import { repoRows } from "../src/app/repo-rows";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const MANUAL_HELP = "Run `nico-agent repo set acme/api --manual off` to let `advance` start work there";

/** acme/api, manual, with the Scheduler defaults set. */
async function manualRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  expect((await ctx.cli("repo", "set", "acme/api", "--manual", "on")).exitCode).toBe(0);
  const file = join(ctx.configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), scheduler: { harness: "claude", model: "opus", effort: "high" } }));
  ctx.world.calls.length = 0;
  return ctx;
}

describe("repo set --manual", () => {
  test("turns a Repo manual and back, `repo list` shows it, and setting it again is a no-op", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");

    const on = await cli("repo", "set", "ACME/API", "--manual", "on");
    expect(on.exitCode).toBe(0);
    expect(on.stdout).toBe([
      "repo: acme/api manual on",
      "help[1]:",
      "  Run `nico-agent repo list` to see all Repos",
      "",
    ].join("\n"));
    expect((await cli("repo", "list", "--json")).json().repos).toEqual([{ slug: "acme/api", path: "/src/api", manual: true }]);
    expect((await cli("repo", "set", "acme/api", "--manual", "on", "--json")).json().repo).toBe("acme/api already manual on (no-op)");

    expect((await cli("repo", "set", "acme/api", "--manual", "off", "--json")).json().repo).toBe("acme/api manual off");
    expect((await cli("repo", "list", "--json")).json().repos).toEqual([{ slug: "acme/api", path: "/src/api" }]);
  });

  test("refuses a Repo that is not configured, a value other than on or off, and a missing --manual", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");

    expect((await cli("repo", "set", "acme/web", "--manual", "on", "--json")).json()).toEqual({
      error: "acme/web is not a configured Repo", help: ["Run `nico-agent repo list` to see the Repos"],
    });
    const bad = await cli("repo", "set", "acme/api", "--manual", "yes", "--json");
    expect(bad.exitCode).toBe(2);
    expect(bad.json().error).toBe("`yes` is not on or off");
    const missing = await cli("repo", "set", "acme/api", "--json");
    expect(missing.exitCode).toBe(2);
    expect(missing.json().error).toBe("missing required flag --manual");
  });

  test("a manual that is not true or false is a config error", async () => {
    const { cli, world, configDir } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    const file = join(configDir, "config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.repos[0].manual = "yes";
    writeFileSync(file, JSON.stringify(config));
    expect((await cli("--json")).json().error).toBe(`${file}: repos[0].manual is not true or false`);
  });
});

describe("a manual Repo", () => {
  test("advance leaves the head of its Queue queued and unstarted, and says why", async () => {
    const { cli, world } = await manualRepo();
    world.addGitHubSpec("acme/api", { number: 20, title: "Parser" }, { number: 21 });
    expect((await cli("queue", "acme/api#20", "--repo", "acme/api")).exitCode).toBe(0);
    world.calls.length = 0;

    const { exitCode, json } = await cli("advance", "--json");
    expect(exitCode).toBe(0);
    expect(json().specs).toEqual([{
      spec: "acme/api#20", repo: "acme/api", result: "skipped", issue: "acme/api#21",
      reason: "acme/api#20 is the head of the Queue, but acme/api is manual: only an explicit dispatch starts acme/api#21",
    }]);
    expect(json().help).toContain(MANUAL_HELP);
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);
    expect((await cli("--json")).json().rooms[0].queue).toEqual(["acme/api#20"]);
  });

  test("advance dispatches no issue of a running Spec, yet still Closes its finished Dispatch; an explicit dispatch starts one", async () => {
    const { cli, world } = await manualRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
    expect((await cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
    world.addPr({ repo: "acme/api", number: 16, headBranch: "agent/api-11" });
    world.agentStates.set("impl-api-11", "idle");
    world.calls.length = 0;

    const first = (await cli("advance", "--json")).json();
    expect(first.specs).toEqual([{
      spec: "acme/api#10", repo: "acme/api", result: "skipped", issue: "acme/api#12",
      reason: "acme/api is manual: only an explicit dispatch starts acme/api#12",
    }]);
    expect(first.help).toContain(MANUAL_HELP);
    expect(first.closed).toEqual(["acme/api#11"]);
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);

    // With nothing In flight, the Spec no longer runs there, though its issue has a PR.
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ repo: "acme/api", running: [], manual: true });
    expect((await cli("advance", "--json")).json().specs).toEqual([]);

    expect((await cli("dispatch", "acme/api#12", ...FLAGS)).exitCode).toBe(0);
    expect(world.calls.some((c) => c.startsWith("herdr worktree create --cwd /src/api --branch agent/api-12"))).toBe(true);
    expect((await cli("--json")).json().rooms[0].running).toEqual(["acme/api#10"]);
  });

  test("the Board marks its room as manual, and a Repo that is not manual has no mark", async () => {
    const { cli, world } = await manualRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addGitHubSpec("acme/api", { number: 10 }, { number: 11 });
    world.addGitHubSpec("acme/web", { number: 20 }, { number: 21 });

    const board: BoardJson = (await cli("--json")).json();
    expect(board.rooms!.map((r) => [r.repo, r.manual])).toEqual([["acme/api", true], ["acme/web", undefined]]);
    expect(repoSections(board).map((s) => s.room?.manual)).toEqual([true, false]);
    expect(repoRows(board).map((r) => r.manual)).toEqual([true, false]);
  });
});
