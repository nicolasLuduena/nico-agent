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
});
