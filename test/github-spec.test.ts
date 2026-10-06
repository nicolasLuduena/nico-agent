import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function githubRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  return ctx;
}

describe("GitHub Specs", () => {
  test("a GitHub issue with sub-issues labelled ready-for-agent is a Spec, never Ready nor dispatched", async () => {
    const { cli, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" }, { number: 11 }, { number: 12, blockers: [{ slug: "acme/api", number: 11, state: "open" }] });

    const board = (await cli("--json")).json();
    expect(board.issues.map((i: { issue: string }) => i.issue)).toEqual(["acme/api#11"]);

    const refused = await cli("dispatch", "acme/api#10", ...FLAGS, "--json");
    expect(refused.exitCode).toBe(1);
    expect(refused.json().error).toBe("acme/api#10 is a Spec; dispatch its issues instead");
    expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);
  });

  test("the Board lists GitHub Specs with their issues in sub-issue order, and loose issues as Specs of one", async () => {
    const { cli, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing", labels: [] }, { number: 13 }, { number: 11, labels: [] }, { number: 12 });
    world.addGitHubSpec("acme/api", { number: 30, title: "Done Spec" }, { number: 31, state: "closed" });
    world.addIssue("acme/api", { number: 20, title: "A bug from triage" });
    world.addIssue("acme/api", { number: 21, title: "Not ready", labels: [] });

    const { specs } = (await cli("--json")).json();
    expect(specs).toEqual([
      { spec: "acme/api#10", title: "Billing", repo: "acme/api", issues: ["acme/api#13", "acme/api#11", "acme/api#12"], running: false },
      { spec: "acme/api#20", title: "A bug from triage", repo: "acme/api", issues: ["acme/api#20"], running: false },
    ]);
  });

  test("a running Spec's next issue is its first unblocked one, stacked on the Spec's newest open PR", async () => {
    const { cli, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" },
      { number: 11 }, { number: 12, blockers: [{ slug: "acme/api", number: 13, state: "open" }] }, { number: 13 });
    expect((await cli("dispatch", "acme/api#11", ...FLAGS)).exitCode).toBe(0);

    const implementing = (await cli("--json")).json().specs;
    expect(implementing).toEqual([{
      spec: "acme/api#10", title: "Billing", repo: "acme/api", issues: ["acme/api#11", "acme/api#12", "acme/api#13"], running: true,
      reason: "acme/api#11 is Implementing; a Spec has one Implementer at a time",
    }]);

    world.linkPr("acme/api", 11, { number: 16, headBranch: "agent/api-11" });
    const next = (await cli("--json")).json().specs[0];
    expect(next.next).toEqual({
      issue: "acme/api#13", stackOn: "https://github.com/acme/api/pull/16", base: "agent/api-11",
      reason: "acme/api#13 is the first unblocked issue of acme/api#10; it stacks on the Spec's newest open PR",
    });
    expect(next.reason).toBeUndefined();
  });

  test("a running Spec without an open PR starts its next issue from the Repo's default branch", async () => {
    const { cli, world } = await githubRepo();
    world.defaultBranches.set("/src/api", "trunk");
    world.addGitHubSpec("acme/api", { number: 10 }, { number: 11, state: "closed" }, { number: 12 });
    world.linkPr("acme/api", 11, { number: 16, state: "merged", headBranch: "agent/api-11" });

    const [spec] = (await cli("--json")).json().specs;
    expect(spec).toMatchObject({ spec: "acme/api#10", running: true, next: {
      issue: "acme/api#12", base: "trunk", reason: "acme/api#12 is the first unblocked issue of acme/api#10; the Spec has no open PR, so it starts from trunk",
    } });
    expect(spec.next.stackOn).toBeUndefined();
  });

  test("an issue blocked by another Spec's issue waits for that Blocker to close, never stacking across Specs", async () => {
    const { cli, world } = await githubRepo();
    world.addGitHubSpec("acme/api", { number: 20, title: "Parser" }, { number: 21, assignees: ["me"] });
    world.addGitHubSpec("acme/api", { number: 10, title: "Billing" },
      { number: 11, assignees: ["me"] }, { number: 12, blockers: [{ slug: "acme/api", number: 21, state: "open" }] });
    world.linkPr("acme/api", 11, { number: 16, headBranch: "agent/api-11" });
    world.linkPr("acme/api", 21, { number: 22, headBranch: "agent/api-21" });

    const board = (await cli("--json")).json();
    expect(board.specs.find((s: { spec: string }) => s.spec === "acme/api#10")).toEqual({
      spec: "acme/api#10", title: "Billing", repo: "acme/api", issues: ["acme/api#11", "acme/api#12"], running: false,
      waiting: { issue: "acme/api#12", blocker: "acme/api#21", reason: "acme/api#12 waits for acme/api#21, in another Spec, to close; a Stack never mixes Specs" },
    });
    expect(board.stackable).toBeUndefined();

    world.githubIssueNamed("acme/api", 12).blockers = [{ slug: "acme/api", number: 21, state: "closed" }];
    expect((await cli("--json")).json().specs.find((s: { spec: string }) => s.spec === "acme/api#10").next.issue).toBe("acme/api#12");
  });
});
