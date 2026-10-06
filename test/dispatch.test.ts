import { describe, expect, test } from "bun:test";
import type { FakeWorld } from "./fake-world";
import { setup } from "./harness";

async function withRepo(slug = "acme/api", path = "/src/api") {
  const ctx = setup();
  ctx.world.addClone(path, `git@github.com:${slug}.git`);
  await ctx.cli("repo", "add", slug, "--path", path);
  ctx.world.calls.length = 0;
  return ctx;
}

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

describe("dispatch", () => {
  test("sends exactly the expected git and herdr commands, in order", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(world.calls).toEqual([
      "github issue acme/api#7",
      "git -C /src/api ls-remote --heads origin",
      "git -C /src/api default-branch",
      "git -C /src/api fetch origin",
      "herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/main --label api#7 --no-focus",
      "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
      "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
      "github app repos",
      "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main",
      "github assign acme/api#7 @me",
    ]);
    expect(stdout).toBe(
      [
        "dispatched: acme/api#7",
        "stage: Implementing",
        "workspace: w1",
        "agent: impl-api-7",
        "help[2]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run `nico-agent` to see the Board",
        "",
      ].join("\n"),
    );
  });

  test("accepts a GitHub issue URL and bases the worktree on the Repo's default branch", async () => {
    const { cli, world } = await withRepo("acme/Web-App", "/src/web");
    world.defaultBranches.set("/src/web", "trunk");
    world.addIssue("acme/Web-App", { number: 12 });

    const { exitCode } = await cli("dispatch", "https://github.com/acme/web-app/issues/12", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(world.calls).toContain(
      "herdr worktree create --cwd /src/web --branch agent/Web-App-12 --base origin/trunk --label Web-App#12 --no-focus",
    );
    expect(world.calls).toContain(
      "herdr agent prompt impl-web-app-12 /implement https://github.com/acme/Web-App/issues/12 as draft PR against trunk",
    );
  });

  test("agent names fit herdr's [a-z][a-z0-9_-]{0,31}, truncated but keeping the issue number", async () => {
    const { cli, world } = await withRepo("acme/Very.Long_Repository-Name-For-Testing", "/src/long");
    world.addIssue("acme/Very.Long_Repository-Name-For-Testing", { number: 1234 });

    await cli("dispatch", "acme/Very.Long_Repository-Name-For-Testing#1234", ...FLAGS);
    const start = world.calls.find((c) => c.startsWith("herdr agent start "))!;
    const name = start.split(" ")[3]!;
    expect(name).toBe("impl-very-long_repository-n-1234");
    expect(name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });

  test("the Dispatch record holds ids, agent, Harness/model/Effort and timestamps; show prints it", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    await cli("dispatch", "acme/api#7", ...FLAGS);

    const shown = await cli("show", "https://github.com/acme/api/issues/7", "--json");
    expect(shown.exitCode).toBe(0);
    expect(shown.json()).toEqual({
      issue: "acme/api#7",
      title: "Add retries",
      url: "https://github.com/acme/api/issues/7",
      stage: "Implementing",
      repo: "acme/api",
      branch: "agent/api-7",
      base: "origin/main",
      worktree: "/worktrees/api-7",
      workspace: "w1",
      implementer: { tab: "w1:t2", pane: "w1:p2", agent: "impl-api-7", harness: "claude", model: "opus", effort: "high" },
      completed: ["fetch", "worktree", "tab", "agent start", "agent ready", "prompt"],
      botSuffix: false,
      claimed: true,
      createdAt: "2026-09-30T12:00:00.000Z",
      updatedAt: "2026-09-30T12:00:00.000Z",
      help: ["Run `nico-agent` to see the Board"],
    });

    const toon = await cli("show", "acme/api#7");
    expect(toon.stdout).toBe(
      [
        "issue: acme/api#7",
        "title: Add retries",
        'url: "https://github.com/acme/api/issues/7"',
        "stage: Implementing",
        "repo: acme/api",
        "branch: agent/api-7",
        "base: origin/main",
        "worktree: /worktrees/api-7",
        "workspace: w1",
        "implementer:",
        '  tab: "w1:t2"',
        '  pane: "w1:p2"',
        "  agent: impl-api-7",
        "  harness: claude",
        "  model: opus",
        "  effort: high",
        "completed[6]: fetch,worktree,tab,agent start,agent ready,prompt",
        "botSuffix: false",
        "claimed: true",
        'createdAt: "2026-09-30T12:00:00.000Z"',
        'updatedAt: "2026-09-30T12:00:00.000Z"',
        "help[1]:",
        "  Run `nico-agent` to see the Board",
        "",
      ].join("\n"),
    );
  });

  test("show of an issue that is not In flight is an error", async () => {
    const { cli } = await withRepo();
    const { stdout, exitCode } = await cli("show", "acme/api#7");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      ["error: acme/api#7 is not In flight", "help[1]:", "  Run `nico-agent` to see the Board and what is In flight", ""].join("\n"),
    );
  });

  test("re-running the same dispatch returns the existing one; other parameters are refused", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    await cli("dispatch", "acme/api#7", ...FLAGS);
    world.calls.length = 0;

    const again = await cli("dispatch", "https://github.com/acme/api/issues/7", ...FLAGS);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\nstage: Implementing\nworkspace: w1\nagent: impl-api-7\n");

    const other = await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "sonnet", "--effort", "high");
    expect(other.exitCode).toBe(1);
    expect(other.stdout).toBe(
      [
        "error: acme/api#7 is already In flight with claude opus high",
        "help[1]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "",
      ].join("\n"),
    );
    // A no-op only reads the Stage.
    expect(world.calls).toEqual(["github linked prs acme/api#7", "github branch prs acme/api:agent/api-7"]);
  });

  test("rejects an unknown Harness or model before any outside-world call", async () => {
    const { cli, world } = await withRepo();
    const cases: [string[], string, string][] = [
      [["--harness", "pi", "--model", "opus", "--effort", "high"], "unknown Harness `pi`", "Valid Harnesses: claude, codex, opencode2"],
      [["--harness", "claude", "--model", "gpt", "--effort", "high"], "unknown model `gpt` for claude", "Valid models for claude: fable, opus, sonnet, haiku"],
    ];
    for (const [flags, error, help] of cases) {
      const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...flags);
      expect(exitCode).toBe(2);
      expect(stdout).toBe(`error: ${error}\nhelp[1]:\n  ${help}\n`);
    }
    expect(world.calls).toEqual([]);
  });

  test("rejects an Effort the model does not support, like other choices that come from config (exit 1)", async () => {
    const { cli, world } = await withRepo();
    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "ultra");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      "error: Effort `ultra` is not valid for claude opus\nhelp[1]:\n  Valid Efforts for claude opus: low, medium, high, xhigh, max\n",
    );
    expect(world.calls).toEqual([]);
  });

  test("rejects a malformed issue reference and an issue of an unconfigured Repo", async () => {
    const { cli, world } = await withRepo();
    const bad = await cli("dispatch", "api#7", ...FLAGS);
    expect(bad.exitCode).toBe(2);
    expect(bad.stdout).toStartWith("error: `api#7` is not an issue reference\nhelp[1]:\n  Pass `owner/repo#N` or a GitHub issue URL\n");

    const unknown = await cli("dispatch", "acme/web#3", ...FLAGS);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stdout).toStartWith(
      "error: acme/web is not a configured Repo\nhelp[1]:\n  Run `nico-agent repo add acme/web --path <clone>` first\n",
    );
    expect(world.calls).toEqual([]);
  });

  test("an issue that doesn't exist or is closed is not dispatched", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 8, state: "closed" });
    expect((await cli("dispatch", "acme/api#7", ...FLAGS)).stdout).toStartWith("error: acme/api#7 was not found on GitHub\n");
    expect((await cli("dispatch", "acme/api#8", ...FLAGS)).stdout).toStartWith("error: acme/api#8 is closed\n");
    expect(world.calls).toEqual(["github issue acme/api#7", "github issue acme/api#8"]);
  });

  test("a herdr failure is a structured error", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.failHerdr("agent start", "the agent in w1 is not ready");

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: the agent in w1 is not ready",
        "stage: Failed at agent start",
        "help[2]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run the same `nico-agent dispatch` again to resume from agent start",
        "",
      ].join("\n"),
    );
  });

  test("claude's trust question for the new worktree is answered before prompting", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.blockAgentStart(
      [
        " Accessing workspace:",
        "",
        " /worktrees/",
        "api-7",
        "",
        " Quick safety check: Is this a project you created or one you trust?",
        " ❯ No, exit",
        "   Yes, I trust this folder",
      ].join("\n"),
    );

    const { exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(world.calls.slice(-7, -1)).toEqual([
      "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
      "herdr agent read impl-api-7 --source visible",
      "herdr agent send-keys impl-api-7 down enter",
      "herdr agent wait impl-api-7 --until idle --until done --timeout 30000",
      "github app repos",
      "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main",
    ]);
  });

  test("a prompt the agent swallows without starting work is sent again, up to 3 times", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.stallPrompts(2);

    const { exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    const prompts = world.calls.filter((c) => c.startsWith("herdr agent prompt "));
    expect(prompts).toEqual(Array(3).fill("herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main"));

    const { cli: cli2, world: world2 } = await withRepo();
    world2.addIssue("acme/api", { number: 7 });
    world2.stallPrompts(3);
    const failed = await cli2("dispatch", "acme/api#7", ...FLAGS);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toBe(
      [
        "error: impl-api-7 did not start working on its prompt",
        "stage: Failed at prompt",
        "help[3]:",
        "  Run `herdr agent read impl-api-7` to see its screen, and send the prompt by hand",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run the same `nico-agent dispatch` again to resume from prompt",
        "",
      ].join("\n"),
    );
  });

  test("any other startup block fails the dispatch without answering it", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.blockAgentStart("Accessing workspace:\n /somewhere/else\n Yes, I trust this folder");

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: impl-api-7 is blocked during startup",
        "stage: Failed at agent ready",
        "help[3]:",
        "  Run `herdr agent read impl-api-7` to see what it is asking, and answer it in herdr",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run the same `nico-agent dispatch` again to resume from agent ready",
        "",
      ].join("\n"),
    );
    expect(world.calls.slice(-2)).toEqual([
      "herdr agent read impl-api-7 --source visible",
      "herdr agent wait impl-api-7 --until idle --until done --timeout 5000",
    ]);
  });

  test("dispatch --help documents the flags", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("dispatch", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith(
      "usage: nico-agent dispatch <issue>... --harness <harness> --model <model> --effort <effort>\n",
    );
    expect(world.calls).toEqual([]);
  });
});

