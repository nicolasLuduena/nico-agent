import { describe, expect, test } from "bun:test";
import type { BoardJson } from "../src/app/board";
import { repoRows } from "../src/app/repo-rows";
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
      { issue: "acme/api#7", label: "#7", title: "Add retries", url: "https://github.com/acme/api/issues/7", stage: "Implementing", agent: "blocked", question: "Allow `rm -rf build`? (y/n)" },
      { issue: "acme/api#8", label: "#8", title: "Drop the old client", url: "https://github.com/acme/api/issues/8", stage: "PR ready", agent: "working", pr: { url: "https://github.com/acme/api/pull/80", number: 80 } },
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
