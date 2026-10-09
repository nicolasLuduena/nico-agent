import { describe, expect, test } from "bun:test";
import { type HarnessesJson, launchArgs, launchChoice } from "../src/app/actions";
import type { BoardJson } from "../src/app/board";
import { repoRows } from "../src/app/repo-rows";
import { RateLimited } from "../src/world";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return { ...ctx, board: async (): Promise<BoardJson> => (await ctx.cli("board", "--json")).json() };
}

describe("the Repos pane's rows", () => {
  test("a row per configured Repo, in order: one with nothing on it, one whose read failed says why", async () => {
    const { cli, world, board } = await githubRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.failGitHub("acme/web", "GitHub is not reachable");

    const rows = repoRows(await board());
    expect(rows.map((r) => [r.repo, r.errors, r.empty])).toEqual([
      ["acme/api", [], true],
      ["acme/web", ["Could not load: GitHub is not reachable"], false],
    ]);
    expect(rows[0]).toMatchObject({ summary: { inFlight: 0, asking: 0, held: 0 }, dispatches: [], held: [], next: [], queue: [] });
  });

  test("a rate-limited GitHub leaves a Repo it could not read saying so, not Idle", async () => {
    const { world, board } = await githubRepo();
    const reset = new Date(world.now().getTime() + 5 * 60_000);
    world.failGitHub("acme/api", new RateLimited(reset));

    const [api] = repoRows(await board());
    expect(api!.errors).toEqual([`Could not load: GitHub rate limit exceeded; nico-agent asks it again at ${reset.toISOString()}`]);
    expect(api!.empty).toBe(false);
  });

  test("each In-flight Dispatch with its title, Stage, Agent state and PR, and an Asking Implementer's question; counted while collapsed", async () => {
    const { cli, world, board } = await githubRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    world.addIssue("acme/api", { number: 8, title: "Drop the old client" });
    world.addIssue("acme/web", { number: 4, title: "Fix header" });
    for (const issue of ["acme/api#7", "acme/api#8", "acme/web#4"]) expect((await cli("dispatch", issue, ...FLAGS)).exitCode).toBe(0);
    world.linkPr("acme/api", 8, { number: 80 });
    world.agentStates.set("impl-api-7", "blocked");
    world.screens.set("impl-api-7", "Allow `rm -rf build`? (y/n)");

    const [api, web] = repoRows(await board());
    expect(api!.summary).toEqual({ inFlight: 2, asking: 1, held: 0 });
    expect(api!.dispatches).toEqual([
      { issue: "acme/api#7", label: "#7", title: "Add retries", url: "https://github.com/acme/api/issues/7", stage: "Implementing", agent: "blocked", question: "Allow `rm -rf build`? (y/n)", review: false, confirmClose: true },
      { issue: "acme/api#8", label: "#8", title: "Drop the old client", url: "https://github.com/acme/api/issues/8", stage: "PR ready", agent: "working", pr: { url: "https://github.com/acme/api/pull/80", number: 80 }, review: true, confirmClose: false },
    ]);
    expect(api!.empty).toBe(false);
    expect(web!.summary).toEqual({ inFlight: 1, asking: 0, held: 0 });
    expect(web!.dispatches.map((d) => d.label)).toEqual(["#4"]);
  });

  test("an Asking Implementer whose screen could not be read says why in place of its question", async () => {
    const { cli, world, board } = await githubRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    await cli("dispatch", "acme/api#7", ...FLAGS);
    world.agentStates.set("impl-api-7", "blocked");
    world.failHerdr("agent read", "herdr is not running");

    const [api] = repoRows(await board());
    expect(api!.dispatches[0]!.question).toBe("Could not read its screen: herdr is not running");
  });

  test("each Held Spec with its reason; what starts next: the running Specs' next issues, then the Queue in order", async () => {
    const { cli, world, board } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Invoices" }, { number: 12, title: "Refunds" });
    world.addGitHubSpec("acme/api", { number: 30, title: "Search" }, { number: 31 });
    world.addGitHubSpec("acme/api", { number: 40, title: "Exports" }, { number: 41 }, { number: 42 });
    world.addIssue("acme/api", { number: 20, title: "A bug" });
    world.addIssue("acme/api", { number: 50, title: "Not queued" });
    expect((await cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
    world.linkPr("acme/api", 11, { number: 111 });
    world.failHerdr("tab create", "herdr is not running");
    await cli("dispatch", "acme/api#41", ...FLAGS);
    world.failures.clear();
    await cli("queue", "acme/api#30", "--repo", "acme/api");
    await cli("queue", "acme/api#20", "--repo", "acme/api");

    const [api] = repoRows(await board());
    expect(api!.summary).toEqual({ inFlight: 2, asking: 0, held: 1 });
    expect(api!.held).toEqual([
      { spec: "acme/api#40", label: "#40", title: "Exports", url: "https://github.com/acme/api/issues/40", reason: "acme/api#41's Dispatch Failed at tab: herdr is not running" },
    ]);
    expect(api!.next).toEqual([
      { spec: "acme/api#10", specLabel: "#10", specTitle: "Billing", issue: "acme/api#12", label: "#12", title: "Refunds", url: "https://github.com/acme/api/issues/12" },
    ]);
    expect(api!.queue).toEqual([
      { spec: "acme/api#30", label: "#30", title: "Search", url: "https://github.com/acme/api/issues/30" },
      { spec: "acme/api#20", label: "#20", title: "A bug", url: "https://github.com/acme/api/issues/20" },
    ]);
  });
});

describe("the Repos pane's actions", () => {
  const harnesses = async (web: (path: string) => Promise<{ body: string }>): Promise<HarnessesJson> => JSON.parse((await web("/api/harnesses")).body);

  test("an expanded Repo lists its Ready and Stackable issues, each dispatched as its own form posts it", async () => {
    const { cli, world, web, board } = await githubRepo();
    world.remoteBranches.set("/src/api", ["beta", "main"]);
    world.addIssue("acme/api", { number: 5, title: "Blocker", labels: [] });
    world.linkPr("acme/api", 5, { number: 50, headBranch: "agent/api-5" });
    world.addIssue("acme/api", { number: 6, title: "Stacks on 5", blockers: [{ slug: "acme/api", number: 5, state: "open" }] });
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    world.addIssue("acme/api", { number: 8, title: "Already going" });
    await cli("dispatch", "acme/api#8", ...FLAGS);

    const [api] = repoRows(await board());
    expect(api!.issues.map((i) => [i.kind, i.label, i.title])).toEqual([["ready", "#7", "Add retries"], ["stackable", "#6", "Stacks on 5"]]);
    expect(api!.empty).toBe(false);
    const choice = launchChoice(await harnesses(web), { harness: "claude", model: "opus", effort: "high" })!;
    const [ready, stackable] = api!.issues;
    expect(launchArgs("dispatch", ready!.target, choice, { base: "beta" })).toEqual(["acme/api#7", ...FLAGS, "--base", "beta"]);
    expect(launchArgs("dispatch", stackable!.target, choice, {})).toEqual(["acme/api#6", ...FLAGS, "--stack-on", "acme/api#5"]);
  });

  test("a Linear issue's dispatch names the Repo whose row it is in", async () => {
    const { cli, world, web, board } = await githubRepo();
    await cli("repo", "add", "acme/api", "--path", "/src/api", "--linear-team", "BLE");
    world.addLinearIssue({ identifier: "BLE-27", title: "Search" });

    const [api] = repoRows(await board());
    const choice = launchChoice(await harnesses(web), { harness: "claude", model: "opus", effort: "high" })!;
    expect(launchArgs("dispatch", api!.issues[0]!.target, choice, {})).toEqual(["BLE-27", ...FLAGS, "--repo", "acme/api", "--base", "main"]);
  });

  test("a Dispatch offers review once its PR is linked and no Reviewer started, and Close asks to confirm only while it has no PR", async () => {
    const { cli, world, web, board } = await githubRepo();
    for (const number of [3, 4, 9]) world.addIssue("acme/api", { number });
    for (const issue of ["acme/api#3", "acme/api#4", "acme/api#9"]) await cli("dispatch", issue, ...FLAGS);
    world.linkPr("acme/api", 3, { number: 13 });
    world.linkPr("acme/api", 9, { number: 19 });
    await cli("review", "acme/api#9", ...FLAGS);

    const [api] = repoRows(await board());
    expect(api!.dispatches.map((d) => [d.label, d.review, d.confirmClose])).toEqual([["#3", true, false], ["#4", false, true], ["#9", false, false]]);
    const choice = launchChoice(await harnesses(web), { harness: "claude", model: "sonnet", effort: "max" })!;
    expect(launchArgs("review", { issue: api!.dispatches[0]!.issue }, choice, {})).toEqual(["acme/api#3", "--harness", "claude", "--model", "sonnet", "--effort", "max"]);
  });
});
