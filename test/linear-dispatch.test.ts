import { describe, expect, test } from "bun:test";
import { dispatchTarget, launchArgs, launchChoice } from "../src/app/actions";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function withLinearRepo(...more: string[]) {
  const ctx = setup();
  for (const name of ["pdf-diff", ...more]) {
    ctx.world.addClone(`/src/${name}`, `git@github.com:bleentr/${name}.git`);
    await ctx.cli("repo", "add", `bleentr/${name}`, "--path", `/src/${name}`, "--linear-team", "BLE");
  }
  ctx.world.addLinearIssue({ identifier: "BLE-27", title: "Compare PDFs", branchName: "nico/ble-27-compare-pdfs" });
  ctx.world.calls.length = 0;
  return ctx;
}

describe("Linear dispatch", () => {
  test("uses Linear's branchName, labels the workspace <repo>:BLE-<n>, prompts the Linear URL and Claims as the Linear viewer", async () => {
    const { cli, world } = await withLinearRepo();

    const { stdout, exitCode } = await cli("dispatch", "BLE-27", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(world.calls).toEqual([
      "linear issue BLE-27",
      "git -C /src/pdf-diff ls-remote --heads origin",
      "git -C /src/pdf-diff default-branch",
      "git -C /src/pdf-diff fetch origin",
      "herdr worktree create --cwd /src/pdf-diff --branch nico/ble-27-compare-pdfs --base origin/main --label pdf-diff:BLE-27 --no-focus",
      "herdr tab create --workspace w1 --cwd /worktrees/ble-27-compare-pdfs --label implementer --no-focus",
      "herdr agent start impl-pdf-diff-ble-27 --kind claude --pane w1:p2 -- --model opus --effort high",
      "github app repos",
      "herdr agent prompt impl-pdf-diff-ble-27 /implement https://linear.app/bleentr/issue/BLE-27/title as draft PR against main",
      "linear assign BLE-27",
    ]);
    expect(world.linearClaimed).toEqual(["BLE-27"]);
    expect(stdout).toContain("dispatched: BLE-27\n");

    const shown = (await cli("show", "https://linear.app/bleentr/issue/BLE-27/compare-pdfs", "--json")).json();
    expect(shown).toMatchObject({
      issue: "BLE-27",
      title: "Compare PDFs",
      url: "https://linear.app/bleentr/issue/BLE-27/title",
      repo: "bleentr/pdf-diff",
      branch: "nico/ble-27-compare-pdfs",
      stage: "Implementing",
      claimed: true,
    });

    // The Board no longer lists it as Ready; a re-run is a no-op.
    expect((await cli("--json")).json().issues).toBeUndefined();
    const again = await cli("dispatch", "BLE-27", ...FLAGS);
    expect(again.stdout).toContain("BLE-27 already In flight (no-op)");
  });

  test("a failed Linear Claim is a warning, not a failed Dispatch", async () => {
    const { cli, world } = await withLinearRepo();
    world.failCall("linear assign", "Linear request failed (HTTP 500)");

    const result = await cli("dispatch", "BLE-27", ...FLAGS, "--json");
    expect(result.exitCode).toBe(0);
    const out = result.json();
    expect(out.warnings).toEqual(["could not Claim BLE-27: Linear request failed (HTTP 500)"]);
    expect(out.help[0]).toBe("Assign https://linear.app/bleentr/issue/BLE-27/title to yourself on Linear to Claim it by hand");
    expect((await cli("show", "BLE-27", "--json")).json()).toMatchObject({ stage: "Implementing", claimed: false });
  });

  test("an issue matching several Repos needs --repo; without it the help lists the Repos", async () => {
    const { cli, world } = await withLinearRepo("web");

    const refused = await cli("dispatch", "BLE-27", ...FLAGS, "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json()).toEqual({
      error: "BLE-27 matches several Repos; choose one with --repo",
      help: ["Dispatch into bleentr/pdf-diff with `--repo bleentr/pdf-diff`", "Dispatch into bleentr/web with `--repo bleentr/web`"],
    });
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);

    const chosen = await cli("dispatch", "BLE-27", ...FLAGS, "--repo", "bleentr/web");
    expect(chosen.exitCode).toBe(0);
    expect(world.calls).toContain("herdr worktree create --cwd /src/web --branch nico/ble-27-compare-pdfs --base origin/main --label web:BLE-27 --no-focus");

    // The same request again is a no-op; another Repo is refused.
    expect((await cli("dispatch", "BLE-27", ...FLAGS, "--repo", "bleentr/web")).stdout).toContain("already In flight (no-op)");
    const other = await cli("dispatch", "BLE-27", ...FLAGS, "--repo", "bleentr/pdf-diff", "--json");
    expect(other.json().error).toBe("BLE-27 is already In flight in bleentr/web");
  });

  test("--repo must be a Repo whose Linear selector matches the issue", async () => {
    const { cli, world } = await withLinearRepo();
    world.addClone("/src/other", "git@github.com:bleentr/other.git");
    await cli("repo", "add", "bleentr/other", "--path", "/src/other");

    const result = await cli("dispatch", "BLE-27", ...FLAGS, "--repo", "bleentr/other", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json()).toEqual({
      error: "bleentr/other does not claim BLE-27 through its Linear selector",
      help: ["Dispatch into bleentr/pdf-diff with `--repo bleentr/pdf-diff`"],
    });
  });

  test("an issue no Repo claims, a missing one, and a done one are refused", async () => {
    const { cli, world } = await withLinearRepo();
    world.addLinearIssue({ identifier: "OTHER-1", team: { id: "other", key: "OTHER", name: "Other" } });
    world.addLinearIssue({ identifier: "BLE-30", state: "completed" });

    expect((await cli("dispatch", "OTHER-1", ...FLAGS, "--json")).json().error).toBe("OTHER-1 matches no Repo's Linear selector");
    expect((await cli("dispatch", "BLE-99", ...FLAGS, "--json")).json().error).toBe("BLE-99 was not found on Linear");
    expect((await cli("dispatch", "BLE-30", ...FLAGS, "--json")).json().error).toBe("BLE-30 is closed");
  });

  test("an issue assigned to someone else on Linear is refused, since the Claim would replace them", async () => {
    const { cli, world } = await withLinearRepo();
    world.addLinearIssue({ identifier: "BLE-31", assignee: "someone-else" });
    world.addLinearIssue({ identifier: "BLE-32", assignee: world.linearUser });

    const refused = await cli("dispatch", "BLE-31", ...FLAGS, "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().error).toBe("BLE-31 is assigned to someone else on Linear");
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);
    expect((await cli("dispatch", "BLE-32", ...FLAGS)).exitCode).toBe(0);
  });

  test("--repo is refused for a GitHub issue", async () => {
    const { cli, world } = await withLinearRepo();
    world.addIssue("bleentr/pdf-diff", { number: 7 });
    const result = await cli("dispatch", "bleentr/pdf-diff#7", ...FLAGS, "--repo", "bleentr/pdf-diff", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json().error).toBe("bleentr/pdf-diff#7 is a GitHub issue; its Repo is in its reference");
  });
});

