import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const SCHEDULER = { harness: "claude", model: "opus", effort: "high" };

/** A Repo claiming Linear team BLE, with the Scheduler defaults set. */
async function linearRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  const file = join(ctx.configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), scheduler: SCHEDULER }));
  ctx.world.calls.length = 0;
  return ctx;
}

/** BLE-10's BLE-13 stacked by `advance` on BLE-12's PR #17, itself on BLE-11's PR #16. */
async function stackedSpec() {
  const ctx = await linearRepo();
  const { cli, world } = ctx;
  world.addLinearSpec({ identifier: "BLE-10" },
    { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", state: "started" }, { identifier: "BLE-13" }, { identifier: "BLE-14" });
  world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
  world.linearAttachments.set("BLE-12", ["https://github.com/bleentr/pdf-diff/pull/17"]);
  world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11" });
  world.addPr({ repo: "bleentr/pdf-diff", number: 17, headBranch: "nico/ble-12", baseBranch: "nico/ble-11" });
  expect((await cli("advance", "--json")).json().specs.map((s: { result: string; issue: string }) => `${s.result} ${s.issue}`)).toEqual(["started BLE-13"]);
  world.linearIssueNamed("BLE-13").state = "started";
  return ctx;
}

const HELD = {
  title: "BLE-10 is Held",
  body: "BLE-13's Stack is built on https://github.com/bleentr/pdf-diff/pull/16, closed without merging\n"
    + "Run `nico-agent close BLE-13` to Close its Dispatch, whose Stack is built on a PR closed without merging, or retarget that Stack",
};

describe("advance notifies the user", () => {
  test("once when a Spec becomes Held, with its reason and what to do, and not again while it stays Held", async () => {
    const { cli, world } = await stackedSpec();
    expect(world.notifications).toEqual([]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state: "closed" });

    expect((await cli("advance")).exitCode).toBe(0);
    expect(world.notifications).toEqual([HELD]);
    expect((await cli("advance")).exitCode).toBe(0);
    expect(world.notifications).toEqual([HELD]);
  });

  test("again when a Spec is Held, clears, and is Held again", async () => {
    const { cli, world } = await stackedSpec();
    const pr16 = (state: "open" | "closed") => world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state });
    pr16("closed");
    await cli("advance");
    pr16("open");
    expect((await cli("advance", "--json")).json().specs).toEqual([]);
    expect(world.notifications).toEqual([HELD]);

    pr16("closed");
    await cli("advance");
    expect(world.notifications).toEqual([HELD, HELD]);
  });

  test("once when a Dispatch fails, with its issue and step, and not again for the Spec it Holds", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21", state: "completed" }, { identifier: "BLE-22" });
    world.linearAttachments.set("BLE-21", ["https://github.com/bleentr/pdf-diff/pull/21"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 21, headBranch: "nico/ble-21", state: "merged" });
    world.failCall("git -C /src/pdf fetch", "`git fetch origin` failed in /src/pdf: Permission denied (publickey)");

    expect((await cli("advance")).exitCode).toBe(1);
    const failed = {
      title: "BLE-22's Dispatch failed at fetch",
      body: "`git fetch origin` failed in /src/pdf: Permission denied (publickey)\nRun `nico-agent show BLE-22` to see the Dispatch",
    };
    expect(world.notifications).toEqual([failed]);

    world.clearFailures();
    expect((await cli("advance", "--json")).json().specs[0]).toMatchObject({ spec: "BLE-20", result: "skipped", reason: expect.stringMatching(/^Held: /) });
    expect(world.notifications).toEqual([failed]);
  });

  test("once when an Implementer is Asking, naming its issue and how to answer, and again when it asks anew", async () => {
    const { cli, world } = await stackedSpec();
    const asking = {
      title: "BLE-13 is Asking",
      body: "The Implementer of BLE-13 (Spec BLE-10) is waiting on you.\n"
        + "Answer it in herdr (agent impl-pdf-diff-ble-13), or run `nico-agent answer BLE-13 <text>`",
    };
    world.agentStates.set("impl-pdf-diff-ble-13", "blocked");
    await cli("advance");
    await cli("advance");
    expect(world.notifications).toEqual([asking]);

    world.agentStates.set("impl-pdf-diff-ble-13", "working");
    await cli("advance");
    world.agentStates.set("impl-pdf-diff-ble-13", "blocked");
    await cli("advance");
    expect(world.notifications).toEqual([asking, asking]);
  });

  test("a notification that fails to send is a warning, not a failed run, and is sent once it can be", async () => {
    const { cli, world } = await stackedSpec();
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11", state: "closed" });
    world.failCall("notify", "`notify-send` failed: Cannot autolaunch D-Bus without X11 $DISPLAY");

    const result = await cli("advance", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json().warnings).toEqual(['could not notify "BLE-10 is Held": `notify-send` failed: Cannot autolaunch D-Bus without X11 $DISPLAY']);
    expect(result.json().specs).toHaveLength(1);
    expect(world.notifications).toEqual([]);

    world.clearFailures();
    expect((await cli("advance", "--json")).json().warnings).toBeUndefined();
    expect(world.notifications).toEqual([HELD]);
  });
});
