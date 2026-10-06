import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** acme/api#3 has open PR #13; #7 is Ready. */
async function repo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  ctx.world.linkPr("acme/api", 3, { number: 13, headBranch: "agent/api-3" });
  return ctx;
}

const noWorktree = (calls: string[]) => !calls.some((c) => c.startsWith("herdr worktree create"));

describe("--stack-on any open PR in the Repo", () => {
  test("a Ready issue stacks on another issue's PR, named by the issue", async () => {
    const { cli, world } = await repo();
    const result = await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "3");
    expect(result.exitCode).toBe(0);
    expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/agent/api-3 --label api#7 --no-focus");
    expect(world.calls.find((c) => c.startsWith("herdr agent prompt"))).toContain(
      "as draft PR against agent/api-3 as the top of the stacked PRs on top of https://github.com/acme/api/pull/13 - check gh-stack",
    );
    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.base).toBe("origin/agent/api-3");
    expect(shown.stackedOn).toMatchObject({ issue: "acme/api#3", pr: { url: "https://github.com/acme/api/pull/13" } });
    // The same choice, named by the PR URL, is the same request.
    expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "https://github.com/acme/api/pull/13")).stdout).toContain("already In flight (no-op)");
  });

  test("a Stackable issue stacks on a PR whose Stack holds its Blocker's PR below it", async () => {
    const { cli, world } = await repo();
    world.addIssue("acme/api", { number: 9, blockers: [{ slug: "acme/api", number: 6, state: "open" }] });
    world.linkPr("acme/api", 6, { number: 16, headBranch: "agent/api-6" });
    world.linkPr("acme/api", 8, { number: 18, headBranch: "agent/api-8", baseBranch: "agent/api-6" });
    const result = await cli("dispatch", "acme/api#9", ...FLAGS, "--stack-on", "acme/api#8");
    expect(result.exitCode).toBe(0);
    const shown = (await cli("show", "acme/api#9", "--json")).json();
    expect(shown.base).toBe("origin/agent/api-8");
    expect(shown.stackedOn).toMatchObject({ issue: "acme/api#8", pr: { url: "https://github.com/acme/api/pull/18" } });
  });

  test("a Stackable issue is refused a PR whose Stack misses a Blocker's PR, naming the Blocker", async () => {
    const { cli, world } = await repo();
    world.addIssue("acme/api", { number: 9, blockers: [{ slug: "acme/api", number: 6, state: "open" }, { slug: "acme/api", number: 5, state: "open" }] });
    world.linkPr("acme/api", 5, { number: 15, headBranch: "agent/api-5" });
    world.linkPr("acme/api", 6, { number: 16, headBranch: "agent/api-6", baseBranch: "agent/api-5" });
    // #13 sits on main, beside the Blockers' Stack.
    const beside = await cli("dispatch", "acme/api#9", ...FLAGS, "--stack-on", "3", "--json");
    expect(beside.exitCode).toBe(1);
    expect(beside.json().error).toBe("acme/api#9 can't stack on https://github.com/acme/api/pull/13: no PR of its Blockers acme/api#6, acme/api#5 is in that PR's Stack at or below it");
    expect(beside.json().help).toContain("Stack on https://github.com/acme/api/pull/16, or on a PR above it, with `--stack-on https://github.com/acme/api/pull/16`");
    // #15 holds #5 but #6 is above it.
    const below = await cli("dispatch", "acme/api#9", ...FLAGS, "--stack-on", "5", "--json");
    expect(below.exitCode).toBe(1);
    expect(below.json().error).toContain("no PR of its Blocker acme/api#6 is in");
    expect(noWorktree(world.calls)).toBe(true);
    expect((await cli("dispatch", "acme/api#9", ...FLAGS, "--stack-on", "6")).exitCode).toBe(0);
  });

  test("a closed PR, a PR in another Repo, or an issue without an open PR is refused before any worktree", async () => {
    const { cli, world } = await repo();
    world.linkPr("acme/api", 4, { number: 14, state: "closed" });
    world.addPr({ repo: "acme/api", number: 12, state: "merged", headBranch: "agent/api-2" });
    world.linkPr("acme/other", 5, { number: 15, repo: "acme/other" });
    const refusals: [string, string][] = [
      ["https://github.com/acme/api/pull/12", "https://github.com/acme/api/pull/12 is merged; only an open PR can be stacked on"],
      ["https://github.com/acme/other/pull/15", "https://github.com/acme/other/pull/15 is a PR in another Repo than acme/api"],
      ["4", "acme/api#4 has no open PR in acme/api to stack on"],
      ["acme/other#5", "acme/other#5 has no open PR in acme/api to stack on"],
    ];
    for (const [choice, error] of refusals) {
      const result = await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", choice, "--json");
      expect(result.exitCode).toBe(1);
      expect(result.json().error).toBe(error);
      expect(result.json().help.length).toBeGreaterThan(0);
    }
    const malformed = await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "nope", "--json");
    expect(malformed.exitCode).toBe(2);
    expect(noWorktree(world.calls)).toBe(true);
    expect((await cli("show", "acme/api#7")).exitCode).toBe(1);
  });

  test("dispatch --help describes stacking on any open PR in the Repo", async () => {
    const { cli } = await repo();
    const { stdout } = await cli("dispatch", "--help");
    expect(stdout).toContain("open PR in the Repo to stack on, named by its issue or its PR URL; each Blocker's PR must be it or below it in its Stack");
  });

  test("a Linear issue stacks on any open PR attached to another Linear issue in the Repo", async () => {
    const { cli, world } = setup();
    world.addClone("/src/pdf-diff", "https://github.com/bleentr/pdf-diff.git");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf-diff", "--linear-team", "BLE");
    world.addLinearIssue({ identifier: "BLE-26", state: "started", labels: [] });
    world.addLinearIssue({ identifier: "BLE-20", state: "started", labels: [] });
    world.addLinearIssue({ identifier: "BLE-27", blockers: [{ identifier: "BLE-26", state: "started" }] });
    world.linearAttachments.set("BLE-26", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.linearAttachments.set("BLE-20", ["https://github.com/bleentr/pdf-diff/pull/20"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-26" });
    world.addPr({ repo: "bleentr/pdf-diff", number: 20, headBranch: "nico/ble-20" });
    const refused = await cli("dispatch", "BLE-27", ...FLAGS, "--stack-on", "BLE-20", "--json");
    expect(refused.json().error).toContain("no PR of its Blocker BLE-26 is in");
    world.addPr({ repo: "bleentr/pdf-diff", number: 20, headBranch: "nico/ble-20", baseBranch: "nico/ble-26" });
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--stack-on", "BLE-20")).exitCode).toBe(0);
    expect((await cli("show", "BLE-27", "--json")).json()).toMatchObject({ base: "origin/nico/ble-20", stackedOn: { issue: "BLE-20" } });
  });
});