describe("In flight on the Board", () => {
  test("a dispatched issue leaves Ready and is listed In flight", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    world.addIssue("acme/api", { number: 8, title: "Fix login" });
    await cli("dispatch", "acme/api#7", ...FLAGS);

    const { stdout, exitCode } = await cli();
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "bin: ~/.local/bin/nico-agent",
        "description: Dispatch coding agents onto ready-for-agent issues",
        "repos: 1 configured",
        "ready: 1 issue",
        "issues[1]{issue,title,base}:",
        "  acme/api#8,Fix login,main",
        "rooms[1]:",
        "  - repo: acme/api",
        "    running[1]: acme/api#7",
        "    room: 1",
        "    candidates[1]{spec,title,url,issue,body}:",
        '      acme/api#8,Fix login,"https://github.com/acme/api/issues/8",acme/api#8,""',
        "inFlight: 1 Dispatch",
        "dispatches[1]{issue,title,stage,pr,implementer,reviewer,harness,model,effort,base,workspace}:",
        '  acme/api#7,Add retries,Implementing,"",working,"",claude,opus,high,main,w1',
        "help[4]:",
        "  Run `nico-agent dispatch <issue> --harness claude --model <model> --effort <effort>` to dispatch a Ready issue",
        "  Run `nico-agent show <issue>` to see a Dispatch",
        "  Run `nico-agent repo list` to see the Repos",
        "  Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo",
        "",
      ].join("\n"),
    );
  });

  test("the web Board lists In-flight issues and not under Ready", async () => {
    const { cli, web, world } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    await cli("dispatch", "acme/api#7", ...FLAGS);

    const { body } = await web("/");
    expect(body).toContain('<p class="empty">No Ready issues.</p>');
    expect(body).toContain(
      [
        '<section class="in-flight" hx-get="/in-flight" hx-trigger="every 5s" hx-swap="outerHTML">',
        '<header><h2>In flight</h2><span class="count">1</span></header>',
        '<ul class="flights">',
        '<li class="flight">\n<div class="head"><input type="checkbox" class="pick" name="issue" value="acme/api#7" form="batch" autocomplete="off" id="pick-acme-api-7" hx-preserve="true" aria-label="Select acme/api#7"> <a class="title" href="https://github.com/acme/api/issues/7"><span class="num">api#7</span> Add retries</a><span class="stage implementing">Implementing</span></div>',
        '<div class="meta"><span class="chip">claude · opus · high</span><span class="chip" title="Base"><svg class="icon" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="2.5" r="1.5"/><circle cx="3" cy="9.5" r="1.5"/><circle cx="9" cy="3.5" r="1.5"/><path d="M3 4v4M9 5c0 2.5-6 1.5-6 3"/></svg>main</span><span class="chip" title="herdr workspace">w1</span><span class="agent working"><i></i>implementer working</span></div>',
        '<div class="row-actions">',
        '<form method="post" action="/close">',
        '<input type="hidden" name="issue" value="acme/api#7">',
        '<button>Close</button>',
        '</form>',
        "</div>",
        "</li>",
        "</ul>",
        "</section>",
      ].join("\n"),
    );
  });
});

