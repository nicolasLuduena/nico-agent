#!/usr/bin/env bun
import { VERSION } from "./version";

const argv = process.argv.slice(2);
if (argv.length === 1 && ["-v", "-V", "--version"].includes(argv[0]!)) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const { homedir } = await import("node:os");
const { basename, join } = await import("node:path");
const { run } = await import("./cli");
const { defaultConfigDir } = await import("./config");
const { GITHUB_CALLS_FILE } = await import("./github-calls");
const { RealWorld } = await import("./real-world");

// A compiled binary runs as itself; `bun src/main.ts` runs as bun + script.
const exe = basename(process.execPath).startsWith("bun") ? (process.argv[1] ?? process.execPath) : process.execPath;
const home = homedir();
const bin = exe === home || exe.startsWith(`${home}/`) ? `~${exe.slice(home.length)}` : exe;

// Standard input is read only when piped, so `intent set` at a terminal is refused rather than waiting.
const stdin = process.stdin.isTTY ? undefined : () => Bun.stdin.text();
const configDir = defaultConfigDir(process.env);
const world = new RealWorld({ githubCalls: join(configDir, GITHUB_CALLS_FILE) });
const result = await run(argv, { world, configDir, bin, ...(stdin && { stdin }) });
process.stdout.write(result.stdout);
// Not process.exit: a running server (`serve`) must keep the process alive.
process.exitCode = result.exitCode;