describe("Linear Stage and review", () => {
  test("only a GitHub PR attachment in the dispatched Repo links a PR; its state comes from GitHub", async () => {
    const { cli, world } = await withLinearRepo();
    await cli("dispatch", "BLE-27", ...FLAGS);

    world.linearAttachments.set("BLE-27", ["https://github.com/bleentr/other-repo/pull/3", "https://www.figma.com/file/abc"]);
    world.addPr({ repo: "bleentr/other-repo", number: 3 });
    expect((await cli("show", "BLE-27", "--json")).json().stage).toBe("Implementing");
    const blocked = await cli("review", "BLE-27", ...FLAGS, "--json");
    expect(blocked.json().error).toBe("no PR is linked to BLE-27 yet");

    world.linearAttachments.set("BLE-27", [...world.linearAttachments.get("BLE-27")!, "https://github.com/bleentr/pdf-diff/pull/12"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 12, baseBranch: "main" });
    const shown = (await cli("show", "BLE-27", "--json")).json();
    expect(shown.stage).toBe("PR ready");
    expect(shown.pr).toBe("https://github.com/bleentr/pdf-diff/pull/12");

    world.calls.length = 0;
    const reviewed = await cli("review", "BLE-27", ...FLAGS);
    expect(reviewed.exitCode).toBe(0);
    expect(world.calls).toContain("herdr tab create --workspace w1 --cwd /worktrees/ble-27-compare-pdfs --label reviewer --no-focus");
    expect(world.calls).toContain(
      "herdr agent prompt rev-pdf-diff-ble-27 /code-review https://github.com/bleentr/pdf-diff/pull/12 against main for the spec at https://linear.app/bleentr/issue/BLE-27/title",
    );
    expect((await cli("show", "BLE-27", "--json")).json().stage).toBe("Review launched");
  });

  test("a closed unmerged PR attachment is not linked, like a GitHub closing reference", async () => {
    const { cli, world } = await withLinearRepo();
    await cli("dispatch", "BLE-27", ...FLAGS);
    world.linearAttachments.set("BLE-27", ["https://github.com/bleentr/pdf-diff/pull/12"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 12, state: "closed" });
    expect((await cli("show", "BLE-27", "--json")).json().stage).toBe("Implementing");
  });

  test("closing needs confirmation until the issue has a PR in the Repo", async () => {
    const { cli, world } = await withLinearRepo();
    await cli("dispatch", "BLE-27", ...FLAGS);

    expect((await cli("close", "BLE-27", "--json")).json().error).toBe("BLE-27 has no PR yet; closing requires confirmation");
    world.linearAttachments.set("BLE-27", ["https://github.com/bleentr/pdf-diff/pull/12"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 12, state: "merged" });
    const closed = await cli("close", "BLE-27");
    expect(closed.exitCode).toBe(0);
    expect(closed.stdout).toContain("closed: BLE-27");
  });
});

describe("Linear dispatch in the app", () => {
  test("a Linear Ready row's dispatch form names its Repo, and dispatches into it", async () => {
    const { web, world } = await withLinearRepo("web");
    const board = JSON.parse((await web("/api/board")).body);
    const target = dispatchTarget(board, "BLE-27", "bleentr/web")!;
    expect(target).toMatchObject({ issue: "BLE-27", repo: "bleentr/web" });

    const choice = launchChoice(JSON.parse((await web("/api/harnesses")).body), { harness: "claude", model: "opus", effort: "high" })!;
    const args = launchArgs("dispatch", target, choice, {});
    expect(args).toEqual(["BLE-27", "--harness", "claude", "--model", "opus", "--effort", "high", "--repo", "bleentr/web", "--base", "main"]);
    expect((await web("/api/dispatch", { method: "POST", body: JSON.stringify({ args }) })).status).toBe(200);
    expect(world.calls).toContain("herdr worktree create --cwd /src/web --branch nico/ble-27-compare-pdfs --base origin/main --label web:BLE-27 --no-focus");
  });

  test("its form offers the Repo's Base choice", async () => {
    const { web, world } = await withLinearRepo();
    world.remoteBranches.set("/src/pdf-diff", ["main", "beta"]);
    const target = dispatchTarget(JSON.parse((await web("/api/board")).body), "BLE-27", "bleentr/pdf-diff")!;
    expect(target.base).toEqual({ branches: ["main", "beta"], selected: "main" });
  });
});
