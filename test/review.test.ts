import { describe, expect, test } from "bun:test";
import { canReview } from "../src/app/actions";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const REVIEW_FLAGS = ["--harness", "claude", "--model", "sonnet", "--effort", "max"];

/** A Repo with issue 7 dispatched. */
async function dispatched() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7, title: "Add retries" });
  await ctx.cli("dispatch", "acme/api#7", ...FLAGS);
  ctx.world.calls.length = 0;
  return ctx;
}

const stage = async (cli: ReturnType<typeof setup>["cli"]) => (await cli("show", "acme/api#7", "--json")).json().stage;

describe("Stage", () => {
  test("follows PR linkage only: Implementing, then PR ready, then Review launched, whatever the Agent state", async () => {
    const { cli, world } = await dispatched();
    for (const state of ["idle", "done", "blocked"]) {
      world.agentStates.set("impl-api-7", state);
      expect(await stage(cli)).toBe("Implementing");
    }

    world.linkPr("acme/api", 7, { number: 9 });
    world.agentStates.set("impl-api-7", "working");
    expect(await stage(cli)).toBe("PR ready");

    await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    for (const state of ["working", "done"]) {
      world.agentStates.set("rev-api-7", state);
      expect(await stage(cli)).toBe("Review launched");
    }
  });

  test("a PR from the Dispatch's branch is its PR even when GitHub links it to no issue, as for a base other than the default branch", async () => {
    const { cli, world } = await dispatched();
    const pr = { repo: "acme/api", url: "https://github.com/acme/api/pull/9", baseBranch: "agent/api-5", headBranch: "agent/api-7" };
    world.branchPrs.set("acme/api:agent/api-7", [{ ...pr, number: 8, state: "closed" }]);
    expect(await stage(cli)).toBe("Implementing");

    world.branchPrs.set("acme/api:agent/api-7", [{ ...pr, number: 8, state: "closed" }, { ...pr, number: 9, state: "open" }]);
    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.stage).toBe("PR ready");
    expect((await cli("--json")).json().dispatches[0]).toMatchObject({ issue: "acme/api#7", stage: "PR ready", pr: "https://github.com/acme/api/pull/9" });
  });

  test("a closing PR in another repo is not the Dispatch's PR; an open one is preferred over a merged one", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 7, { repo: "acme/web", number: 3, url: "https://github.com/acme/web/pull/3" });
    expect(await stage(cli)).toBe("Implementing");

    world.linkPr("acme/api", 7, { number: 8, state: "merged" });
    world.linkPr("acme/api", 7, { number: 9 });
    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.stage).toBe("PR ready");
    expect(shown.pr).toBe("https://github.com/acme/api/pull/9");
  });
});

