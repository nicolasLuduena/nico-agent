import { describe, expect, test } from "bun:test";
import { dispatchTarget } from "../src/app/actions";
import { repoSections } from "../src/app/board";
import { setup } from "./harness";

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return ctx;
}

/** The app's section of the first Repo, and the issues it offers a dispatch form for. */
async function repoSection(cli: Awaited<ReturnType<typeof githubRepo>>["cli"]) {
  const board = (await cli("board", "--json")).json();
  const [section] = repoSections(board);
  const rows = [...section!.specsOfOne, ...section!.stackable, ...section!.prOpen, ...section!.specs.flatMap((g) => g.rows)];
  return { section: section!, dispatchable: rows.filter((r) => dispatchTarget(board, r.key, "acme/api")).map((r) => r.key) };
}

describe("issues with a PR but no Dispatch", () => {
  test("an open issue whose PR is open is listed as PR open, not Ready, in the app", async () => {
    const { cli, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "Reviewed elsewhere" });
    world.addIssue("acme/api", { number: 21, title: "Still to do" });
    world.linkPr("acme/api", 20, { number: 40 });

    const { section, dispatchable } = await repoSection(cli);
    expect(section.prOpen).toEqual([{ kind: "pr-open", key: "acme/api#20", label: "#20", title: "Reviewed elsewhere", url: "https://github.com/acme/api/issues/20", pr: { url: "https://github.com/acme/api/pull/40", number: 40 } }]);
    // Not offered for dispatch, nor counted as Ready.
    expect(dispatchable).toEqual(["acme/api#21"]);
    expect(section.count).toBe(1);
  });

  test("a merged PR counts too, and a PR closed without merging leaves the issue Ready", async () => {
    const { cli, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "Merged, issue left open" });
    world.addIssue("acme/api", { number: 21, title: "Rejected PR" });
    world.linkPr("acme/api", 20, { number: 40, state: "merged" });
    world.branchPrs.set("acme/api:agent/api-21", [{ repo: "acme/api", number: 41, url: "https://github.com/acme/api/pull/41", state: "closed", baseBranch: "main", headBranch: "agent/api-21" }]);

    const { section, dispatchable } = await repoSection(cli);
    expect(section.prOpen).toMatchObject([{ key: "acme/api#20", pr: { number: 40 } }]);
    expect(dispatchable).toEqual(["acme/api#21"]);
  });

  test("in a Spec, an issue with a PR shows its PR in place of a Dispatch form", async () => {
    const { cli, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Invoices" }, { number: 12, title: "Receipts" });
    world.linkPr("acme/api", 11, { number: 40 });

    const { section, dispatchable } = await repoSection(cli);
    expect(section.specs[0]!.rows[0]).toMatchObject({ kind: "pr-open", key: "acme/api#11", pr: { number: 40 } });
    expect(dispatchable).not.toContain("acme/api#11");
    expect(section.prOpen).toEqual([]);
  });

  test("the CLI Board lists them apart from Ready issues", async () => {
    const { cli, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "Reviewed elsewhere" });
    world.addIssue("acme/api", { number: 21, title: "Still to do" });
    world.linkPr("acme/api", 20, { number: 40 });

    const board = (await cli("--json")).json();
    expect(board.ready).toBe("1 issue");
    expect(board.issues.map((i: { issue: string }) => i.issue)).toEqual(["acme/api#21"]);
    expect(board.prOpen).toEqual([{ issue: "acme/api#20", title: "Reviewed elsewhere", repo: "acme/api", url: "https://github.com/acme/api/issues/20", pr: "https://github.com/acme/api/pull/40", state: "open" }]);
  });
});
