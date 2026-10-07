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

/** A Linear issue's merged PR in bleentr/pdf-diff: what a finished Dispatch leaves. */
function mergedPr(world: ReturnType<typeof setup>["world"], identifier: string) {
  const number = Number(identifier.split("-")[1]);
  world.linearAttachments.set(identifier, [`https://github.com/bleentr/pdf-diff/pull/${number}`]);
  world.addPr({ repo: "bleentr/pdf-diff", number, headBranch: `nico/${identifier.toLowerCase()}`, state: "merged" });
}

describe("room per Repo", () => {
  test("the Board shows per Repo the running Specs, the room left, and the candidate Specs with their first issues", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/11"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 11, headBranch: "nico/ble-11" });
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" },
      { identifier: "BLE-21" }, { identifier: "BLE-22" });
    world.addLinearIssue({ identifier: "BLE-30", title: "A bug from triage" });
    world.addLinearSpec({ identifier: "BLE-40", title: "Not ready" }, { identifier: "BLE-41", labels: [] });

    const { rooms } = (await cli("--json")).json();
    expect(rooms).toEqual([{
      repo: "bleentr/pdf-diff", running: ["BLE-10"], room: 1,
      candidates: [
        { spec: "BLE-20", title: "Parser", url: "https://linear.app/bleentr/issue/BLE-20/title", issue: "BLE-21" },
        { spec: "BLE-30", title: "A bug from triage", url: "https://linear.app/bleentr/issue/BLE-30/title", issue: "BLE-30" },
      ],
      queue: [],
    }]);
  });

  test("the cap is read per Repo from config, and a Spec whose issues all have PRs or that only waits on another Spec's merges frees its slot", async () => {
    const { cli, world } = await linearRepo({ maxRunningSpecs: 1 });
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
    mergedPr(world, "BLE-31");
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

  test("a Spec runs from a Dispatch, so an issue closed by hand alone leaves it a candidate until a PR shows one", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });

    const room = (await cli("--json")).json().rooms[0];
    expect(room).toMatchObject({ running: [], room: 2 });
    expect(room.candidates.map((c: { spec: string; issue: string }) => `${c.spec} ${c.issue}`)).toEqual(["BLE-10 BLE-12"]);
    expect((await cli("advance", "--json")).json().specs).toEqual([]);

    mergedPr(world, "BLE-11");
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: ["BLE-10"], room: 1, candidates: [] });
  });

  test("a GitHub candidate Spec is listed with its first issue", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addGitHubSpec("acme/api", { number: 10, title: "Retries" }, { number: 11 });

    expect((await cli("--json")).json().rooms).toEqual([{
      repo: "acme/api", running: [], room: 2,
      candidates: [{ spec: "acme/api#10", title: "Retries", url: "https://github.com/acme/api/issues/10", issue: "acme/api#11" }],
      queue: [],
    }]);
  });

  test("a running-Specs cap that is not a positive integer is a config error", async () => {
    const { cli, configDir } = await linearRepo({ maxRunningSpecs: 0 });
    expect((await cli("--json")).json()).toEqual({
      error: `${join(configDir, "config.json")}: repos[0].maxRunningSpecs is not a positive integer`,
      help: ["Fix or delete the file and run `nico-agent repo add` again"],
    });
  });
});

describe("running Specs", () => {
  test("dispatching a Spec by hand makes it running too, and its Repo's room shrinks", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11" });
    await cli("dispatch", "BLE-11", ...FLAGS);
    expect((await cli("--json")).json().rooms[0]).toMatchObject({ running: ["BLE-10"], room: 1 });
  });
});