describe("web dispatch", () => {
  test("each Ready issue has a dispatch form offering the Harnesses, claude's models and their Efforts", async () => {
    const { web, world } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const { body } = await web("/");
    expect(body).toContain('<form method="post" action="/dispatch" class="dispatch">');
    expect(body).toContain('<input type="hidden" name="issue" value="acme/api#7">');
    expect(body).toContain('<option selected>claude</option><option>codex</option><option>opencode2</option></select>');
    expect(body).toContain(
      '<option selected>fable</option><option>opus</option><option>sonnet</option><option>haiku</option></select>',
    );
    expect(body).toContain(
      '<select name="effort"><option selected>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select>',
    );
  });

  test("posting the form dispatches the issue and redirects to the Board", async () => {
    const { cli, web, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });

    const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "sonnet", effort: "max" });
    const response = await web("/dispatch", { method: "POST", body: form });
    expect(response.status).toBe(303);
    expect(world.calls).toContain("herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model sonnet --effort max");
    expect((await cli("show", "acme/api#7", "--json")).json().implementer.model).toBe("sonnet");
  });

  test("a failed dispatch from the web is an error page with the same help as the CLI", async () => {
    const { web, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "gpt", effort: "max" });
    const { status, body } = await web("/dispatch", { method: "POST", body: form });
    expect(status).toBe(400);
    expect(body).toContain('<p class="error">unknown model `gpt` for claude</p>\n<p>Valid models for claude: fable, opus, sonnet, haiku</p>');
    expect(world.calls).toEqual([]);
  });
});

