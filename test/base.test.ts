import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchTarget } from "../src/app/actions";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function withRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.remoteBranches.set("/src/api", ["beta", "main"]);
  ctx.world.calls.length = 0;
  return ctx;
}

const promptOf = (calls: string[]) => calls.find((c) => c.startsWith("herdr agent prompt"));

test("--base starts the worktree from origin's branch and targets it in the prompt", async () => {
  const { cli, world } = await withRepo();
  world.addIssue("acme/api", { number: 7 });

  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "beta")).exitCode).toBe(0);
  expect(world.calls).toContain("git -C /src/api ls-remote --heads origin");
  expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/beta --label api#7 --no-focus");
  expect(promptOf(world.calls)).toBe("herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against beta");
  expect((await cli("show", "acme/api#7", "--json")).json().base).toBe("origin/beta");
});

test("without --base the Base is the last one used in the Repo, else the default branch", async () => {
  const { cli, world } = await withRepo();
  world.addIssue("acme/api", { number: 7 });
  world.addIssue("acme/api", { number: 8 });
  world.addIssue("acme/api", { number: 9 });

  await cli("dispatch", "acme/api#7", ...FLAGS);
  expect(promptOf(world.calls)).toEndWith("as draft PR against main");
  world.calls.length = 0;
  await cli("dispatch", "acme/api#8", ...FLAGS, "--base", "beta");
  world.calls.length = 0;
  await cli("dispatch", "acme/api#9", ...FLAGS);
  expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-9 --base origin/beta --label api#9 --no-focus");
  expect(promptOf(world.calls)).toEndWith("as draft PR against beta");
});

test("a last-used Base gone from origin falls back to the default branch", async () => {
  const { cli, world } = await withRepo();
  world.addIssue("acme/api", { number: 7 });
  world.addIssue("acme/api", { number: 8 });
  await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "beta");
  world.remoteBranches.set("/src/api", ["main"]);
  world.calls.length = 0;

  await cli("dispatch", "acme/api#8", ...FLAGS);
  expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-8 --base origin/main --label api#8 --no-focus");
});

test("an unknown --base exits 1 with help and sends no herdr commands", async () => {
  const { cli, world } = await withRepo();
  world.addIssue("acme/api", { number: 7 });

  const result = await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "nope", "--json");
  expect(result.exitCode).toBe(1);
  expect(result.json()).toEqual({
    error: "`nope` is not a branch on origin of acme/api",
    help: ["Pass `--base` one of origin's branches: beta, main"],
  });
  expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);
  expect((await cli("show", "acme/api#7")).exitCode).toBe(1);
});

test("re-running a Dispatch with another --base is refused", async () => {
  const { cli, world } = await withRepo();
  world.addIssue("acme/api", { number: 7 });
  await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "beta");

  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "beta")).exitCode).toBe(0);
  expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
  const other = await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "main", "--json");
  expect(other.exitCode).toBe(1);
  expect(other.json().error).toBe("acme/api#7 is already In flight with Base beta");
});

async function stackable() {
  const ctx = await withRepo();
  ctx.world.addIssue("acme/api", { number: 7, blockers: [{ slug: "acme/api", number: 6, state: "open" }] });
  ctx.world.linkPr("acme/api", 6, { number: 16, headBranch: "agent/blocker-6" });
  return ctx;
}

test("a Stacked dispatch ignores the last-used Base and fills {baseBranch} with the Blocker PR's head", async () => {
  const { cli, world } = await stackable();
  world.addIssue("acme/api", { number: 8 });
  await cli("dispatch", "acme/api#8", ...FLAGS, "--base", "beta");
  world.calls.length = 0;

  expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
  expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/agent/blocker-6 --label api#7 --no-focus");
  expect(promptOf(world.calls)).toStartWith("herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against agent/blocker-6 as the top");
  expect(world.calls.some((c) => c.includes("ls-remote"))).toBe(false);
});

