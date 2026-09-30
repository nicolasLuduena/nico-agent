import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadDispatches } from "../src/state";

describe("Dispatch record", () => {
  test("concurrent writers in separate processes don't corrupt or lose records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nico-agent-state-"));
    const writer = join(import.meta.dir, "state-writer.ts");
    const writers = Array.from({ length: 12 }, (_, i) =>
      Bun.spawn(["bun", writer, dir, String(i)], { stdout: "inherit", stderr: "inherit" }).exited,
    );
    expect(await Promise.all(writers)).toEqual(Array(12).fill(0));
    const issues = loadDispatches(dir).map((d) => d.issue).sort();
    expect(issues).toEqual(Array.from({ length: 12 }, (_, i) => `acme/api#${i}`).sort());
  });
});
