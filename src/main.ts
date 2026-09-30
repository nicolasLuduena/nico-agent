#!/usr/bin/env bun
import { VERSION } from "./version";

const argv = process.argv.slice(2);
if (argv.length === 1 && ["-v", "-V", "--version"].includes(argv[0]!)) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const { homedir } = await import("node:os");
const { basename } = await import("node:path");
const { run } = await import("./cli");
const { defaultConfigDir } = await import("./config");
const { RealWorld } = await import("./real-world");

// A compiled binary runs as itself; `bun src/main.ts` runs as bun + script.
const exe = basename(process.execPath).startsWith("bun") ? (process.argv[1] ?? process.execPath) : process.execPath;
const home = homedir();
const bin = exe === home || exe.startsWith(`${home}/`) ? `~${exe.slice(home.length)}` : exe;

const result = await run(argv, { world: new RealWorld(), configDir: defaultConfigDir(process.env), bin });
process.stdout.write(result.stdout);
// Not process.exit: a running server (`serve`) must keep the process alive.
process.exitCode = result.exitCode;
