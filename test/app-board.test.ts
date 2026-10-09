import { describe, expect, test } from "bun:test";
import { type BoardJson, repoSections, roomReadout, stageClass } from "../src/app/board";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return { ...ctx, board: async (): Promise<BoardJson> => (await ctx.cli("board", "--json")).json() };
}

/** A section's Spec groups as their state, heading key and rows' keys. */
const outline = (section: ReturnType<typeof repoSections>[number]) =>
  section.specs.map((s) => [s.state, s.label, s.rows.map((r) => `${r.kind} ${r.label}`)]);

describe("the app's Board model: Repos and Specs to sections and groups", () => {
  test("a section per configured Repo, in order, even one with nothing Ready", async () => {
    const { cli, world, board } = await githubRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addIssue("acme/web", { number: 4, title: "Fix header" });

    const sections = repoSections(await board());
    expect(sections.map((s) => [s.repo, s.count, s.empty])).toEqual([["acme/api", 0, true], ["acme/web", 1, false]]);
    expect(sections[1]!.specsOfOne).toMatchObject([{ kind: "ready", label: "#4", title: "Fix header", url: "https://github.com/acme/web/issues/4", base: "main" }]);
  });

  test("a Repo that failed to load says why, and is not called empty", async () => {
    const { world, board } = await githubRepo();
    world.failGitHub("acme/api", "GitHub is not reachable");
    const [section] = repoSections(await board());
    expect(section!.errors).toEqual(["Could not load: GitHub is not reachable"]);
    expect(section!.empty).toBe(false);
  });

  test("Specs group their issues in sub-issue order; loose issues stay Specs of one, Stackable or PR open", async () => {
    const { world, board } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11, title: "Invoices" }, { number: 12, blockers: [{ slug: "acme/api", number: 11, state: "open" }] });
    world.addIssue("acme/api", { number: 20, title: "A bug from triage" });
    world.addIssue("acme/api", { number: 5, title: "Blocker", labels: [] });
    world.linkPr("acme/api", 5, { number: 50, headBranch: "agent/api-5" });
    world.addIssue("acme/api", { number: 6, title: "Stacks on 5", blockers: [{ slug: "acme/api", number: 5, state: "open" }] });
    world.addIssue("acme/api", { number: 7, title: "Started by hand" });
    world.linkPr("acme/api", 7, { number: 70, headBranch: "fix-7" });

    const [section] = repoSections(await board());
    expect(outline(section!)).toEqual([["candidate", "#10", ["ready #11"]]]);
    expect(section!.specs[0]).toMatchObject({
      title: "Billing", url: "https://github.com/acme/api/issues/10",
      note: { text: "acme/api#11 has no open Blocker PR, so it starts from main", error: false },
      queue: { place: -1, of: 0 },
    });
    expect(section!.specsOfOne.map((r) => [r.label, r.queue])).toEqual([["#20", { place: -1, of: 0 }]]);
    expect(section!.stackable.map((r) => r.label)).toEqual(["#6"]);
    expect(section!.prOpen).toMatchObject([{ kind: "pr-open", label: "#7", pr: { url: "https://github.com/acme/api/pull/70", number: 70 } }]);
  });

  test("running Specs come first with their In-flight issues read-only, then Held, then candidates", async () => {
    const { cli, world, board } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 30, title: "Search" }, { number: 31 });
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
    world.addGitHubSpec("acme/api", { number: 40, title: "Held one" }, { number: 41 }, { number: 42 });
    expect((await cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);
    world.failHerdr("tab create", "herdr is not running");
    await cli("dispatch", "acme/api#41", ...FLAGS);

    const [section] = repoSections(await board());
    expect(outline(section!)).toEqual([
      ["running", "#10", ["in-flight #11", "ready #12"]],
      ["held", "#40", ["in-flight #41", "ready #42"]],
      ["candidate", "#30", ["ready #31"]],
    ]);
    expect(section!.specs[0]!.rows[0]).toMatchObject({ stage: "Implementing" });
    expect(section!.specs[1]!.note).toEqual({ text: expect.stringContaining("acme/api#41"), error: true });
  });

  test("a Spec of one In flight shows its Stage in its heading, with no row for itself", async () => {
    const { cli, world, board } = await githubRepo();
    world.addIssue("acme/api", { number: 20, title: "A bug from triage" });
    await cli("dispatch", "acme/api#20", ...FLAGS);

    const [section] = repoSections(await board());
    expect(outline(section!)).toEqual([["running", "#20", []]]);
    expect(section!.specs[0]!.stage).toBe("Implementing");
  });

  test("a Spec with one sub-issue still lists that issue under it, with its Stage", async () => {
    const { cli, world, board } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 40, title: "Exports" }, { number: 41, title: "CSV export" });
    await cli("dispatch", "acme/api#41", ...FLAGS);

    const [section] = repoSections(await board());
    expect(outline(section!)).toEqual([["running", "#40", ["in-flight #41"]]]);
    expect(section!.specs[0]!.rows[0]).toMatchObject({ title: "CSV export", stage: "Implementing" });
  });

  test("a Linear Spec claimed by two Repos shows its In-flight issue only in the Repo it was dispatched in", async () => {
    const { cli, world, board } = await githubRepo();
    world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
    world.addClone("/src/web", "git@github.com:bleentr/web.git");
    await cli("repo", "rm", "acme/api");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
    await cli("repo", "add", "bleentr/web", "--path", "/src/web", "--linear-team", "BLE");
    world.addLinearSpec({ identifier: "BLE-10", title: "PDF diffing" }, { identifier: "BLE-11" }, { identifier: "BLE-12" });
    await cli("dispatch", "BLE-11", ...FLAGS, "--repo", "bleentr/pdf-diff");

    const [pdf, web] = repoSections(await board());
    expect(outline(pdf!)).toEqual([["running", "BLE-10", ["in-flight BLE-11", "ready BLE-12"]]]);
    expect(outline(web!)[0]![2]).toEqual(["ready BLE-12"]);
  });

  test("a queued candidate knows its place in the Queue", async () => {
    const { cli, world, board } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 });
    world.addIssue("acme/api", { number: 20, title: "A bug" });
    await cli("queue", "acme/api#20", "--repo", "acme/api");
    await cli("queue", "acme/api#10", "--repo", "acme/api");

    const [section] = repoSections(await board());
    expect(section!.specs[0]!.queue).toEqual({ place: 1, of: 2 });
    expect(section!.specsOfOne[0]!.queue).toEqual({ place: 0, of: 2 });
  });
});

