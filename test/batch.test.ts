import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const REVIEW_FLAGS = ["--harness", "claude", "--model", "sonnet", "--effort", "max"];

/** A Repo with issues `numbers` Ready. */
async function withIssues(...numbers: number[]) {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  for (const number of numbers) ctx.world.addIssue("acme/api", { number });
  ctx.world.calls.length = 0;
  return ctx;
}

/** A Repo with issues `numbers` dispatched. */
async function dispatched(...numbers: number[]) {
  const ctx = await withIssues(...numbers);
  for (const number of numbers) await ctx.cli("dispatch", `acme/api#${number}`, ...FLAGS);
  ctx.world.calls.length = 0;
  return ctx;
}

describe("batch close", () => {
  test("closes several issues with open PRs without --confirm", async () => {
    const { cli, world } = await dispatched(1, 2);
    world.linkPr("acme/api", 1, { number: 11 });
    world.linkPr("acme/api", 2, { number: 12 });
    const result = await cli("close", "acme/api#1", "acme/api#2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "closed: 2 of 2 issues",
        "results[2]{issue,result,error}:",
        '  acme/api#1,closed,""',
        '  acme/api#2,closed,""',
        "help[1]:",
        "  Run `nico-agent` to see the Board",
        "",
      ].join("\n"),
    );
    expect(world.calls.filter((c) => c.startsWith("herdr worktree remove"))).toEqual([
      "herdr worktree remove --workspace w1",
      "herdr worktree remove --workspace w2",
    ]);
  });

  test("an issue with no PR needs --confirm in a batch; the rest close straight away", async () => {
    const { cli, world } = await dispatched(1, 2);
    world.linkPr("acme/api", 1, { number: 11, state: "merged" });
    const result = await cli("close", "acme/api#1", "acme/api#2", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json()).toEqual({
      closed: "1 of 2 issues",
      results: [
        { issue: "acme/api#1", result: "closed", error: "" },
        { issue: "acme/api#2", result: "skipped", error: "acme/api#2 has no PR yet; closing requires confirmation" },
      ],
      help: [
        "Run `nico-agent close acme/api#2 --confirm` to remove its workspace and forget the Dispatch",
        "Run `nico-agent` to see the Board",
      ],
    });
    expect(world.calls).toContain("herdr worktree remove --workspace w1");
    expect(world.calls).not.toContain("herdr worktree remove --workspace w2");
    expect((await cli("close", "acme/api#2", "--confirm")).exitCode).toBe(0);
  });

  test("closing an issue that is not In flight is an idempotent no-op in a batch too", async () => {
    const { cli, world } = await dispatched(1);
    world.linkPr("acme/api", 1, { number: 11 });
    const result = await cli("close", "acme/api#1", "acme/api#5", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json().results[1]).toEqual({ issue: "acme/api#5", result: "already Closed (no-op)", error: "" });
  });
});

describe("batch dispatch", () => {
  test("one issue failing at the worktree step leaves the others to complete, reported per issue", async () => {
    const { cli, world } = await withIssues(1, 2, 3);
    world.failCall("herdr worktree create --cwd /src/api --branch agent/api-2 ", "worktree already exists");
    const result = await cli("dispatch", "acme/api#1", "acme/api#2", "acme/api#3", ...FLAGS);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toStartWith(
      [
        "dispatched: 2 of 3 issues",
        "results[3]{issue,result,stage,error}:",
        '  acme/api#1,dispatched,Implementing,""',
        "  acme/api#2,failed,Failed at worktree,worktree already exists",
        '  acme/api#3,dispatched,Implementing,""',
        "help[",
      ].join("\n"),
    );
    expect(result.stdout).toContain("Run the same `nico-agent dispatch` again to resume from worktree");
    expect(world.claimed).toEqual(["acme/api#1", "acme/api#3"]);

    world.clearFailures();
    const again = await cli("dispatch", "acme/api#1", "acme/api#2", "acme/api#3", ...FLAGS, "--json");
    expect(again.exitCode).toBe(0);
    expect(again.json().results.map((r: { result: string }) => r.result)).toEqual([
      "already In flight (no-op)",
      "resumed from worktree",
      "already In flight (no-op)",
    ]);
  });

  test("an issue that doesn't fit is skipped with the reason and the others still run", async () => {
    const { cli, world } = await withIssues(1);
    world.addIssue("acme/api", { number: 2, state: "closed" });
    const result = await cli("dispatch", "acme/api#2", "acme/api#1", "nope", ...FLAGS, "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json().results).toEqual([
      { issue: "acme/api#2", result: "skipped", stage: "", error: "acme/api#2 is closed" },
      { issue: "acme/api#1", result: "dispatched", stage: "Implementing", error: "" },
      { issue: "nope", result: "skipped", stage: "", error: "`nope` is not an issue reference" },
    ]);
  });

  test("the flags apply to the whole batch and are required once", async () => {
    const { cli, world } = await withIssues(1, 2);
    const missing = await cli("dispatch", "acme/api#1", "acme/api#2", "--harness", "claude");
    expect(missing.exitCode).toBe(2);
    expect(missing.stdout).toStartWith("error: missing required flag --model\n");
    expect(world.calls).toEqual([]);
    expect((await cli("dispatch", "acme/api#1", "acme/api#2", ...FLAGS)).exitCode).toBe(0);
    expect(world.calls.filter((c) => c.startsWith("herdr agent start"))).toEqual([
      "herdr agent start impl-api-1 --kind claude --pane w1:p2 -- --model opus --effort high",
      "herdr agent start impl-api-2 --kind claude --pane w2:p2 -- --model opus --effort high",
    ]);
  });

  test("a single issue keeps the single-issue output", async () => {
    const { cli } = await withIssues(1);
    expect((await cli("dispatch", "acme/api#1", ...FLAGS)).stdout).toStartWith("dispatched: acme/api#1\nstage: Implementing\n");
  });
});

describe("batch review", () => {
  test("reviews the issues with a PR and skips the one that is not In flight", async () => {
    const { cli, world } = await dispatched(1, 2);
    world.linkPr("acme/api", 1, { number: 11 });
    world.linkPr("acme/api", 2, { number: 12 });
    const result = await cli("review", "acme/api#1", "acme/api#9", "acme/api#2", ...REVIEW_FLAGS, "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json().reviewing).toBe("2 of 3 issues");
    expect(result.json().results).toEqual([
      { issue: "acme/api#1", result: "reviewing", stage: "Review launched", error: "" },
      { issue: "acme/api#9", result: "skipped", stage: "", error: "acme/api#9 is not In flight" },
      { issue: "acme/api#2", result: "reviewing", stage: "Review launched", error: "" },
    ]);
  });
});
