import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";
import { FakeWorld } from "./fake-world";

export function setup() {
  const world = new FakeWorld();
  const configDir = join(mkdtempSync(join(tmpdir(), "nico-agent-test-")), "config");
  const cli = async (...argv: string[]) => {
    const result = await run(argv, { world, configDir, bin: "~/.local/bin/nico-agent" });
    return { ...result, json: () => JSON.parse(result.stdout) };
  };
  return { world, configDir, cli };
}
