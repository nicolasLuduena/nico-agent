import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function linearRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  return ctx;
}

describe("Linear Specs", () => {
  test("a Linear parent issue labelled ready-for-agent is a Spec, never Ready nor dispatched", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" }, { identifier: "BLE-12", blockers: [{ identifier: "BLE-11", state: "unstarted" }] });

    const board = (await cli("--json")).json();
    expect(board.issues.map((i: { issue: string }) => i.issue)).toEqual(["BLE-11"]);

    const refused = await cli("dispatch", "BLE-10", ...FLAGS, "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().error).toBe("BLE-10 is a Spec; dispatch its issues instead");
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);
  });

  test("the Board lists Linear Specs with their issues in sub-issue order, and loose issues as Specs of one", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing", labels: [] }, { identifier: "BLE-13" }, { identifier: "BLE-11", labels: [] }, { identifier: "BLE-12" });
    world.addLinearSpec({ identifier: "BLE-30", title: "Done Spec" }, { identifier: "BLE-31", state: "completed" });
    world.addLinearIssue({ identifier: "BLE-20", title: "A bug from triage" });
    world.addLinearIssue({ identifier: "BLE-21", title: "Not ready", labels: [] });

    const { specs } = (await cli("--json")).json();
    expect(specs).toEqual([
      { spec: "BLE-10", title: "PDF diffing", repo: "bleentr/pdf-diff", issues: ["BLE-13", "BLE-11", "BLE-12"], running: false },
      { spec: "BLE-20", title: "A bug from triage", repo: "bleentr/pdf-diff", issues: ["BLE-20"], running: false },
    ]);
  });

  test("a running Spec's next issue is its first unblocked one, stacked on the Spec's newest open PR", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" },
      { identifier: "BLE-11" }, { identifier: "BLE-12", blockers: [{ identifier: "BLE-13", state: "unstarted" }] }, { identifier: "BLE-13" });
    expect((await cli("dispatch", "BLE-11", ...FLAGS)).exitCode).toBe(0);

    const implementing = (await cli("--json")).json().specs;
    expect(implementing).toEqual([{
      spec: "BLE-10", title: "PDF diffing", repo: "bleentr/pdf-diff", issues: ["BLE-11", "BLE-12", "BLE-13"], running: true,
      reason: "BLE-11 is Implementing; a Spec has one Implementer at a time",
    }]);

    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11" });
    const next = (await cli("--json")).json().specs[0];
    expect(next.running).toBe(true);
    expect(next.next).toEqual({
      issue: "BLE-13", stackOn: "https://github.com/bleentr/pdf-diff/pull/16", base: "nico/ble-11",
      reason: "BLE-13 is the first unblocked issue of BLE-10; it stacks on the Spec's newest open PR",
    });
    expect(next.reason).toBeUndefined();
  });

  test("a running Spec without an open PR starts its next issue from the Repo's default branch", async () => {
    const { cli, world } = await linearRepo();
    world.defaultBranches.set("/src/pdf", "trunk");
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "completed" }, { identifier: "BLE-12" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, state: "merged", headBranch: "nico/ble-11" });

    const [spec] = (await cli("--json")).json().specs;
    expect(spec).toMatchObject({ spec: "BLE-10", running: true, next: {
      issue: "BLE-12", base: "trunk", reason: "BLE-12 is the first unblocked issue of BLE-10; the Spec has no open PR, so it starts from trunk",
    } });
    expect(spec.next.stackOn).toBeUndefined();
  });

  test("an issue blocked by another Spec's issue waits for that Blocker to close, never stacking across Specs", async () => {
    const { cli, world } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" }, { identifier: "BLE-21", state: "started" });
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", blockers: [{ identifier: "BLE-21", state: "started" }] });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11" });
    world.linearAttachments.set("BLE-21", ["https://github.com/bleentr/pdf-diff/pull/21"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 21, headBranch: "nico/ble-21" });

    const board = (await cli("--json")).json();
    expect(board.specs.find((s: { spec: string }) => s.spec === "BLE-10")).toEqual({
      spec: "BLE-10", title: "PDF diffing", repo: "bleentr/pdf-diff", issues: ["BLE-11", "BLE-12"], running: false,
      waiting: { issue: "BLE-12", blocker: "BLE-21", reason: "BLE-12 waits for BLE-21, in another Spec, to close; a Stack never mixes Specs" },
    });
    expect(board.stackable).toBeUndefined();

    world.linearIssueNamed("BLE-12").blockers = [{ identifier: "BLE-21", state: "completed" }];
    expect((await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "BLE-10").next.issue).toBe("BLE-12");
  });
});
