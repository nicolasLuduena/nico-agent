import { copyFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { leadContext } from "../src/lead-context";

const FIXTURE = join(import.meta.dir, "fixtures/lead-transcript.jsonl");
const HOME = "/home/someone/.config/nico-agent/lead";
/** Where Claude Code keeps the transcripts of a session run in HOME. */
const SESSIONS = "-home-someone--config-nico-agent-lead";
const STARTED = new Date("2026-10-09T14:59:00.000Z");

/** A Claude Code config dir holding the Lead's sessions, each copied from `source` and last written at `at`. */
function claudeDir(sessions: { id: string; at: Date; source?: string }[]) {
  const dir = mkdtempSync(join(tmpdir(), "nico-agent-claude-"));
  mkdirSync(join(dir, "projects", SESSIONS), { recursive: true });
  for (const { id, at, source = FIXTURE } of sessions) {
    const file = join(dir, "projects", SESSIONS, `${id}.jsonl`);
    copyFileSync(source, file);
    utimesSync(file, at, at);
  }
  return dir;
}

describe("the Lead's context", () => {
  test("is the newest assistant entry's input, cache creation and cache read tokens, over the window", () => {
    const claude = claudeDir([{ id: "f3c4210e", at: new Date("2026-10-09T15:00:13.000Z") }]);
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus" })).toEqual({
      tokens: 156_000, window: 200_000, percent: 78, warning: false, session: "f3c4210e",
    });
  });

  test("is read from the newest session, so a restarted Lead's starts afresh", () => {
    const short = join(mkdtempSync(join(tmpdir(), "nico-agent-transcript-")), "short.jsonl");
    writeFileSync(short, `${JSON.stringify({ type: "assistant", isSidechain: false, message: { usage: { input_tokens: 5, cache_creation_input_tokens: 9_995, cache_read_input_tokens: 0 } } })}\n`);
    const claude = claudeDir([
      { id: "old", at: new Date("2026-10-09T15:00:13.000Z") },
      { id: "new", at: new Date("2026-10-09T16:00:00.000Z"), source: short },
    ]);
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus" })).toMatchObject({ tokens: 10_000, percent: 5, session: "new" });
    // Restarted after the newest was written: the new Lead has not answered yet.
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: new Date("2026-10-09T16:30:00.000Z"), model: "opus" })).toBeNull();
  });

  test("warns above the threshold, 80% unless config sets another", () => {
    const claude = claudeDir([{ id: "s", at: new Date("2026-10-09T15:00:13.000Z") }]);
    const at = (window: number, warning?: number) =>
      leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus", window, ...(warning !== undefined && { warnAbove: warning }) });
    expect(at(195_000)).toMatchObject({ percent: 80, warning: false });
    expect(at(190_000)).toMatchObject({ percent: 82, warning: true });
    expect(at(260_000, 50)).toMatchObject({ percent: 60, warning: true });
  });

  test("takes a 1M window for a [1m] model, and the window config sets over either", () => {
    const claude = claudeDir([{ id: "s", at: new Date("2026-10-09T15:00:13.000Z") }]);
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus[1m]" })).toMatchObject({ window: 1_000_000, percent: 16 });
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus[1m]", window: 400_000 })).toMatchObject({ window: 400_000, percent: 39 });
  });

  test("is nothing without a transcript for the Lead's home", () => {
    const claude = claudeDir([]);
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus" })).toBeNull();
    expect(leadContext({ claudeConfigDir: claude, home: "/somewhere/else", startedAt: STARTED, model: "opus" })).toBeNull();
  });

  test("finds the newest assistant entry behind a long tail of other entries", () => {
    const long = join(mkdtempSync(join(tmpdir(), "nico-agent-transcript-")), "long.jsonl");
    const result = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(50_000) }] } });
    const assistant = (read: number) => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: read } } });
    writeFileSync(long, [assistant(1), result, assistant(120_000 - 1), ...Array(5).fill(result), ""].join("\n"));
    const claude = claudeDir([{ id: "long", at: new Date("2026-10-09T15:00:13.000Z"), source: long }]);
    expect(leadContext({ claudeConfigDir: claude, home: HOME, startedAt: STARTED, model: "opus" })).toMatchObject({ tokens: 120_000, percent: 60 });
  });
});
