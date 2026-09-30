import { describe, expect, test } from "bun:test";
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
      "git -C /src/api fetch origin",
      "git -C /src/api default-branch",
      "herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/main --label api#7 --no-focus",
      "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
      "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
      "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR",
    ]);
    expect(stdout).toBe(
      [
        "dispatched: acme/api#7",
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
      "herdr agent prompt impl-web-app-12 /implement https://github.com/acme/Web-App/issues/12 as draft PR",
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
      repo: "acme/api",
      branch: "agent/api-7",
      base: "origin/main",
      worktree: "/worktrees/api-7",
      workspace: "w1",
      implementer: { tab: "w1:t2", pane: "w1:p2", agent: "impl-api-7", harness: "claude", model: "opus", effort: "high" },
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
    expect(again.stdout).toStartWith("dispatched: acme/api#7 already In flight (no-op)\nworkspace: w1\nagent: impl-api-7\n");

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
    expect(world.calls).toEqual([]);
  });

  test("rejects an unknown Harness, model or Effort before any outside-world call", async () => {
    const { cli, world } = await withRepo();
    const cases: [string[], string, string][] = [
      [["--harness", "pi", "--model", "opus", "--effort", "high"], "unknown Harness `pi`", "Valid Harnesses: claude"],
      [["--harness", "claude", "--model", "gpt", "--effort", "high"], "unknown model `gpt` for claude", "Valid models for claude: fable, opus, sonnet, haiku"],
      [["--harness", "claude", "--model", "opus", "--effort", "ultra"], "unknown Effort `ultra` for claude", "Valid Efforts for claude: low, medium, high, xhigh, max"],
    ];
    for (const [flags, error, help] of cases) {
      const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...flags);
      expect(exitCode).toBe(2);
      expect(stdout).toBe(`error: ${error}\nhelp[1]:\n  ${help}\n`);
    }
    expect(world.calls).toEqual([]);
  });

  test("rejects a malformed issue reference and an issue of an unconfigured Repo", async () => {
    const { cli, world } = await withRepo();
    const bad = await cli("dispatch", "api-7", ...FLAGS);
    expect(bad.exitCode).toBe(2);
    expect(bad.stdout).toStartWith("error: `api-7` is not an issue reference\nhelp[1]:\n  Pass `owner/repo#N` or a GitHub issue URL\n");

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
    expect(stdout).toBe("error: the agent in w1 is not ready\n");
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
    expect(world.calls.slice(-5)).toEqual([
      "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
      "herdr agent read impl-api-7 --source visible",
      "herdr agent send-keys impl-api-7 down enter",
      "herdr agent wait impl-api-7 --until idle --until done --timeout 30000",
      "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR",
    ]);
  });

  test("a prompt the agent swallows without starting work is sent again, up to 3 times", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.stallPrompts(2);

    const { exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    const prompts = world.calls.filter((c) => c.startsWith("herdr agent prompt "));
    expect(prompts).toEqual(Array(3).fill("herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR"));

    const { cli: cli2, world: world2 } = await withRepo();
    world2.addIssue("acme/api", { number: 7 });
    world2.stallPrompts(3);
    const failed = await cli2("dispatch", "acme/api#7", ...FLAGS);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toBe(
      [
        "error: impl-api-7 did not start working on its prompt",
        "help[1]:",
        "  Run `herdr agent read impl-api-7` to see its screen, and send the prompt by hand",
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
        "help[1]:",
        "  Run `herdr agent read impl-api-7` to see what it is asking, and answer it in herdr",
        "",
      ].join("\n"),
    );
    expect(world.calls.at(-1)).toBe("herdr agent read impl-api-7 --source visible");
  });

  test("dispatch --help documents the flags", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("dispatch", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith(
      "usage: nico-agent dispatch <issue> --harness <harness> --model <model> --effort <effort>\n",
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
        "issues[1]{issue,title}:",
        "  acme/api#8,Fix login",
        "inFlight: 1 Dispatch",
        "dispatches[1]{issue,title,harness,model,effort,workspace}:",
        "  acme/api#7,Add retries,claude,opus,high,w1",
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
        '<section class="in-flight">',
        "<h2>In flight</h2>",
        "<ul>",
        '<li><a href="https://github.com/acme/api/issues/7">acme/api#7 Add retries</a> · claude opus high · workspace w1</li>',
        "</ul>",
        "</section>",
      ].join("\n"),
    );
  });
});

describe("web dispatch", () => {
  test("each Ready issue has a dispatch form offering claude's models and Efforts", async () => {
    const { web, world } = await withRepo();
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const { body } = await web("/");
    expect(body).toContain('<form method="post" action="/dispatch" class="dispatch">');
    expect(body).toContain('<input type="hidden" name="issue" value="acme/api#7">');
    expect(body).toContain('<select name="harness"><option>claude</option></select>');
    expect(body).toContain(
      '<select name="model"><option>fable</option><option>opus</option><option>sonnet</option><option>haiku</option></select>',
    );
    expect(body).toContain(
      '<select name="effort"><option>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select>',
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