describe("review", () => {
  test("opens a reviewer tab in the Dispatch's workspace and prompts code-review of the PR against its base", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9, baseBranch: "trunk" });

    const { stdout, exitCode } = await cli("review", "https://github.com/acme/api/issues/7", ...REVIEW_FLAGS);
    expect(exitCode).toBe(0);
    expect(world.calls).toEqual([
      "github linked prs acme/api#7",
      "github branch prs acme/api:agent/api-7",
      "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
      "herdr agent start rev-api-7 --kind claude --pane w1:p3 -- --model sonnet --effort max",
      "herdr agent prompt rev-api-7 /code-review https://github.com/acme/api/pull/9 against trunk for the spec at https://github.com/acme/api/issues/7",
    ]);
    expect(stdout).toBe(
      [
        "reviewing: acme/api#7",
        "stage: Review launched",
        'pr: "https://github.com/acme/api/pull/9"',
        "workspace: w1",
        "agent: rev-api-7",
        "help[2]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run `nico-agent` to see the Board",
        "",
      ].join("\n"),
    );

    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.reviewer).toEqual({
      tab: "w1:t3",
      pane: "w1:p3",
      agent: "rev-api-7",
      harness: "claude",
      model: "sonnet",
      effort: "max",
      prUrl: "https://github.com/acme/api/pull/9",
      prBase: "trunk",
      completed: ["tab", "agent start", "agent ready", "prompt"],
    });
  });

  test("can't launch before a PR is linked", async () => {
    const { cli, world } = await dispatched();
    const { stdout, exitCode } = await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: no PR is linked to acme/api#7 yet",
        "help[2]:",
        "  Run the same `nico-agent review` again once the Implementer has opened a PR that closes the issue",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual(["github linked prs acme/api#7", "github branch prs acme/api:agent/api-7"]);
  });

  test("a Failed Dispatch can't be reviewed until it is resumed", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7 });
    world.stallPrompts(3);
    await cli("dispatch", "acme/api#7", ...FLAGS);
    world.linkPr("acme/api", 7, { number: 9 });
    world.calls.length = 0;

    const { stdout, exitCode } = await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    expect(exitCode).toBe(1);
    expect(stdout).toStartWith("error: acme/api#7 is Failed at prompt\nhelp[2]:\n  Run the same `nico-agent dispatch` again to resume it\n");
    expect(world.calls).toEqual([]);
  });

  test("an issue that is not In flight can't be reviewed", async () => {
    const { cli, world } = await dispatched();
    const { stdout, exitCode } = await cli("review", "acme/api#8", ...REVIEW_FLAGS);
    expect(exitCode).toBe(1);
    expect(stdout).toStartWith("error: acme/api#8 is not In flight\n");
    expect(world.calls).toEqual([]);
  });

  test("re-running returns the existing Reviewer; other parameters are refused", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9 });
    await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    world.calls.length = 0;

    const again = await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toStartWith("reviewing: acme/api#7 already launched (no-op)\nstage: Review launched\n");

    const dispatchAgain = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(dispatchAgain.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\nstage: Review launched\n");

    const other = await cli("review", "acme/api#7", ...FLAGS);
    expect(other.exitCode).toBe(1);
    expect(other.stdout).toBe(
      [
        "error: acme/api#7 already has a Reviewer with claude sonnet max",
        "help[1]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });

  test("a failed step is kept as the Stage and a re-run resumes from it", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9 });
    world.failHerdr("agent start rev-api-7", "agent_name_taken");

    const failed = await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toBe(
      [
        "error: agent_name_taken",
        "stage: Failed at review agent start",
        "help[2]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run the same `nico-agent review` again to resume from agent start",
        "",
      ].join("\n"),
    );
    expect(await stage(cli)).toBe("Failed at review agent start");

    world.clearFailures();
    world.calls.length = 0;
    const again = await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    expect(again.stdout).toStartWith("reviewing: acme/api#7 (resumed from agent start)\nstage: Review launched\n");
    expect(world.calls).toEqual([
      "herdr agent start rev-api-7 --kind claude --pane w1:p3 -- --model sonnet --effort max",
      "herdr agent prompt rev-api-7 /code-review https://github.com/acme/api/pull/9 against main for the spec at https://github.com/acme/api/issues/7",
    ]);
  });

  test("a dispatch re-run is still a no-op once a Reviewer is launched", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9 });
    await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    world.calls.length = 0;
    const again = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(again.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\n");
    expect(world.calls).toEqual([]);
  });
});

describe("In flight on the CLI Board", () => {
  test("rows show the Stage, the PR, and both agents' raw Agent state", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-7", "blocked");
    const before = await cli("--json");
    expect(before.json().dispatches).toEqual([
      {
        issue: "acme/api#7",
        title: "Add retries",
        repo: "acme/api",
        url: "https://github.com/acme/api/issues/7",
        stage: "Implementing",
        pr: "",
        implementer: "blocked",
        reviewer: "",
        harness: "claude",
        model: "opus",
        effort: "high",
        base: "main",
        workspace: "w1",
      },
    ]);

    world.linkPr("acme/api", 7, { number: 9 });
    expect((await cli()).stdout).toContain(
      "Run `nico-agent review <issue> --harness claude --model <model> --effort <effort>` to review an issue whose PR is ready",
    );
    await cli("review", "acme/api#7", ...REVIEW_FLAGS);
    world.agentStates.set("impl-api-7", "done");
    const { stdout } = await cli();
    expect(stdout).toContain(
      [
        "dispatches[1]{issue,title,stage,pr,implementer,reviewer,harness,model,effort,base,workspace}:",
        '  acme/api#7,Add retries,Review launched,"https://github.com/acme/api/pull/9",done,working,claude,opus,high,main,w1',
      ].join("\n"),
    );
    expect(stdout).not.toContain("to review an issue whose PR is ready");
  });

  test("a no-op dispatch re-run reports the Stage from the linked PR", async () => {
    const { cli, world } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9 });
    const again = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(again.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\nstage: PR ready\n");
  });

  test("a blocked agent gets a help line to see what it is waiting on", async () => {
    const { cli, world } = await dispatched();
    world.agentStates.set("impl-api-7", "blocked");
    const { json } = await cli("--json");
    expect(json().help[0]).toBe("Run `herdr agent read impl-api-7` to see what the blocked agent of acme/api#7 is waiting on");
  });

  test("a herdr failure leaves the Agent states unknown, and a GitHub failure is reported with the row", async () => {
    const { cli, world } = await dispatched();
    world.failHerdr("agent list", "herdr is not running");
    world.failCall("github linked prs", "GitHub rate limit exceeded; try again later");
    const { json, exitCode } = await cli("--json");
    expect(exitCode).toBe(0);
    const [row] = json().dispatches;
    expect(row.implementer).toBe("unknown");
    expect(row.stage).toBe("unknown");
    expect(row.prError).toBe("GitHub rate limit exceeded; try again later");
  });
});

