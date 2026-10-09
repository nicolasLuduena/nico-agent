import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCaller } from "../src/github-calls";
import { RealWorld } from "../src/real-world";
import { freshPrs } from "../src/stage";
import type { Dispatch } from "../src/state";

const HEADERS = [
  "HTTP/2.0 200 OK",
  "Content-Type: application/json; charset=utf-8",
  "X-Ratelimit-Limit: 5000",
  "X-Ratelimit-Remaining: 4210",
  "X-Ratelimit-Reset: 1791569420",
  "X-Ratelimit-Resource: graphql",
  "X-Ratelimit-Used: 790",
  "",
  "",
].join("\r\n");

/** A `gh` on PATH that prints `stdout` (and `stderr`, exiting 1 when given), for the length of `body`. */
async function withFakeGh<T>(stdout: string, body: (bin: string) => Promise<T>, stderr = ""): Promise<T> {
  const bin = mkdtempSync(join(tmpdir(), "nico-gh-"));
  writeFileSync(join(bin, "out"), stdout);
  writeFileSync(join(bin, "err"), stderr);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${bin}/args"\ncat "${bin}/out"\ncat "${bin}/err" >&2\n${stderr ? "exit 1\n" : ""}`);
  chmodSync(join(bin, "gh"), 0o755);
  noApp(bin);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    return await body(bin);
  } finally {
    process.env.PATH = path;
  }
}

/** A `ghbot` in `bin` whose App is installed nowhere, so every read goes as the user. */
function noApp(bin: string) {
  writeFileSync(join(bin, "ghbot"), "#!/bin/sh\necho 'HTTP 404' >&2\nexit 1\n");
  chmodSync(join(bin, "ghbot"), 0o755);
}

/** The logged calls, without the lookup of the Repos the bot reads, which a Repo's first read makes. */
function logged(file: string) {
  return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((c) => c.resource !== "app");
}

test("a GraphQL call is logged with its caller, query, Repo, duration, outcome and the budget its headers report", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "nico-calls-")), "github-calls.jsonl");
  const page = { data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } };
  await withFakeGh(HEADERS + JSON.stringify(page), async (bin) => {
    expect(await withCaller("board", () => new RealWorld({ githubCalls: log }).githubIssues("acme/api"))).toEqual([]);
    expect(readFileSync(join(bin, "args"), "utf8")).toStartWith("api -i graphql");
  });
  const [entry, ...rest] = logged(log);
  expect(rest).toEqual([]);
  expect(entry).toMatchObject({
    caller: "board",
    query: "ISSUES_QUERY",
    repo: "acme/api",
    outcome: "ok",
    budget: { resource: "graphql", limit: 5000, remaining: 4210, used: 790, reset: "2026-10-09T18:10:20.000Z" },
  });
  expect(Date.now() - Date.parse(entry.at)).toBeLessThan(10_000);
  expect(entry.ms).toBeGreaterThanOrEqual(0);
  // Finding who reads the Repo is a GitHub call too, logged with the read it serves.
  const lookups = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((c) => c.resource === "app");
  expect(lookups).toEqual([expect.objectContaining({ caller: "board", query: "ghbot installation/repositories", outcome: "failed" })]);
});

test("a failed call is logged with its REST endpoint, its Repo and whether a rate limit failed it", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "nico-calls-")), "github-calls.jsonl");
  await withFakeGh("", async () => {
    const world = new RealWorld({ githubCalls: log });
    await expect(withCaller("cli show", () => world.githubIssueDescription("acme/api", 7))).rejects.toThrow("GitHub rate limit exceeded");
  }, "gh: API rate limit exceeded for user ID 1. (HTTP 403)\nmore detail\n");
  expect(logged(log)).toEqual([expect.objectContaining({
    caller: "cli show", query: "repos/<slug>/issues/<n>", repo: "acme/api", resource: "core",
    outcome: "rate limited", error: "gh: API rate limit exceeded for user ID 1. (HTTP 403)",
  })]);
});

test("logging a call drops the calls older than a week", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "nico-calls-")), "github-calls.jsonl");
  const old = (at: string) => JSON.stringify({ at, caller: "board", query: "ISSUES_QUERY", resource: "graphql", ms: 1, outcome: "ok" });
  const day = 24 * 60 * 60 * 1000;
  writeFileSync(log, `${old(new Date(Date.now() - 8 * day).toISOString())}\n${old(new Date(Date.now() - 6 * day).toISOString())}\n`);
  await withFakeGh(`HTTP/2.0 200 OK\r\n\r\n"me"`, async () => {
    expect(await withCaller("cli repo add", () => new RealWorld({ githubCalls: log }).githubViewer())).toBe("\"me\"");
  });
  expect(logged(log).map((c) => [c.caller, c.query])).toEqual([["board", "ISSUES_QUERY"], ["cli repo add", "user"]]);
  expect(Date.now() - Date.parse(logged(log)[0].at)).toBeGreaterThan(5 * day);
});

test("a PR lookup's calls are logged under it, within what asked for it", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "nico-calls-")), "github-calls.jsonl");
  const linked = { data: { repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } } } };
  const bin = mkdtempSync(join(tmpdir(), "nico-gh-"));
  writeFileSync(join(bin, "linked.json"), JSON.stringify(linked));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncase "$1" in api) cat "${bin}/linked.json";; *) echo "[]";; esac\n`);
  chmodSync(join(bin, "gh"), 0o755);
  noApp(bin);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const dispatch = { issue: "acme/api#7", repo: "acme/api", branch: "agent/api-7" } as Dispatch;
    expect(await withCaller("pr watch", () => freshPrs(new RealWorld({ githubCalls: log }))(dispatch))).toBeNull();
  } finally {
    process.env.PATH = path;
  }
  expect(logged(log).map((c) => [c.caller, c.query]).sort()).toEqual([
    ["pr watch > pr lookup", "LINKED_PRS_QUERY"],
    ["pr watch > pr lookup", "pr list"],
  ]);
});
