import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return ctx;
}

/** A candidate Spec's Queue button, as its heading or row shows it. */
function queueButton(spec: string, repo = "acme/api") {
  return `<form method="post" action="/queue" class="queue" hx-post="/queue" hx-target="closest section.repo" hx-swap="outerHTML"><input type="hidden" name="repo" value="${repo}"><input type="hidden" name="spec" value="${spec}"><button>Queue</button></form>`;
}

/** The Repo section of `slug` on the web Board. */
async function repoSection(web: Awaited<ReturnType<typeof githubRepo>>["web"], slug: string) {
  const { body } = await web("/classic");
  const start = body.indexOf(`<section class="repo">\n<header><h2>${slug}</h2>`);
  expect(start).toBeGreaterThan(-1);
  return body.slice(start, body.indexOf("</section>", start));
}

describe("web Board grouped by Spec", () => {
  test("rows are grouped under their Spec, and loose issues follow as Specs of one", async () => {
    const { web, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Invoices" }, { number: 12, blockers: [{ slug: "acme/api", number: 11, state: "open" }] });
    world.addIssue("acme/api", { number: 20, title: "A bug from triage" });

    const section = await repoSection(web, "acme/api");
    const spec = section.indexOf([
      '<div class="spec candidate">',
      '<header><span class="spec-state">Candidate</span><a class="title" href="https://github.com/acme/api/issues/10"><span class="num">#10</span> Billing</a>' + queueButton("acme/api#10") + '</header>',
      '<p class="spec-note">acme/api#11 is the first unblocked issue of acme/api#10; the Spec has no open PR, so it starts from main</p>',
      '<ul class="issues">',
      '<li><input type="checkbox" class="pick" name="issue" value="acme/api#11"',
    ].join("\n"));
    expect(spec).toBeGreaterThan(-1);
    const loose = section.indexOf('<h3>Specs of one</h3>\n<ul class="issues">\n<li><input type="checkbox" class="pick" name="issue" value="acme/api#20"');
    expect(loose).toBeGreaterThan(spec);
    // Each issue is listed once, and the Spec itself is never a row.
    expect(section.split('class="pick" name="issue" value="acme/api#11"').length).toBe(2);
    expect(section).not.toContain('name="issue" value="acme/api#10"');
  });

  test("each Repo shows its running Specs, the room left and its candidate Specs", async () => {
    const { cli, web, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12, blockers: [{ slug: "acme/api", number: 11, state: "open" }] });
    world.addGitHubSpec("acme/api", { number: 30, title: "Search" }, { number: 31 });
    world.addIssue("acme/api", { number: 20, title: "A bug from triage" });
    expect((await cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
    world.linkPr("acme/api", 11, { number: 16, headBranch: "agent/api-11" });

    const section = await repoSection(web, "acme/api");
    expect(section).toContain([
      '<div class="room" role="group" aria-label="Specs of acme/api">',
      '<span class="slots" aria-hidden="true"><i class="taken"></i><i></i></span>',
      "<span>Running <b>1</b></span><span>Room <b>1</b></span><span>Candidates <b>2</b></span><span>Queue <b>0</b></span>",
      "</div>",
    ].join(""));
    expect(section).toContain([
      '<div class="spec running">',
      '<header><span class="spec-state">Running</span><a class="title" href="https://github.com/acme/api/issues/10"><span class="num">#10</span> Billing</a></header>',
      '<p class="spec-note">acme/api#12 is the first unblocked issue of acme/api#10; it stacks on the Spec&#39;s newest open PR</p>',
      '<ul class="issues">',
      '<li class="member" data-issue="acme/api#11"><a class="title" href="https://github.com/acme/api/issues/11"><span class="num">#11</span> Issue 11</a><span class="stage pr-ready">PR ready</span><a class="pr" href="https://github.com/acme/api/pull/16">PR #16</a></li>',
      '<li><input type="checkbox" class="pick" name="issue" value="acme/api#12"',
    ].join("\n"));
    expect(section).toContain('<div class="spec candidate">\n<header><span class="spec-state">Candidate</span><a class="title" href="https://github.com/acme/api/issues/30"><span class="num">#30</span> Search</a>' + queueButton("acme/api#30") + '</header>');
    // Running Specs come first, then the candidates.
    expect(section.indexOf('class="spec running"')).toBeLessThan(section.indexOf('class="spec candidate"'));
  });

  test("a full Repo has no room, and a Spec of one running is listed with its Stage", async () => {
    const { cli, web, world } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "A bug from triage" });
    world.addIssue("acme/api", { number: 21, title: "Another bug" });
    world.addIssue("acme/api", { number: 22, title: "A third bug" });
    await cli("dispatch", "acme/api#20", ...FLAGS);
    await cli("dispatch", "acme/api#21", ...FLAGS);

    const section = await repoSection(web, "acme/api");
    expect(section).toContain('<span class="slots" aria-hidden="true"><i class="taken"></i><i class="taken"></i></span><span>Running <b>2</b></span><span>Room <b>0</b></span><span>Candidates <b>1</b></span>');
    expect(section).toContain([
      '<div class="spec running">',
      '<header><span class="spec-state">Running</span><a class="title" href="https://github.com/acme/api/issues/20"><span class="num">#20</span> A bug from triage</a><span class="stage implementing">Implementing</span></header>',
      '<p class="spec-note">acme/api#20 is Implementing; a Spec has one Implementer at a time</p>',
      "</div>",
    ].join("\n"));
  });

  test("a Held Spec shows its reason", async () => {
    const ctx = setup();
    const { cli, web, world } = ctx;
    world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" }, { identifier: "BLE-12" });
    world.failHerdr("agent start", "herdr is not running");
    await cli("dispatch", "BLE-11", ...FLAGS, "--repo", "bleentr/pdf-diff");
    world.clearFailures();

    const section = await repoSection(web, "bleentr/pdf-diff");
    expect(section).toContain([
      '<div class="spec held">',
      '<header><span class="spec-state">Held</span><a class="title" href="https://linear.app/bleentr/issue/BLE-10/title"><span class="num">BLE-10</span> PDF diffing</a></header>',
      '<p class="spec-note error">BLE-11&#39;s Dispatch Failed at agent start: herdr is not running</p>',
      '<ul class="issues">',
      '<li class="member" data-issue="BLE-11">',
    ].join("\n"));
    expect(section).toContain("<span>Running <b>1</b></span><span>Room <b>1</b></span><span>Candidates <b>0</b></span>");
  });

  test("a Spec with one sub-issue still lists that issue under it, with its Stage", async () => {
    const { cli, web, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 40, title: "Exports" }, { number: 41, title: "CSV export" });
    await cli("dispatch", "acme/api#41", ...FLAGS);

    const section = await repoSection(web, "acme/api");
    expect(section).toContain('<span class="num">#40</span> Exports</a></header>');
    expect(section).toContain('<li class="member" data-issue="acme/api#41"><a class="title" href="https://github.com/acme/api/issues/41"><span class="num">#41</span> CSV export</a><span class="stage implementing">Implementing</span></li>');
  });

  test("a Linear Spec claimed by two Repos shows its In-flight issue only in the Repo it was dispatched in", async () => {
    const { cli, web, world } = setup();
    world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
    world.addClone("/src/web", "git@github.com:bleentr/web.git");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
    await cli("repo", "add", "bleentr/web", "--path", "/src/web", "--linear-team", "BLE");
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" }, { identifier: "BLE-12" });
    await cli("dispatch", "BLE-11", ...FLAGS, "--repo", "bleentr/pdf-diff");

    expect(await repoSection(web, "bleentr/pdf-diff")).toContain('<li class="member" data-issue="BLE-11">');
    expect(await repoSection(web, "bleentr/web")).not.toContain('data-issue="BLE-11"');
  });
});
