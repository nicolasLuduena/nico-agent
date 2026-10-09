import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return ctx;
}

/** What the app at `/` reads from `board --json` to draw the Board as `/classic` does. */
describe("board --json for the app", () => {
  test("names every configured Repo, in config order, even one with nothing Ready", async () => {
    const { cli, world } = await githubRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addIssue("acme/web", { number: 1, title: "Only web has work" });

    expect((await cli("board", "--json")).json().configured).toEqual(["acme/api", "acme/web"]);
  });

  test("still names the Repos when none could be loaded", async () => {
    const { cli, world } = await githubRepo();
    world.failGitHub("acme/api", "not authenticated with GitHub; run `gh auth login`");
    expect((await cli("board", "--json")).json().configured).toEqual(["acme/api"]);
  });

  test("Ready, Stackable and PR-open issues carry their Repo and URL, for their section and hover card", async () => {
    const { cli, world } = await githubRepo();
    world.addIssue("acme/api", { number: 1, title: "Ready one" });
    world.addIssue("acme/api", { number: 2, title: "Blocker" , labels: [] });
    world.linkPr("acme/api", 2, { number: 40, headBranch: "agent/api-2" });
    world.addIssue("acme/api", { number: 3, title: "Stacks on 2", blockers: [{ slug: "acme/api", number: 2, state: "open" }] });
    world.addIssue("acme/api", { number: 4, title: "Started by hand" });
    world.linkPr("acme/api", 4, { number: 41, headBranch: "fix-4" });

    const json = (await cli("board", "--json")).json();
    expect(json.issues).toEqual([{ issue: "acme/api#1", title: "Ready one", repo: "acme/api", url: "https://github.com/acme/api/issues/1", base: "main" }]);
    expect(json.stackable).toMatchObject([{ issue: "acme/api#3", repo: "acme/api", url: "https://github.com/acme/api/issues/3" }]);
    expect(json.prOpen).toMatchObject([{ issue: "acme/api#4", repo: "acme/api", url: "https://github.com/acme/api/issues/4", pr: "https://github.com/acme/api/pull/41" }]);
  });

  test("a Spec carries its URL, and a candidate Spec what it would start", async () => {
    const { cli, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Invoices" });

    const spec = (await cli("board", "--json")).json().specs.find((s: { spec: string }) => s.spec === "acme/api#10");
    expect(spec).toMatchObject({
      url: "https://github.com/acme/api/issues/10",
      running: false,
      next: { issue: "acme/api#11", reason: "acme/api#11 is the first unblocked issue of acme/api#10; the Spec has no open PR, so it starts from main" },
    });
  });

  test("an In-flight Dispatch carries its Repo, URL, failure and warnings", async () => {
    const { cli, world } = await githubRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    world.failHerdr("tab create", "herdr is not running");
    await cli("dispatch", "acme/api#7", ...FLAGS);

    const [row] = (await cli("board", "--json")).json().dispatches;
    expect(row).toMatchObject({
      issue: "acme/api#7", repo: "acme/api", url: "https://github.com/acme/api/issues/7",
      stage: "Failed at tab", failure: "herdr is not running",
    });
  });
});