describe("the room readout", () => {
  test("a slot per Spec that may run, filled while one does, the figures, and the Queue in start order", async () => {
    const { cli, world, board } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12 });
    world.addGitHubSpec("acme/api", { number: 30, title: "Search" }, { number: 31 });
    world.addIssue("acme/api", { number: 20, title: "A bug" });
    await cli("dispatch", "acme/api#11", ...FLAGS);
    await cli("queue", "ACME/API#20", "--repo", "acme/api");
    await cli("queue", "acme/api#30", "--repo", "acme/api");

    const json = await board();
    const readout = roomReadout(json.rooms!.find((r) => r.repo === "acme/api")!);
    expect(readout).toEqual({
      slots: [true, false],
      figures: [["Running", 1], ["Room", 1], ["Candidates", 2], ["Queue", 2]],
      queue: ["#20", "#30"],
    });
    expect(repoSections(json)[0]!.room).toEqual(readout);
  });

  test("a Repo with no Specs has no readout", async () => {
    const { board } = await githubRepo();
    expect(repoSections(await board())[0]!.room).toBeUndefined();
  });
});

describe("one colour per Stage", () => {
  test("each Stage has its own colour, every Failed Stage the one of Failed, any other Stage none of them", () => {
    expect(["Implementing", "PR ready", "Review launched", "Failed at agent start", "Failed at review", "Merged"].map(stageClass))
      .toEqual(["implementing", "pr-ready", "review-launched", "failed", "failed", "unknown"]);
  });
});