describe("resuming a failed Dispatch", () => {
  const ALL = [
    "github issue acme/api#7",
    "git -C /src/api ls-remote --heads origin",
    "git -C /src/api default-branch",
    "git -C /src/api fetch origin",
    "herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/main --label api#7 --no-focus",
    "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
    "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
    "github app repos",
    "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main",
    "github assign acme/api#7 @me",
  ];
  const cases: { step: string; inject(world: FakeWorld): void; heal(world: FakeWorld): void; resumed: string[] }[] = [
    { step: "fetch", inject: (w) => w.failCall("git -C /src/api fetch", "`git fetch origin` failed"), heal: (w) => w.clearFailures(), resumed: ALL.slice(3) },
    { step: "worktree", inject: (w) => w.failHerdr("worktree create", "worktree_exists"), heal: (w) => w.clearFailures(), resumed: ALL.slice(4) },
    { step: "tab", inject: (w) => w.failHerdr("tab create", "workspace_not_found"), heal: (w) => w.clearFailures(), resumed: ALL.slice(5) },
    { step: "agent start", inject: (w) => w.failHerdr("agent start", "agent_blocked"), heal: (w) => w.clearFailures(), resumed: ALL.slice(6) },
    {
      step: "agent ready",
      inject: (w) => w.blockAgentStart("Do you want to enable telemetry?"),
      heal: (w) => w.unblockAgent(),
      resumed: [
        "herdr agent read impl-api-7 --source visible",
        "herdr agent wait impl-api-7 --until idle --until done --timeout 5000",
        ...ALL.slice(7),
      ],
    },
    { step: "prompt", inject: (w) => w.stallPrompts(3), heal: () => {}, resumed: ALL.slice(7) },
  ];

  for (const { step, inject, heal, resumed } of cases) {
    test(`a failure at ${step} is kept, and a re-run resumes from ${step} without repeating earlier side effects`, async () => {
      const { cli, world } = await withRepo();
      world.addIssue("acme/api", { number: 7 });
      inject(world);

      const failed = await cli("dispatch", "acme/api#7", ...FLAGS, "--json");
      expect(failed.exitCode).toBe(1);
      expect(failed.json().stage).toBe(`Failed at ${step}`);
      expect(failed.json().help.slice(-2)).toEqual([
        "Run `nico-agent show acme/api#7` to see the Dispatch",
        `Run the same \`nico-agent dispatch\` again to resume from ${step}`,
      ]);
      const shown = (await cli("show", "acme/api#7", "--json")).json();
      expect(shown.stage).toBe(`Failed at ${step}`);
      expect(shown.failure.step).toBe(step);
      expect(shown.failure.error).toBe(failed.json().error);
      expect(world.claimed).toEqual([]);

      heal(world);
      world.calls.length = 0;
      const again = await cli("dispatch", "acme/api#7", ...FLAGS);
      expect(again.exitCode).toBe(0);
      expect(again.stdout).toStartWith(`dispatched: acme/api#7 (resumed from ${step})\n`);
      expect(world.calls).toEqual(resumed);
      const healthy = (await cli("show", "acme/api#7", "--json")).json();
      expect(healthy.stage).toBe("Implementing");
      expect(healthy.failure).toBeUndefined();
      expect(healthy.workspace).toBe("w1");
    });
  }

  test("a failed Dispatch is In flight: other parameters are refused rather than resumed", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.failHerdr("tab create", "workspace_not_found");
    await cli("dispatch", "acme/api#7", ...FLAGS);
    world.clearFailures();
    world.calls.length = 0;

    const other = await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "haiku", "--effort", "high");
    expect(other.exitCode).toBe(1);
    expect(other.stdout).toBe(
      [
        "error: acme/api#7 is already In flight with claude opus high",
        "help[1]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });
});

describe("web Retry", () => {
  test("a failed Dispatch shows its Stage and error on the web Board, and Retry resumes it", async () => {
    const { web, world, cli } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    world.failHerdr("tab create", "workspace_not_found: no workspace w1");

    const form = new URLSearchParams({ issue: "acme/api#7", harness: "claude", model: "opus", effort: "high" });
    const failed = await web("/dispatch", { method: "POST", body: form });
    expect(failed.status).toBe(502);
    expect(failed.body).toContain('<p class="error">workspace_not_found: no workspace w1</p>');
    expect(failed.body).toContain("<p>Run `nico-agent show acme/api#7` to see the Dispatch</p>");

    const { body } = await web("/");
    expect(body).toContain(
      [
        '<li class="flight">\n<div class="head"><input type="checkbox" class="pick" name="issue" value="acme/api#7" form="batch" autocomplete="off" id="pick-acme-api-7" hx-preserve="true" aria-label="Select acme/api#7"> <a class="title" href="https://github.com/acme/api/issues/7"><span class="num">api#7</span> Add retries</a><span class="stage failed">Failed at tab</span></div>',
        '<div class="meta"><span class="chip">claude · opus · high</span><span class="chip" title="Base"><svg class="icon" viewBox="0 0 12 12" aria-hidden="true"><circle cx="3" cy="2.5" r="1.5"/><circle cx="3" cy="9.5" r="1.5"/><circle cx="9" cy="3.5" r="1.5"/><path d="M3 4v4M9 5c0 2.5-6 1.5-6 3"/></svg>main</span><span class="chip" title="herdr workspace">w1</span><span class="agent unknown"><i></i>implementer unknown</span></div>',
        '<div class="notes"><p class="error">workspace_not_found: no workspace w1</p></div>',
        '<div class="row-actions">',
        '<form method="post" action="/close">',
        '<input type="hidden" name="issue" value="acme/api#7">',
        '<button>Close</button>',
        '</form>',
        '<form method="post" action="/dispatch" class="dispatch">',
        '<input type="hidden" name="issue" value="acme/api#7">',
        '<input type="hidden" name="harness" value="claude">',
        '<input type="hidden" name="model" value="opus">',
        '<input type="hidden" name="effort" value="high">',
        "<button>Retry</button>",
        "</form>",
        "</div>",
        "</li>",
      ].join("\n"),
    );

    world.clearFailures();
    world.calls.length = 0;
    const retried = await web("/dispatch", { method: "POST", body: form });
    expect(retried.status).toBe(303);
    expect(world.calls[0]).toStartWith("herdr tab create --workspace w1 ");
    expect((await cli("show", "acme/api#7", "--json")).json().stage).toBe("Implementing");
    expect((await web("/")).body).toContain('<span class="stage implementing">Implementing</span>');
  });
});

describe("Claim", () => {
  test("after prompting, the issue is assigned to the user, and nothing else on it changes", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });

    await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(world.claimed).toEqual(["acme/api#7"]);
    expect(world.calls.filter((c) => c.startsWith("github "))).toEqual(["github issue acme/api#7", "github app repos", "github assign acme/api#7 @me"]);
    expect(world.calls.at(-1)).toBe("github assign acme/api#7 @me");
  });

  test("a failed Claim is a warning on a healthy Dispatch, not retried by a re-run", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.failCall("github assign", "GitHub request failed; check your network and `gh auth status`");

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "dispatched: acme/api#7",
        "stage: Implementing",
        "workspace: w1",
        "agent: impl-api-7",
        'warnings[1]: "could not Claim acme/api#7: GitHub request failed; check your network and `gh auth status`"',
        "help[3]:",
        "  Assign https://github.com/acme/api/issues/7 to yourself on GitHub to Claim it by hand",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run `nico-agent` to see the Board",
        "",
      ].join("\n"),
    );
    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.stage).toBe("Implementing");
    expect(shown.claimed).toBe(false);

    world.clearFailures();
    world.calls.length = 0;
    const again = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\n");
    // A no-op only reads the Stage.
    expect(world.calls).toEqual(["github linked prs acme/api#7", "github branch prs acme/api:agent/api-7"]);
  });
});