test("a Stacked dispatch rejects --base, and its app form has no Base choice", async () => {
  const { cli, world } = await stackable();

  const result = await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "beta", "--json");
  expect(result.exitCode).toBe(1);
  expect(result.json().error).toBe("acme/api#7 is Stacked; its Base is the head branch of the PR it stacks on");
  expect(world.calls.some((c) => c.startsWith("herdr"))).toBe(false);

  const target = dispatchTarget((await cli("board", "--json")).json(), "acme/api#7", "acme/api");
  expect(target).toEqual({ issue: "acme/api#7", stack: [{ value: "acme/api#6", label: "acme/api#6 · PR #16 · base agent/blocker-6" }] });
});

test("{baseBranch} is a known placeholder custom prompts can use", async () => {
  const { cli, world, configDir } = await withRepo();
  world.addIssue("acme/api", { number: 7 });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    repos: [{ slug: "acme/api", path: "/src/api" }],
    prompts: { implement: "{sigil}implement {issueUrl} onto {baseBranch}" },
  }));

  expect((await cli("dispatch", "acme/api#7", ...FLAGS, "--base", "beta")).exitCode).toBe(0);
  expect(promptOf(world.calls)).toBe("herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 onto beta");

  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    repos: [{ slug: "acme/api", path: "/src/api" }],
    prompts: { implement: "{nope}" },
  }));
  const bad = (await cli("repo", "list", "--json")).json();
  expect(bad.help).toEqual(["Placeholders: {sigil}, {issueUrl}, {baseBranch}, {prUrl}, {prBaseBranch}, {repo}, {prs}"]);
});

test("the app's dispatch form lists origin's branches, preselecting the last-used Base", async () => {
  const { cli, web, world } = await withRepo();
  world.addIssue("acme/api", { number: 7 });
  world.addIssue("acme/api", { number: 8 });
  const base = async (issue: string) => dispatchTarget((await cli("board", "--json")).json(), issue, "acme/api")!.base;

  expect(await base("acme/api#7")).toEqual({ branches: ["beta", "main"], selected: "main" });
  const posted = await web("/api/dispatch", { method: "POST", body: JSON.stringify({ args: ["acme/api#7", ...FLAGS, "--base", "beta"] }) });
  expect(posted.status).toBe(200);
  expect(world.calls).toContain("herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/beta --label api#7 --no-focus");

  expect(await base("acme/api#8")).toEqual({ branches: ["beta", "main"], selected: "beta" });
  expect((await cli("show", "acme/api#7", "--json")).json().base).toBe("origin/beta");
});

test("the Board shows the Base of every Ready, Stackable and In-flight issue", async () => {
  const { cli, world } = await stackable();
  world.addIssue("acme/api", { number: 8 });
  world.addIssue("acme/api", { number: 9 });
  await cli("dispatch", "acme/api#9", ...FLAGS, "--base", "beta");

  const board = (await cli("board", "--json")).json();
  expect(board.issues).toEqual([{ issue: "acme/api#8", title: "Issue 8", repo: "acme/api", url: "https://github.com/acme/api/issues/8", base: "beta" }]);
  expect(board.stackable[0].blockers).toEqual([{ issue: "acme/api#6", pr: "https://github.com/acme/api/pull/16", base: "agent/blocker-6" }]);
  expect(board.dispatches[0]).toMatchObject({ issue: "acme/api#9", base: "beta" });
});

test("a failed branch listing is reported per Repo and still shows its issues", async () => {
  const { cli, world } = await withRepo();
  world.addIssue("acme/api", { number: 8 });
  world.failCall("git -C /src/api ls-remote", "`git ls-remote` failed");

  const result = await cli("board", "--json");
  expect(result.exitCode).toBe(0);
  const board = result.json();
  expect(board.issues).toEqual([{ issue: "acme/api#8", title: "Issue 8", repo: "acme/api", url: "https://github.com/acme/api/issues/8" }]);
  expect(board.errors).toEqual([{ repo: "acme/api", source: "git", error: "`git ls-remote` failed" }]);
});
