import { expect, test } from "bun:test";
import { setup } from "./harness";

test("a Repo's Linear team selector adds Ready issues beside GitHub issues", async () => {
  const { cli, web, world } = setup();
  world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  const added = await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  expect(added.exitCode).toBe(0);
  world.addIssue("bleentr/pdf-diff", { number: 1, title: "GitHub issue" });
  world.addLinearIssue({ identifier: "BLE-27", title: "Linear issue" });
  expect((await cli("--json")).json().issues).toEqual([
    { issue: "bleentr/pdf-diff#1", title: "GitHub issue", base: "main" },
    { issue: "BLE-27", title: "Linear issue", repo: "bleentr/pdf-diff", base: "main" },
  ]);
  const page = await web("/");
  expect(page.body).toContain("BLE-27 Linear issue");
  expect(page.body).toContain("#1 GitHub issue");
});

test("selectors narrow by project and label, and an issue appears under every matching Repo", async () => {
  const { cli, web, world } = setup();
  for (const [name, flags] of [
    ["all", []], ["project", ["--linear-project", "PDF diff"]], ["label", ["--linear-label", "pdf"]],
    ["both", ["--linear-project", "project-pdf", "--linear-label", "pdf"]],
  ] as const) {
    world.addClone(`/src/${name}`, `git@github.com:bleentr/${name}.git`);
    expect((await cli("repo", "add", `bleentr/${name}`, "--path", `/src/${name}`, "--linear-team", "BLE", ...flags)).exitCode).toBe(0);
  }
  world.addLinearIssue({ identifier: "BLE-27", project: { id: "project-pdf", name: "PDF diff" }, labels: ["ready-for-agent", "pdf"] });
  world.addLinearIssue({ identifier: "BLE-28", project: { id: "project-web", name: "Web" } });
  world.addLinearIssue({ identifier: "OTHER-1", team: { id: "other", key: "OTHER", name: "Other" } });
  const board = (await cli("--json")).json();
  expect(board.issues.map((i: { issue: string }) => i.issue)).toEqual(["BLE-27", "BLE-28", "BLE-27", "BLE-27", "BLE-27"]);
  const page = (await web("/")).body;
  expect(page.match(/BLE-27 BLE-27/g)).toHaveLength(4);
  expect(page.match(/BLE-28 BLE-28/g)).toHaveLength(1);
  expect(page).not.toContain("OTHER-1");
});

test("Linear Ready excludes started, done, unlabeled, taken and blocked issues", async () => {
  const { cli, world } = setup();
  world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  world.addLinearIssue({ identifier: "BLE-1", state: "backlog" });
  world.addLinearIssue({ identifier: "BLE-2", assignee: world.linearUser, blockers: [{ state: "completed" }, { state: "canceled" }] });
  world.addLinearIssue({ identifier: "BLE-3", state: "started" });
  world.addLinearIssue({ identifier: "BLE-4", assignee: "someone-else" });
  world.addLinearIssue({ identifier: "BLE-5", blockers: [{ state: "unstarted" }] });
  world.addLinearIssue({ identifier: "BLE-6", blockers: [{ state: "started" }] });
  world.addLinearIssue({ identifier: "BLE-7", labels: [] });
  world.addLinearIssue({ identifier: "BLE-8", state: "completed" });
  world.addLinearIssue({ identifier: "BLE-9", state: "canceled" });
  expect((await cli("--json")).json().issues.map((i: { issue: string }) => i.issue)).toEqual(["BLE-1", "BLE-2"]);
});

test("a failing Linear Source preserves GitHub issues in CLI and web for the same Repo", async () => {
  const { cli, web, world } = setup();
  world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  world.addIssue("bleentr/pdf-diff", { number: 1, title: "Still Ready" });
  world.linearFailure = "Missing LINEAR_API_KEY";
  const board = await cli("--json");
  expect(board.exitCode).toBe(0);
  expect(board.json().issues).toEqual([{ issue: "bleentr/pdf-diff#1", title: "Still Ready", base: "main" }]);
  expect(board.json().errors).toEqual([{ repo: "bleentr/pdf-diff", source: "Linear", error: "Missing LINEAR_API_KEY" }]);
  expect((await web("/")).body).toContain("#1 Still Ready");
  expect((await web("/")).body).toContain("Linear: Missing LINEAR_API_KEY");
  world.linearFailure = null;
  world.failGitHub("bleentr/pdf-diff", "GitHub down");
  world.addLinearIssue({ identifier: "BLE-27" });
  expect((await cli("--json")).exitCode).toBe(0);
  expect((await web("/")).body).toContain("BLE-27 BLE-27");
  world.linearFailure = "Linear down";
  expect((await cli()).exitCode).toBe(1);
});

test("repo add requires a team for project and label, and updates a selector without moving the clone", async () => {
  const { cli, world } = setup();
  world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  expect((await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-label", "pdf")).exitCode).toBe(2);
  await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE", "--linear-project", "PDF diff");
  expect((await cli("repo", "list", "--json")).json().repos[0].linear).toEqual({ team: "BLE", project: "PDF diff" });
});

for (const ref of ["BLE-27", "https://linear.app/bleentr/issue/BLE-27/title?foo=1"]) {
  test(`recognizes ${ref} as a Linear issue reference`, async () => {
    const { cli } = setup();
    const result = await cli("show", ref);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Linear issue BLE-27 is recognized");
    expect(result.stdout).not.toContain("not an issue reference");
  });
}

test("Linear Ready and GitHub Stackable issues share the Board, including a failed Linear Source", async () => {
  const { cli, web, world } = setup();
  world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  world.addIssue("bleentr/pdf-diff", { number: 7, title: "Stack this issue", blockers: [{ slug: "bleentr/pdf-diff", number: 6, state: "open" }] });
  world.linkPr("bleentr/pdf-diff", 6, { number: 16, headBranch: "agent/blocker-6" });
  world.addLinearIssue({ identifier: "BLE-27", title: "Linear Ready issue" });

  const board = (await cli("board", "--json")).json();
  expect(board.issues).toEqual([{ issue: "BLE-27", title: "Linear Ready issue", repo: "bleentr/pdf-diff", base: "main" }]);
  expect(board.stackable).toEqual([{ issue: "bleentr/pdf-diff#7", title: "Stack this issue", blockers: [{ issue: "bleentr/pdf-diff#6", pr: "https://github.com/bleentr/pdf-diff/pull/16", base: "agent/blocker-6" }] }]);
  const page = (await web("/")).body;
  expect(page).toContain("BLE-27 Linear Ready issue");
  expect(page).toContain("<h3>Stackable</h3>");
  expect(page).toContain("#7 Stack this issue");

  world.linearFailure = "Linear unavailable";
  const partial = await cli("board", "--json");
  expect(partial.exitCode).toBe(0);
  expect(partial.json().stackable).toEqual(board.stackable);
  expect(partial.json().errors).toEqual([{ repo: "bleentr/pdf-diff", source: "Linear", error: "Linear unavailable" }]);
  const partialPage = (await web("/")).body;
  expect(partialPage).toContain("Linear: Linear unavailable");
  expect(partialPage).toContain("<h3>Stackable</h3>");
  expect(partialPage).toContain("#7 Stack this issue");
});
