import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("board", () => {
  test("with no Repos it says so and suggests adding one", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli();
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "bin: ~/.local/bin/nico-agent",
        "description: Dispatch coding agents onto ready-for-agent issues",
        "repos: 0 configured",
        "ready: 0 issues (no Repos configured)",
        "help[1]:",
        "  Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo",
        "",
      ].join("\n"),
    );
  });

  test("shows only Ready issues: open, labelled, unassigned or mine, with every Blocker closed", async () => {
    const { cli, world } = setup();
    world.viewer = "nico";
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 1, title: "Unassigned" });
    world.addIssue("acme/api", { number: 2, title: "Assigned to me", assignees: ["nico"] });
    world.addIssue("acme/api", { number: 3, title: "Assigned to someone else", assignees: ["alice"] });
    world.addIssue("acme/api", { number: 4, title: "Shared with someone else", assignees: ["nico", "alice"] });
    world.addIssue("acme/api", { number: 5, title: "Not labelled", labels: ["bug"] });
    world.addIssue("acme/api", { number: 6, title: "Closed", state: "closed" });
    world.addIssue("acme/api", {
      number: 7,
      title: "Blocker closed",
      blockers: [{ slug: "acme/api", number: 6, state: "closed" }],
    });
    world.addIssue("acme/api", {
      number: 8,
      title: "One Blocker still open",
      blockers: [
        { slug: "acme/api", number: 6, state: "closed" },
        { slug: "acme/web", number: 9, state: "open" },
      ],
    });

    const { stdout, exitCode } = await cli("board");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "bin: ~/.local/bin/nico-agent",
        "description: Dispatch coding agents onto ready-for-agent issues",
        "repos: 1 configured",
        "ready: 3 issues",
        "issues[3]{issue,title,base}:",
        "  acme/api#1,Unassigned,main",
        "  acme/api#2,Assigned to me,main",
        "  acme/api#7,Blocker closed,main",
        "specs[4]:",
        "  - spec: acme/api#1",
        "    title: Unassigned",
        "    repo: acme/api",
        "    issues[1]: acme/api#1",
        "    running: false",
        "  - spec: acme/api#2",
        "    title: Assigned to me",
        "    repo: acme/api",
        "    issues[1]: acme/api#2",
        "    running: false",
        "  - spec: acme/api#7",
        "    title: Blocker closed",
        "    repo: acme/api",
        "    issues[1]: acme/api#7",
        "    running: false",
        "  - spec: acme/api#8",
        "    title: One Blocker still open",
        "    repo: acme/api",
        "    issues[1]: acme/api#8",
        "    running: false",
        "rooms[1]:",
        "  - repo: acme/api",
        "    running: []",
        "    room: 2",
        "    candidates[3]{spec,title,url,issue,body}:",
        '      acme/api#1,Unassigned,"https://github.com/acme/api/issues/1",acme/api#1,""',
        '      acme/api#2,Assigned to me,"https://github.com/acme/api/issues/2",acme/api#2,""',
        '      acme/api#7,Blocker closed,"https://github.com/acme/api/issues/7",acme/api#7,""',
        "inFlight: 0 Dispatches",
        "help[3]:",
        "  Run `nico-agent dispatch <issue> --harness claude --model <model> --effort <effort>` to dispatch a Ready issue",
        "  Run `nico-agent repo list` to see the Repos",
        "  Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo",
        "",
      ].join("\n"),
    );
  });

  test("says explicitly when no configured Repo has a Ready issue", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 1, labels: [] });

    const { stdout, exitCode } = await cli();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("\nready: 0 issues across 1 Repo\ninFlight: 0 Dispatches\nhelp[2]:\n");
    expect(stdout).not.toContain("issues[");
  });

  test("a Repo that fails to load is reported while the others still render", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addIssue("acme/web", { number: 4, title: "Fix header" });
    world.failGitHub("acme/api", "GitHub is not reachable");

    const { stdout, exitCode } = await cli("--json");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      bin: "~/.local/bin/nico-agent",
      description: "Dispatch coding agents onto ready-for-agent issues",
      repos: "2 configured",
      ready: "1 issue",
      issues: [{ issue: "acme/web#4", title: "Fix header", base: "main" }],
      specs: [{ spec: "acme/web#4", title: "Fix header", repo: "acme/web", issues: ["acme/web#4"], running: false }],
      rooms: [{ repo: "acme/web", running: [], room: 2,
        candidates: [{ spec: "acme/web#4", title: "Fix header", url: "https://github.com/acme/web/issues/4", issue: "acme/web#4", body: "" }] }],
      inFlight: "0 Dispatches",
      errors: [{ repo: "acme/api", error: "GitHub is not reachable" }],
      help: [
        "Run `nico-agent dispatch <issue> --harness claude --model <model> --effort <effort>` to dispatch a Ready issue","Run `nico-agent repo list` to see the Repos", "Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo"],
    });
  });

  test("exits 1 when no Repo could be loaded at all", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.failGitHub("acme/api", "not authenticated with GitHub");

    const { stdout, exitCode } = await cli();
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      "\nready: 0 issues (no Repo could be loaded)\ninFlight: 0 Dispatches\nerrors[1]{repo,error}:\n  acme/api,not authenticated with GitHub\n",
    );
  });
});
