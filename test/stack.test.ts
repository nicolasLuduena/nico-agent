import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function stackable() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7, blockers: [{ slug: "acme/api", number: 6, state: "open" }] });
  ctx.world.linkPr("acme/api", 6, { number: 16, headBranch: "agent/blocker-6" });
  return ctx;
}

test("the Board offers issues whose open Blockers all have same-Repo open PRs", async () => {
  const { cli, world } = await stackable();
  world.addIssue("acme/api", { number: 8, blockers: [{ slug: "acme/api", number: 5, state: "open" }] });
  world.linkPr("acme/api", 5, { number: 15, repo: "acme/other" });
  world.addIssue("acme/api", { number: 9, blockers: [{ slug: "acme/api", number: 4, state: "open" }] });
  const result = (await cli("board", "--json")).json();
  expect(result.stackable).toEqual([{ issue: "acme/api#7", title: "Issue 7", blockers: [{ issue: "acme/api#6", pr: "https://github.com/acme/api/pull/16", base: "agent/blocker-6" }] }]);
});

test("dispatch starts on the chosen Blocker PR and keeps its stacking context", async () => {
  const { cli, world } = await stackable();
  const result = await cli("dispatch", "acme/api#7", ...FLAGS);
  expect(result.exitCode).toBe(0);
  const shown = (await cli("show", "acme/api#7", "--json")).json();
  expect(shown.base).toBe("origin/agent/blocker-6");
  expect(world.calls).toContain("git -C /src/api fetch origin +refs/heads/agent/blocker-6:refs/remotes/origin/agent/blocker-6");
  expect(shown.stackedOn).toMatchObject({ issue: "acme/api#6", pr: { url: "https://github.com/acme/api/pull/16" } });
  expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/agent/blocker-6 --label api#7 --no-focus");
  expect(world.calls.find((c) => c.startsWith("herdr agent prompt"))).toContain("as the top of the stacked PRs on top of https://github.com/acme/api/pull/16 - check gh-stack if you are not aware of github's stacked PRs");
});

test("ambiguous stacking lists the choices and --stack-on selects a Blocker", async () => {
  const { cli, world } = await stackable();
  world.issues.get("acme/api")![0]!.blockers.push({ slug: "acme/api", number: 5, state: "open" });
  world.linkPr("acme/api", 5, { number: 15, headBranch: "agent/blocker-5", baseBranch: "agent/blocker-6" });
  const failed = await cli("dispatch", "acme/api#7", ...FLAGS, "--json");
  expect(failed.exitCode).toBe(1);
  expect(failed.json().help).toEqual([
    "Stack on https://github.com/acme/api/pull/16 with `--stack-on acme/api#6`",
    "Stack on https://github.com/acme/api/pull/15 with `--stack-on acme/api#5`",
  ]);
  expect((await cli("show", "acme/api#7")).exitCode).toBe(1);
  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "5")).exitCode).toBe(0);
  expect((await cli("show", "acme/api#7", "--json")).json().base).toBe("origin/agent/blocker-5");
});

test("the web offers Blocker choices and preserves the selection when the Harness changes", async () => {
  const { web, world, cli } = await stackable();
  world.issues.get("acme/api")![0]!.blockers.push({ slug: "acme/api", number: 5, state: "open" });
  world.linkPr("acme/api", 5, { number: 15, headBranch: "agent/blocker-5", baseBranch: "agent/blocker-6" });
  const { body } = await web("/classic");
  expect(body).toContain("<h3>Stackable</h3>");
  expect(body).toContain('<select name="stackOn">');
  expect(body).toContain('value="acme/api#5"');
  const changed = await web("/dispatch-form?issue=acme/api%237&harness=claude&model=sonnet&effort=high&stackOn=acme/api%235");
  expect(changed.body).toContain('<option value="acme/api#5" selected>');
  const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "sonnet", effort: "high", stackOn: "acme/api#5" });
  expect((await web("/dispatch", { method: "POST", body: form })).status).toBe(303);
  expect((await cli("show", "acme/api#7", "--json")).json().base).toBe("origin/agent/blocker-5");
  expect((await cli("board", "--json")).json().stackable).toBeUndefined();
});

test("dispatch refuses Blockers without same-Repo open PRs", async () => {
  const { cli, world } = await stackable();
  world.linkedPrs.clear();
  expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(1);
  world.linkPr("acme/api", 6, { number: 16, repo: "acme/other" });
  expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(1);
  world.linkedPrs.clear();
  world.linkPr("acme/api", 6, { number: 16, state: "merged" });
  expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(1);
  expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);
});