describe("In flight in the app", () => {
  /** The app's Board, as `/api/board` answers each refetch. */
  const boardOf = async (web: Awaited<ReturnType<typeof dispatched>>["web"]) => JSON.parse((await web("/api/board")).body);
  const review = (web: Awaited<ReturnType<typeof dispatched>>["web"], ...args: string[]) =>
    web("/api/review", { method: "POST", body: JSON.stringify({ args: ["acme/api#7", ...args] }) });

  test("GitHub results are cached for about 30s across refetches", async () => {
    const { web, world } = await dispatched();
    await boardOf(web);
    await boardOf(web);
    world.clock = new Date(world.clock.getTime() + 29_000);
    await boardOf(web);
    expect(world.calls.filter((c) => c.startsWith("github linked prs"))).toHaveLength(1);
    expect(world.calls.filter((c) => c === "herdr agent list")).toHaveLength(3);

    world.clock = new Date(world.clock.getTime() + 2_000);
    await boardOf(web);
    expect(world.calls.filter((c) => c.startsWith("github linked prs"))).toHaveLength(2);
  });

  test("a failed GitHub lookup is cached too, so an outage isn't asked every refetch", async () => {
    const { web, world } = await dispatched();
    world.failCall("github linked prs", "GitHub rate limit exceeded; try again later");
    expect((await boardOf(web)).dispatches[0].prError).toBe("GitHub rate limit exceeded; try again later");
    world.clearFailures();
    expect((await boardOf(web)).dispatches[0].prError).toBe("GitHub rate limit exceeded; try again later");
    expect(world.calls.filter((c) => c.startsWith("github linked prs"))).toHaveLength(1);
  });

  test("Launch review is offered once a PR is linked, and launches the Reviewer", async () => {
    const { web, world, cli } = await dispatched();
    expect(canReview((await boardOf(web)).dispatches[0])).toBe(false);

    world.linkPr("acme/api", 7, { number: 9 });
    world.clock = new Date(world.clock.getTime() + 31_000);
    expect(canReview((await boardOf(web)).dispatches[0])).toBe(true);

    const posted = await review(web, "--harness", "claude", "--model", "sonnet", "--effort", "max");
    expect(posted.status).toBe(200);
    expect(world.calls).toContain(
      "herdr agent prompt rev-api-7 /code-review https://github.com/acme/api/pull/9 against main for the spec at https://github.com/acme/api/issues/7",
    );
    expect(await stage(cli)).toBe("Review launched");
    const [after] = (await boardOf(web)).dispatches;
    expect(canReview(after)).toBe(false);
    expect(after).toMatchObject({ stage: "Review launched", reviewer: "working" });
  });

  test("launching a review before a PR is linked shows the CLI's error", async () => {
    const { web } = await dispatched();
    const { status, body } = await review(web, "--harness", "claude", "--model", "sonnet", "--effort", "max");
    expect(status).toBe(422);
    expect(JSON.parse(body).error).toBe("no PR is linked to acme/api#7 yet");
  });

  test("a failed review launch offers Retry, which posts the review again", async () => {
    const { web, world, cli } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9 });
    world.failHerdr("agent start rev-api-7", "agent_name_taken");
    expect((await review(web, "--harness", "claude", "--model", "sonnet", "--effort", "max")).status).toBe(422);

    const [row] = (await boardOf(web)).dispatches;
    expect(row).toMatchObject({ stage: "Failed at review agent start", failure: "agent_name_taken" });
    expect(row.retry).toEqual(["review", "acme/api#7", "--harness", "claude", "--model", "sonnet", "--effort", "max"]);
    world.clearFailures();
    const [command, ...args] = row.retry;
    expect((await web(`/api/${command}`, { method: "POST", body: JSON.stringify({ args }) })).status).toBe(200);
    expect(await stage(cli)).toBe("Review launched");
  });
});