describe("interrupted Dispatch", () => {
  test("a step that crashes is recorded as its failure and resumed by a re-run", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.crashes.add("herdr tab create");
    await expect(cli("dispatch", "acme/api#7", ...FLAGS)).rejects.toThrow("crashed during herdr tab create");
    world.crashes.clear();
    expect((await cli("show", "acme/api#7", "--json")).json().stage).toBe("Failed at tab");

    world.calls.length = 0;
    const again = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(again.stdout).toStartWith("dispatched: acme/api#7 (resumed from tab)\n");
    expect(world.calls[0]).toStartWith("herdr tab create --workspace w1 ");
  });

  test("while a process runs the steps a re-run is a no-op; once that process is gone, it resumes", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.hangs.add("herdr tab create");
    void cli("dispatch", "acme/api#7", ...FLAGS);
    await Bun.sleep(20);
    world.hangs.clear();

    world.calls.length = 0;
    const during = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(during.exitCode).toBe(0);
    expect(during.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\n");
    // A no-op only reads the Stage.
    expect(world.calls).toEqual(["github linked prs acme/api#7", "github branch prs acme/api:agent/api-7"]);

    // The first process was killed mid-step; a later one takes over.
    world.deadPids.add(world.pid);
    world.pid = 5000;
    world.calls.length = 0;
    const after = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(after.stdout).toStartWith("dispatched: acme/api#7 (resumed from tab)\n");
    expect(world.calls[0]).toStartWith("herdr tab create --workspace w1 ");
    expect((await cli("show", "acme/api#7", "--json")).json().stage).toBe("Implementing");
  });
});