test("a failed Stacked dispatch retries with its saved PR even after the Blocker closes", async () => {
  const { cli, web, world } = await stackable();
  world.failHerdr("tab create", "workspace_not_found");
  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "6")).exitCode).toBe(1);
  const { body } = await web("/classic");
  expect(body).toContain('<input type="hidden" name="stackOn" value="https://github.com/acme/api/pull/16">');
  world.issues.get("acme/api")![0]!.blockers[0]!.state = "closed";
  world.linkedPrs.clear();
  world.clearFailures();
  const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "opus", effort: "high", stackOn: "https://github.com/acme/api/pull/16" });
  expect((await web("/dispatch", { method: "POST", body: form })).status).toBe(303);
  const shown = (await cli("show", "acme/api#7", "--json")).json();
  expect(shown.base).toBe("origin/agent/blocker-6");
  expect(shown.stackedOn.pr.url).toBe("https://github.com/acme/api/pull/16");
  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "5")).exitCode).toBe(1);
});

test("multiple PRs for one Blocker can be chosen by the PR URL listed in help", async () => {
  const { cli, world } = await stackable();
  world.linkPr("acme/api", 6, { number: 17, headBranch: "agent/alternate-6" });
  const failed = (await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "6", "--json")).json();
  expect(failed.help).toContain("Stack on https://github.com/acme/api/pull/17 with `--stack-on https://github.com/acme/api/pull/17`");
  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--stack-on", "https://github.com/acme/api/pull/17")).exitCode).toBe(0);
  expect((await cli("show", "acme/api#7", "--json")).json().base).toBe("origin/agent/alternate-6");
});

test("the real CLI recognizes a same-Repo PR closing a Blocker from another repo", async () => {
  const { configDir } = await stackable();
  const binDir = join(configDir, "fake-bin");
  mkdirSync(binDir);
  const issue = { number: 7, title: "Issue 7", url: "https://github.com/acme/api/issues/7", state: "OPEN",
    labels: { nodes: [{ name: "ready-for-agent" }] }, assignees: { nodes: [] },
    blockedBy: { nodes: [{ number: 6, state: "OPEN", repository: { nameWithOwner: "acme/other" } }] },
    parent: null, subIssuesSummary: { total: 0 } };
  const pr = { number: 16, url: "https://github.com/acme/api/pull/16", state: "OPEN", baseRefName: "main",
    headRefName: "agent/blocker-6", headRepository: { nameWithOwner: "acme/api" }, repository: { nameWithOwner: "acme/api" } };
  writeFileSync(join(binDir, "issues.json"), JSON.stringify({ data: { repository: { issues: { nodes: [issue], pageInfo: { hasNextPage: false } } } } }));
  writeFileSync(join(binDir, "prs.json"), JSON.stringify({ data: { repository: { issue: { closedByPullRequestsReferences: { nodes: [pr] } } } } }));
  const gh = join(binDir, "gh");
  writeFileSync(gh, `#!/bin/sh\ncase "$*" in\n*"api user"*) printf 'me';;\n*"issues(first"*) cat "${binDir}/issues.json";;\n*closedByPullRequestsReferences*"number=6"*) cat "${binDir}/prs.json";;\n*closedByPullRequestsReferences*) printf '{"data":{"repository":{"issue":{"closedByPullRequestsReferences":{"nodes":[]}}}}}';;\n*"pr list"*) printf '[]';;\n*) cat "${binDir}/issues.json";;\nesac\n`);
  chmodSync(gh, 0o755);
  const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;
  const worldPath = new URL("../src/real-world.ts", import.meta.url).pathname;
  const script = `import { run } from ${JSON.stringify(cliPath)}; import { RealWorld } from ${JSON.stringify(worldPath)};
    const result = await run(["board", "--json"], { world: new RealWorld(), configDir: ${JSON.stringify(configDir)}, bin: "nico-agent" });
    process.stdout.write(result.stdout); process.exitCode = result.exitCode;`;
  const proc = Bun.spawn([process.execPath, "--eval", script], { env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe" });
  const output = JSON.parse(await new Response(proc.stdout).text());
  expect(await proc.exited).toBe(0);
  expect(output.stackable).toEqual([{ issue: "acme/api#7", title: "Issue 7", blockers: [{ issue: "acme/other#6", pr: "https://github.com/acme/api/pull/16", base: "agent/blocker-6" }] }]);
});
