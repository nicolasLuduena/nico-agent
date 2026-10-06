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
    expect(stdout).toStartWith("error: unknown command `dispatch-all`\nhelp[12]:\n  Run `nico-agent [board]` to show Ready issues");
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
        "flags[6]{flag,description}:",
        '  "--path <value>",path of a local clone of the repo (required)',
        '  "--linear-team <value>","Linear team key, name or ID"',
        '  "--linear-project <value>",Narrow to a Linear project name or ID',
        '  "--linear-label <value>",Narrow to a Linear label name',
        '  "--json",print JSON instead of TOON',
        '  "--help",show help for the command',
        "examples[1]: nico-agent repo add acme/api --path ~/src/api",
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
        "commands[12]{usage,description}:",
        '  "nico-agent [board]",Show Ready issues across all Repos (the default view)',
        "  nico-agent repo add <owner/name> --path <clone>,Add a Repo after checking the path is a clone of it",
        "  nico-agent repo rm <owner/name>,Remove a Repo (its clone is left untouched)",
        "  nico-agent repo list,List the configured Repos",
        "  nico-agent dispatch <issue>... --harness <harness> --model <model> --effort <effort>,Start an Implementer on each issue in a new herdr worktree workspace (resumes a failed one)",
        "  nico-agent advance,Dispatch each running Spec's next issue with the Scheduler defaults from config (resumes a failed one)",
        '  nico-agent review <issue>... --harness <harness> --model <model> --effort <effort>,"Start a Reviewer on each In-flight issue\'s linked PR, in its workspace (resumes a failed one)"',
        '  "nico-agent close <issue>... [--confirm]","Remove each Dispatch\'s workspace and forget it, keeping its branch"',
        "  nico-agent harness list,List the Harnesses with their models and Effort levels (discovers uncached ones)",
        "  nico-agent harness refresh,Discover the Harnesses' models and Effort levels again and replace the cache",
        "  nico-agent show <issue>,Print the full Dispatch record of an In-flight issue",
        '  "nico-agent serve [--port <port>]",Start the web app on 127.0.0.1 (port 42069 by default)',
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
