import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { GITHUB_CALLS_FILE, type GitHubCall } from "../src/github-calls";
import { setup } from "./harness";

const call = (at: string, caller: string, query: string, more: Partial<GitHubCall> = {}): GitHubCall =>
  ({ at, caller, query, repo: "acme/api", resource: "graphql", ms: 300, outcome: "ok", ...more });

function writeLog(configDir: string, calls: GitHubCall[]) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, GITHUB_CALLS_FILE), calls.map((c) => `${JSON.stringify(c)}\n`).join(""));
}

// The fake clock reads 2026-09-30T12:00:00Z.
const WEEK = [
  call("2026-09-28T09:00:00.000Z", "board", "ISSUES_QUERY"),
  call("2026-09-30T05:00:00.000Z", "cli dispatch", "ISSUE_QUERY"),
  call("2026-09-30T11:30:00.000Z", "scheduler", "LINKED_PRS_QUERY", { outcome: "failed", error: "gh: Something went wrong" }),
  call("2026-09-30T11:59:10.000Z", "board", "ISSUES_QUERY"),
  call("2026-09-30T11:59:30.000Z", "board", "ISSUES_QUERY"),
  call("2026-09-30T11:59:50.000Z", "pr watch > pr lookup", "pr list"),
];

describe("github usage", () => {
  test("counts nico-agent's GitHub calls of the last hour and 24 hours by caller and by query, with the busiest minute, the failures and the account's quota", async () => {
    const { cli, configDir } = setup();
    writeLog(configDir, WEEK);
    const { json, exitCode } = await cli("github", "usage", "--json");
    expect(exitCode).toBe(0);
    const out = json();
    expect(out.lastHour).toEqual({
      calls: 4,
      failures: 1,
      busiestMinute: { minute: "2026-09-30T11:59Z", calls: 3 },
      byCaller: [
        { caller: "board", calls: 2, failures: 0 },
        { caller: "pr watch > pr lookup", calls: 1, failures: 0 },
        { caller: "scheduler", calls: 1, failures: 1 },
      ],
      byQuery: [
        { query: "ISSUES_QUERY", calls: 2, failures: 0 },
        { query: "LINKED_PRS_QUERY", calls: 1, failures: 1 },
        { query: "pr list", calls: 1, failures: 0 },
      ],
    });
    expect(out.last24Hours.calls).toBe(5);
    expect(out.last24Hours.byCaller[0]).toEqual({ caller: "board", calls: 2, failures: 0 });
    expect(out.failures).toEqual([
      { at: "2026-09-30T11:30:00.000Z", caller: "scheduler", query: "LINKED_PRS_QUERY", repo: "acme/api", outcome: "failed", error: "gh: Something went wrong" },
    ]);
    // The GraphQL hour began at 11:30; nico-agent logged 4 of the 1000 points spent since.
    expect(out.quota.graphql).toMatchObject({ limit: 5000, remaining: 4000, used: 1000, reset: "2026-09-30T12:30:00.000Z", byNicoAgent: 4, byOthers: 996 });
    expect(out.quota.core).toMatchObject({ remaining: 5000, byNicoAgent: 0, byOthers: 0 });
    expect(out.rateLimited).toBeUndefined();
  });

  test("when the last call failed on a rate limit, says so first, with the reset time", async () => {
    const { cli, configDir } = setup();
    const budget = { resource: "graphql", limit: 5000, remaining: 0, used: 5000, reset: "2026-09-30T12:20:00.000Z" };
    writeLog(configDir, [...WEEK, call("2026-09-30T11:59:55.000Z", "board", "ISSUES_QUERY", { outcome: "rate limited", error: "gh: API rate limit exceeded", budget })]);
    const { stdout } = await cli("github", "usage");
    expect(stdout.split("\n")[0]).toBe(
      "rateLimited: \"the last GitHub call, ISSUES_QUERY for board at 2026-09-30T11:59:55.000Z, hit the graphql rate limit; it resets at 2026-09-30T12:20:00.000Z\"",
    );
    expect(stdout).toContain("lastHour:");
  });

  test("its own quota reads, logged after the rate-limited call, don't hide it", async () => {
    const { cli, configDir } = setup();
    writeLog(configDir, [
      ...WEEK,
      call("2026-09-30T11:59:55.000Z", "board", "ISSUES_QUERY", { outcome: "rate limited", error: "gh: API rate limit exceeded" }),
      call("2026-09-30T11:59:58.000Z", "cli github usage", "rate_limit", { resource: "core" }),
    ]);
    const { json } = await cli("github", "usage", "--json");
    expect(json().rateLimited).toBe(
      "the last GitHub call, ISSUES_QUERY for board at 2026-09-30T11:59:55.000Z, hit the graphql rate limit; it resets at 2026-09-30T12:30:00.000Z",
    );
  });

  test("--since counts from that time instead, and a failed quota read still shows the log", async () => {
    const { cli, configDir, world } = setup();
    writeLog(configDir, WEEK);
    world.callFailures.set("github rate limit", "GitHub request failed; check your network and `gh auth status`");
    const { json, exitCode } = await cli("github", "usage", "--since", "2026-09-30T11:59:00Z", "--json");
    expect(exitCode).toBe(0);
    const out = json();
    expect(out.since).toMatchObject({ from: "2026-09-30T11:59:00.000Z", calls: 3, failures: 0 });
    expect(out.lastHour).toBeUndefined();
    expect(out.failures).toEqual([]);
    expect(out.quota).toBe("unavailable: GitHub request failed; check your network and `gh auth status`");
  });

  test("with nothing logged, says so", async () => {
    const { cli } = setup();
    const { json } = await cli("github", "usage", "--json");
    expect(json().lastHour).toEqual({ calls: 0, failures: 0, busiestMinute: null, byCaller: [], byQuery: [] });
  });
});
