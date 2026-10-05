import { describe, expect, test } from "bun:test";
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
    expect(world.calls).toEqual(["github linked prs acme/api#7"]);
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

describe("In flight on the web", () => {
  test("the section polls every 5s and the fragment refreshes it without a full page", async () => {
    const { web, world } = await dispatched();
    const { body } = await web("/");
    expect(body).toContain('<section class="in-flight" hx-get="/in-flight" hx-trigger="every 5s" hx-swap="outerHTML">');

    world.linkPr("acme/api", 7, { number: 9 });
    world.clock = new Date(world.clock.getTime() + 31_000);
    const fragment = await web("/in-flight");
    expect(fragment.status).toBe(200);
    expect(fragment.body).toStartWith('<section class="in-flight" hx-get="/in-flight"');
    expect(fragment.body).not.toContain("<html");
    expect(fragment.body).toContain(
      '<li class="flight">\n<div class="head"><input type="checkbox" class="pick" name="issue" value="acme/api#7" form="batch" autocomplete="off" id="pick-acme-api-7" hx-preserve="true" aria-label="Select acme/api#7"> <a class="title" href="https://github.com/acme/api/issues/7"><span class="num">api#7</span> Add retries</a><span class="stage pr-ready">PR ready</span><a class="pr" href="https://github.com/acme/api/pull/9">PR #9</a></div>\n<div class="meta"><span class="chip">claude · opus · high</span><span class="chip" title="Base"><svg class="icon" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="2.5" r="1.5"/><circle cx="3" cy="9.5" r="1.5"/><circle cx="9" cy="3.5" r="1.5"/><path d="M3 4v4M9 5c0 2.5-6 1.5-6 3"/></svg>main</span><span class="chip" title="herdr workspace">w1</span><span class="agent working"><i></i>implementer working</span></div>',
    );
  });

  test("GitHub results are cached for about 30s across polls", async () => {
    const { web, world } = await dispatched();
    await web("/in-flight");
    await web("/in-flight");
    world.clock = new Date(world.clock.getTime() + 29_000);
    await web("/in-flight");
    expect(world.calls.filter((c) => c.startsWith("github linked prs"))).toHaveLength(1);
    expect(world.calls.filter((c) => c === "herdr agent list")).toHaveLength(3);

    world.clock = new Date(world.clock.getTime() + 2_000);
    await web("/in-flight");
    expect(world.calls.filter((c) => c.startsWith("github linked prs"))).toHaveLength(2);
  });

  test("a failed GitHub lookup is cached too, so an outage isn't asked every poll", async () => {
    const { web, world } = await dispatched();
    world.failCall("github linked prs", "GitHub rate limit exceeded; try again later");
    expect((await web("/in-flight")).body).toContain("could not look up the PR: GitHub rate limit exceeded; try again later");
    world.clearFailures();
    expect((await web("/in-flight")).body).toContain("could not look up the PR");
    expect(world.calls.filter((c) => c.startsWith("github linked prs"))).toHaveLength(1);
  });

  test("a blocked agent is highlighted", async () => {
    const { web, world } = await dispatched();
    world.agentStates.set("impl-api-7", "blocked");
    expect((await web("/in-flight")).body).toContain('<span class="agent blocked"><i></i>implementer blocked</span>');
  });

  test("Launch review appears once a PR is linked, kept across polls, and launches the Reviewer", async () => {
    const { web, world, cli } = await dispatched();
    expect((await web("/in-flight")).body).not.toContain("Launch review");

    world.linkPr("acme/api", 7, { number: 9 });
    world.clock = new Date(world.clock.getTime() + 31_000);
    const { body } = await web("/in-flight");
    expect(body).toContain('<div id="review-acme-api-7" hx-preserve="true">\n<form method="post" action="/review" class="dispatch">');
    expect(body).toContain('hx-get="/review-form"');
    expect(body).toContain("<button>Launch review</button>");

    const rerendered = await web("/review-form?issue=acme%2Fapi%237&harness=claude&model=haiku&effort=low");
    expect(rerendered.body).toStartWith('<form method="post" action="/review" class="dispatch">');
    expect(rerendered.body).toContain("<option selected>haiku</option>");

    const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "sonnet", effort: "max" });
    const posted = await web("/review", { method: "POST", body: form });
    expect(posted.status).toBe(303);
    expect(world.calls).toContain(
      "herdr agent prompt rev-api-7 /code-review https://github.com/acme/api/pull/9 against main for the spec at https://github.com/acme/api/issues/7",
    );
    expect(await stage(cli)).toBe("Review launched");

    const after = (await web("/in-flight")).body;
    expect(after).not.toContain("Launch review");
    expect(after).toContain('<span class="stage review-launched">Review launched</span>');
    expect(after).toContain('<span class="agent working"><i></i>reviewer working</span>');
  });

  test("launching a review before a PR is linked is an error page with the CLI's help", async () => {
    const { web } = await dispatched();
    const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "sonnet", effort: "max" });
    const { status, body } = await web("/review", { method: "POST", body: form });
    expect(status).toBe(409);
    expect(body).toContain('<p class="error">no PR is linked to acme/api#7 yet</p>');
  });

  test("a failed review launch shows Retry, which posts the review again", async () => {
    const { web, world } = await dispatched();
    world.linkPr("acme/api", 7, { number: 9 });
    world.failHerdr("agent start rev-api-7", "agent_name_taken");
    const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "sonnet", effort: "max" });
    expect((await web("/review", { method: "POST", body: form })).status).toBe(502);

    const { body } = await web("/in-flight");
    expect(body).toContain('<span class="stage failed">Failed at review agent start</span>');
    expect(body).toContain('<div class="notes"><p class="error">agent_name_taken</p></div>');
    expect(body).toContain('<form method="post" action="/review" class="dispatch">\n<input type="hidden" name="issue" value="acme/api#7">');
    expect(body).toContain('<input type="hidden" name="model" value="sonnet">');
  });
});
