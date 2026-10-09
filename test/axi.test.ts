import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { WorldError } from "../src/world";
import { setup } from "./harness";

describe("AXI conventions", () => {
  test("an unknown flag is a usage error naming the command's valid flags", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("repo", "list", "--stat");
    expect(exitCode).toBe(2);
    expect(stdout).toBe(
      ["error: unknown flag --stat for `repo list`", "help[1]:", "  Valid flags for `repo list`: --json, --help", ""].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });

  test("an unknown flag is rejected before any outside-world call", async () => {
    const { cli, world } = setup();
    const { exitCode } = await cli("repo", "add", "acme/api", "--path", "/src/api", "--force");
    expect(exitCode).toBe(2);
    expect(world.calls).toEqual([]);
  });

  test("an unknown command is a usage error listing the commands", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("dispatch-all");
    expect(exitCode).toBe(2);
    expect(stdout).toStartWith("error: unknown command `dispatch-all`\nhelp[40]:\n  Run `nico-agent [board]` to show Ready issues");
  });

  test("the retired Scheduler entry points are unknown: `mcp`, `--skill` and `advance --start` (ADR-0009)", async () => {
    const { cli, world } = setup();
    const mcp = await cli("mcp");
    expect(mcp.exitCode).toBe(2);
    expect(mcp.stdout).toStartWith("error: unknown command `mcp`\nhelp[40]:\n  Run `nico-agent [board]` to show Ready issues");
    expect(await cli("--skill")).toMatchObject({
      stdout: ["error: unknown flag --skill for `board`", "help[1]:", "  Valid flags for `board`: --json, --help", ""].join("\n"),
      exitCode: 2,
    });
    expect(await cli("advance", "--start", "BLE-10")).toMatchObject({
      stdout: ["error: unknown flag --start for `advance`", "help[1]:", "  Valid flags for `advance`: --json, --help", ""].join("\n"),
      exitCode: 2,
    });
    expect(world.calls).toEqual([]);
  });

  test("a missing required flag is a usage error with the usage line", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("repo", "add", "acme/api");
    expect(exitCode).toBe(2);
    expect(stdout).toBe(
      ["error: missing required flag --path", "help[1]:", "  Usage: `nico-agent repo add <owner/name> --path <clone>`", ""].join("\n"),
    );
  });

  test("errors are structured JSON on stdout under --json", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("repo", "add", "acme/api", "--path", "/nowhere", "--json");
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      error: "/nowhere is not a git clone",
      help: ["Run `git clone https://github.com/acme/api /nowhere` first, or pass the path of an existing clone"],
    });
  });

  test("--help prints a concise reference for the command", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("repo", "add", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "usage: nico-agent repo add <owner/name> --path <clone>",
        "description: Add a Repo after checking the path is a clone of it",
        "flags[7]{flag,description}:",
        '  "--path <value>",path of a local clone of the repo (required)',
        '  "--linear-team <value>","Linear team key, name or ID"',
        '  "--linear-project <value>",Narrow to a Linear project name or ID',
        '  "--linear-label <value>",Narrow to a Linear label name',
        '  "--base <value>","Base every Dispatch starts from unless stacked (default: origin\'s default branch)"',
        '  "--json",print JSON instead of TOON',
        '  "--help",show help for the command',
        "examples[2]: nico-agent repo add acme/api --path ~/src/api,nico-agent repo add acme/api --path ~/src/api --base beta",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });

  test("a flag right after a one-word command is parsed, not skipped", async () => {
    const { cli, world } = setup();
    const { exitCode } = await cli("board", "--stat");
    expect(exitCode).toBe(2);
    expect(world.calls).toEqual([]);
  });

  test("-v, -V and --version print the bare version", async () => {
    const { cli } = setup();
    for (const flag of ["-v", "-V", "--version"]) {
      expect(await cli(flag)).toMatchObject({ stdout: "0.1.0\n", exitCode: 0 });
    }
  });

  test("top-level --help lists every command", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "bin: ~/.local/bin/nico-agent",
        "description: Dispatch coding agents onto ready-for-agent issues",
        "commands[40]{usage,description}:",
        '  "nico-agent [board]",Show Ready issues across all Repos (the default view)',
        "  nico-agent repo add <owner/name> --path <clone>,Add a Repo after checking the path is a clone of it",
        "  nico-agent repo rm <owner/name>,Remove a Repo (its clone is left untouched)",
        "  nico-agent repo list,List the configured Repos",
        "  nico-agent dispatch <issue>... --harness <harness> --model <model> --effort <effort>,Start an Implementer on each issue in a new herdr worktree workspace (resumes a failed one)",
        '  nico-agent advance,"Dispatch each running Spec\'s next issue and start the head of each Repo\'s Queue while it has room, with the Scheduler defaults from config (skips Held Specs)"',
        '  nico-agent queue <spec> --repo <owner/name>,"Put a candidate Spec last in its Repo\'s Queue, so `advance` starts it when the Repo has room"',
        "  nico-agent unqueue <spec> --repo <owner/name>,Take a Spec out of its Repo's Queue",
        "  nico-agent move <spec> up|down --repo <owner/name>,Move a queued Spec one place toward the head (up) or the tail (down) of its Repo's Queue",
        '  nico-agent review <issue>... --harness <harness> --model <model> --effort <effort>,"Start a Reviewer on each In-flight issue\'s linked PR, in its workspace (resumes a failed one)"',
        '  "nico-agent close <issue>... [--confirm]","Remove each Dispatch\'s workspace and forget it, keeping its branch"',
        `  nico-agent answer <issue> <text>,"Submit text, as typed, to an In-flight issue's Implementer while it waits on the user"`,
        `  "nico-agent peek [<issue>] [--reviewer]","Show what an In-flight issue's Implementer (or Reviewer) has on screen right now; with no issue, the Lead's own"`,
        "  nico-agent orders,\"Show each Standing order, what it lets the Lead do unasked, and whether it is on\"",
        "  nico-agent orders set <order> on|off,Turn one Standing order on or off",
        "  nico-agent intent,\"Show the Intent: what the user is working toward and why, which the user and the Lead both edit\"",
        "  \"nico-agent intent set [--file <path> | --text <markdown>] [--version <version>]\",\"Replace the Intent whole with a Markdown file, --text or standard input (the Lead's `intent` tool)\"",
        "  nico-agent notes,\"Show the Notes: the user's standing preferences, recurring decisions with their reasons, and their names for things, which the user and the Lead both edit\"",
        "  \"nico-agent notes set [--file <path> | --text <markdown>] [--version <version>]\",\"Replace the Notes whole with a Markdown file, --text or standard input (the Lead's `notes` tool)\"",
        '  "nico-agent proposals [--all]","List the Lead\'s open Proposals: what each would run and why"',
        "  nico-agent proposals approve <id>,Run an open Proposal's action in nico-agent and report the outcome; one no longer possible is closed as failed",
        '  "nico-agent proposals decline <id> [reason]","Turn down an open Proposal, telling the Lead why"',
        '  "nico-agent say [--answer <id>] [--raw <transcript>] <text>","Write to the Lead, or answer one of its open questions with --answer"',
        "  nico-agent lead inbox,\"Read the Lead's Inbox: the entries it has not seen, each returned once, with the orient packet (its MCP `inbox` tool)\"",
        "  nico-agent lead say <text>,Write the Lead's reply into the conversation (its MCP `say` tool)",
        '  "nico-agent lead ask <question> [<choice>...]","Ask the user a question for the Lead, with optional choices; it stays open until answered (its MCP `ask` tool)"',
        '  nico-agent lead log,"Show the conversation with the Lead, oldest first, with who said what and when (read-only)"',
        '  "nico-agent lead recall <query> [--since <time>] [--until <time>]","Search the whole conversation with the Lead for text, optionally within a time range (its MCP `recall` tool)"',
        '  "nico-agent lead propose --reason <why> (-- <command>... | --write <repo> [--file <path> | --text <markdown>])","Propose an action, or Markdown to write to a Repo\'s Source, for the user to approve or decline, as the Lead (its MCP `propose` tool)"',
        "  nico-agent harness list,List the Harnesses with their models and Effort levels (discovers uncached ones)",
        "  nico-agent harness refresh,Discover the Harnesses' models and Effort levels again and replace the cache",
        "  nico-agent show <issue>,Print the full Dispatch record of an In-flight issue",
        `  "nico-agent lead start [--harness <harness>] [--model <model>] [--effort <effort>] [--port <port>]","Start the Lead as the herdr agent \`lead\` in its own workspace, connected to serve's MCP server (no-op while it runs)"`,
        `  nico-agent lead status,"Show whether the Lead runs, in which workspace, on which Harness, model and Effort, and its Agent state"`,
        `  nico-agent lead stop,"Close the Lead's workspace and forget it, keeping its home and the conversation"`,
        `  nico-agent voice check,"Send each configured voice service a short sample and report whether it answered, what it returned and how long it took"`,
        `  nico-agent voice,"Show whether Voice is on: the Lead's replies spoken in the app, and the Lead talking for the ear"`,
        `  nico-agent voice on,"Turn Voice on: the app speaks the Lead's replies, and its Nudge tells the Lead to talk for the ear"`,
        `  nico-agent voice off,"Turn Voice off: the Lead's replies are only shown, written for the eye"`,
        '  "nico-agent serve [--port <port>]",Start the web app and its MCP server (/mcp) on 127.0.0.1 (port 42069 by default)',
        "help[1]:",
        "  Run `nico-agent <command> --help` for its flags and examples",
        "",
      ].join("\n"),
    );
  });

  test("a corrupt config file is a structured error, not a crash", async () => {
    const { cli, configDir } = setup();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{bad");
    const { stdout, exitCode } = await cli("repo", "list");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(`error: ${join(configDir, "config.json")} is not valid JSON\nhelp[1]:\n  Fix or delete the file and run \`nico-agent repo add\` again\n`);
  });

  test("an outside-world failure during a command is a structured error", async () => {
    const { cli, world } = setup();
    world.gitRemotes = async () => {
      throw new WorldError("`git` is not installed or not on PATH");
    };
    const { stdout, exitCode } = await cli("repo", "add", "acme/api", "--path", "/src/api");
    expect(exitCode).toBe(1);
    expect(stdout).toBe("error: `git` is not installed or not on PATH\n");
  });
});
