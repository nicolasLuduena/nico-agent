import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** BLE-27 is blocked by BLE-26, whose open PR #16 in bleentr/pdf-diff is attached to it. */
async function stackable(...more: string[]) {
  const ctx = setup();
  for (const name of ["pdf-diff", ...more]) {
    ctx.world.addClone(`/src/${name}`, `git@github.com:bleentr/${name}.git`);
    await ctx.cli("repo", "add", `bleentr/${name}`, "--path", `/src/${name}`, "--linear-team", "BLE");
  }
  ctx.world.addLinearIssue({ identifier: "BLE-26", state: "started", labels: [] });
  ctx.world.addLinearIssue({
    identifier: "BLE-27", title: "Compare PDFs", branchName: "nico/ble-27-compare-pdfs",
    blockers: [{ identifier: "BLE-26", state: "started" }],
  });
  ctx.world.linearAttachments.set("BLE-26", ["https://github.com/bleentr/pdf-diff/pull/16"]);
  ctx.world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-26-parse-pdfs" });
  ctx.world.calls.length = 0;
  return ctx;
}

describe("Stackable Linear issues", () => {
  test("the Board lists a Linear issue whose unresolved Blockers each have an open PR in the Repo", async () => {
    const { cli, world } = await stackable();
    world.addLinearIssue({ identifier: "BLE-30", blockers: [{ identifier: "BLE-29", state: "unstarted" }] });

    const board = (await cli("board", "--json")).json();
    expect(board.stackable).toEqual([{
      issue: "BLE-27", title: "Compare PDFs", repo: "bleentr/pdf-diff",
      blockers: [{ issue: "BLE-26", pr: "https://github.com/bleentr/pdf-diff/pull/16", base: "nico/ble-26-parse-pdfs" }],
    }]);
    expect(board.issues).toBeUndefined();
  });

  test("a Blocker whose only PR is in another Repo keeps the issue out of Stackable", async () => {
    const { cli, world } = await stackable("web");
    world.linearAttachments.set("BLE-26", ["https://github.com/bleentr/web/pull/16"]);
    world.prs.clear();
    world.addPr({ repo: "bleentr/web", number: 16, headBranch: "nico/ble-26-parse-pdfs" });

    const board = (await cli("board", "--json")).json();
    expect(board.stackable).toEqual([{
      issue: "BLE-27", title: "Compare PDFs", repo: "bleentr/web",
      blockers: [{ issue: "BLE-26", pr: "https://github.com/bleentr/web/pull/16", base: "nico/ble-26-parse-pdfs" }],
    }]);

    const refused = await cli("dispatch", "BLE-27", ...FLAGS, "--repo", "bleentr/pdf-diff", "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().error).toBe("BLE-27 has unresolved Blockers without open PRs in bleentr/pdf-diff");
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);
  });

  test("closed and merged Blocker PRs don't make an issue Stackable", async () => {
    const { cli, world } = await stackable();
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, state: "merged", headBranch: "nico/ble-26-parse-pdfs" });
    expect((await cli("board", "--json")).json().stackable).toBeUndefined();
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, state: "closed", headBranch: "nico/ble-26-parse-pdfs" });
    expect((await cli("dispatch", "BLE-27", ...FLAGS)).exitCode).toBe(1);
  });

  test("a Stacked Linear dispatch starts on the Blocker PR head, on the Linear branch name, with the stacked prompt", async () => {
    const { cli, world } = await stackable();

    const result = await cli("dispatch", "BLE-27", ...FLAGS);
    expect(result.exitCode).toBe(0);
    expect(world.calls).toContain("git -C /src/pdf-diff fetch origin +refs/heads/nico/ble-26-parse-pdfs:refs/remotes/origin/nico/ble-26-parse-pdfs");
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf-diff --branch nico/ble-27-compare-pdfs --base origin/nico/ble-26-parse-pdfs --label pdf-diff:BLE-27 --no-focus");
    expect(world.calls.find((c) => c.startsWith("herdr agent prompt"))).toBe(
      "herdr agent prompt impl-pdf-diff-ble-27 /implement https://linear.app/bleentr/issue/BLE-27/title as draft PR against nico/ble-26-parse-pdfs" +
      " as the top of the stacked PRs on top of https://github.com/bleentr/pdf-diff/pull/16 - check gh-stack if you are not aware of github's stacked PRs",
    );
    expect(world.linearClaimed).toEqual(["BLE-27"]);
    const shown = (await cli("show", "BLE-27", "--json")).json();
    expect(shown).toMatchObject({ base: "origin/nico/ble-26-parse-pdfs", stackedOn: { issue: "BLE-26", pr: { url: "https://github.com/bleentr/pdf-diff/pull/16" } } });
    expect((await cli("board", "--json")).json().stackable).toBeUndefined();
  });

  test("several Blocker PRs need --stack-on, by Linear identifier, Linear URL or PR URL", async () => {
    const { cli, world } = await stackable();
    world.addLinearIssue({ identifier: "BLE-25", state: "started", labels: [] });
    world.linear.get("BLE")!.find((i) => i.identifier === "BLE-27")!.blockers.push({ identifier: "BLE-25", state: "started" });
    world.linearAttachments.set("BLE-25", ["https://github.com/bleentr/pdf-diff/pull/15"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 15, headBranch: "nico/ble-25", baseBranch: "nico/ble-26-parse-pdfs" });

    const refused = await cli("dispatch", "BLE-27", ...FLAGS, "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().help).toEqual([
      "Stack on https://github.com/bleentr/pdf-diff/pull/16 with `--stack-on BLE-26`",
      "Stack on https://github.com/bleentr/pdf-diff/pull/15 with `--stack-on BLE-25`",
    ]);
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--stack-on", "https://linear.app/bleentr/issue/BLE-25/whatever")).exitCode).toBe(0);
    expect((await cli("show", "BLE-27", "--json")).json().base).toBe("origin/nico/ble-25");
    // The same choice again, named another way, is the same request.
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--stack-on", "ble-25")).stdout).toContain("already In flight (no-op)");
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--stack-on", "https://github.com/bleentr/pdf-diff/pull/15")).stdout).toContain("already In flight (no-op)");
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--stack-on", "BLE-26")).exitCode).toBe(1);
  });

  test("a Stacked Linear dispatch refuses --base", async () => {
    const { cli } = await stackable();
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--base", "main", "--json")).json().error).toBe("BLE-27 is Stacked; its Base is the head branch of the PR it stacks on");
  });

  test("the web lists a Stackable Linear row under its Repo, with Blocker choices, and dispatches it there", async () => {
    const { web, cli } = await stackable();
    const { body } = await web("/classic");
    expect(body).toContain("<h3>Stackable</h3>");
    expect(body).toContain('<input type="hidden" name="repo" value="bleentr/pdf-diff">');
    expect(body).toContain('value="BLE-26"');

    const changed = await web("/dispatch-form?issue=BLE-27&repo=bleentr/pdf-diff&harness=claude&model=sonnet&effort=high&stackOn=BLE-26");
    expect(changed.body).toContain('<option value="BLE-26" selected>');
    expect(changed.body).not.toContain('name="base"');

    const form = new URLSearchParams({ issue: "BLE-27", repo: "bleentr/pdf-diff", harness: "claude", model: "opus", effort: "high", stackOn: "BLE-26" });
    expect((await web("/dispatch", { method: "POST", body: form })).status).toBe(303);
    expect((await cli("show", "BLE-27", "--json")).json().base).toBe("origin/nico/ble-26-parse-pdfs");
  });
});
