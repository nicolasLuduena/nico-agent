import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return ctx;
}

/** The Repo section of `slug` on the web Board. */
async function repoSection(web: Awaited<ReturnType<typeof githubRepo>>["web"], slug = "acme/api") {
  const { body } = await web("/classic");
  const start = body.indexOf(`<section class="repo">\n<header><h2>${slug}</h2>`);
  expect(start).toBeGreaterThan(-1);
  return body.slice(start, body.indexOf("</section>", start));
}

describe("issues with a PR but no Dispatch", () => {
  test("an open issue whose PR is open is listed as PR open, not Ready, on the web Board", async () => {
    const { web, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "Reviewed elsewhere" });
    world.addIssue("acme/api", { number: 21, title: "Still to do" });
    world.linkPr("acme/api", 20, { number: 40 });

    const section = await repoSection(web);
    expect(section).toContain([
      "<h3>PR open</h3>",
      '<ul class="issues">',
      '<li class="member"><a class="title" href="https://github.com/acme/api/issues/20"><span class="num">#20</span> Reviewed elsewhere</a><a class="pr" href="https://github.com/acme/api/pull/40">PR #40</a></li>',
      "</ul>",
    ].join("\n"));
    // Not offered for dispatch, nor counted as Ready.
    expect(section).not.toContain('value="acme/api#20"');
    expect(section).toContain('value="acme/api#21"');
    expect(section).toContain('<span class="count">1</span>');
  });

  test("a merged PR counts too, and a PR closed without merging leaves the issue Ready", async () => {
    const { web, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "Merged, issue left open" });
    world.addIssue("acme/api", { number: 21, title: "Rejected PR" });
    world.linkPr("acme/api", 20, { number: 40, state: "merged" });
    world.branchPrs.set("acme/api:agent/api-21", [{ repo: "acme/api", number: 41, url: "https://github.com/acme/api/pull/41", state: "closed", baseBranch: "main", headBranch: "agent/api-21" }]);

    const section = await repoSection(web);
    expect(section).toContain('<span class="num">#20</span> Merged, issue left open</a><a class="pr" href="https://github.com/acme/api/pull/40">PR #40</a>');
    expect(section).toContain('value="acme/api#21"');
  });

  test("in a Spec, an issue with a PR shows its PR in place of a Dispatch form", async () => {
    const { web, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Invoices" }, { number: 12, title: "Receipts" });
    world.linkPr("acme/api", 11, { number: 40 });

    const section = await repoSection(web);
    expect(section).toContain('<li class="member"><a class="title" href="https://github.com/acme/api/issues/11"><span class="num">#11</span> Invoices</a><a class="pr" href="https://github.com/acme/api/pull/40">PR #40</a></li>');
    expect(section).not.toContain('value="acme/api#11"');
    expect(section).not.toContain("<h3>PR open</h3>");
  });

  test("the CLI Board lists them apart from Ready issues", async () => {
    const { cli, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "Reviewed elsewhere" });
    world.addIssue("acme/api", { number: 21, title: "Still to do" });
    world.linkPr("acme/api", 20, { number: 40 });

    const board = (await cli("--json")).json();
    expect(board.ready).toBe("1 issue");
    expect(board.issues.map((i: { issue: string }) => i.issue)).toEqual(["acme/api#21"]);
    expect(board.prOpen).toEqual([{ issue: "acme/api#20", title: "Reviewed elsewhere", pr: "https://github.com/acme/api/pull/40", state: "open" }]);
  });
});
