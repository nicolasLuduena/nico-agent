import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Budget, RateLimit } from "./world";

/** The log of nico-agent's own GitHub calls, one JSON line each, in the config dir. */
export const GITHUB_CALLS_FILE = "github-calls.jsonl";

/** How long a logged call is kept. */
export const GITHUB_CALLS_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/** How often one process checks the log for calls older than GITHUB_CALLS_KEPT_MS. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

/** One `gh` (or `ghbot`) call nico-agent made. */
export interface GitHubCall {
  /** When the call started. */
  at: string;
  /** What made it: `board`, `pr watch > pr lookup`, `cli dispatch`, ... */
  caller: string;
  /** The named GraphQL query, the REST endpoint (`repos/<slug>/issues/<n>`) or the gh command (`pr list`). */
  query: string;
  /** The Repo (`owner/name`) it was about, if one. */
  repo?: string;
  /** Which budget it spends: the account's `graphql` or `core`, or the bot App's `app`. */
  resource: "graphql" | "core" | "app";
  ms: number;
  outcome: "ok" | "failed" | "rate limited";
  /** The first line gh wrote to stderr, on a failure. */
  error?: string;
  /** The budget left after the call, when the response carried `X-Ratelimit-*` headers. */
  budget?: Budget & { resource: string };
}

const callers = new AsyncLocalStorage<string>();

/** Run `body` with GitHub calls made in it attributed to `caller`, under the caller already in effect. */
export function withCaller<T>(caller: string, body: () => T): T {
  const parent = callers.getStore();
  return callers.run(parent ? `${parent} > ${caller}` : caller, body);
}

/** Who a GitHub call made now is for. */
export function currentCaller() {
  return callers.getStore() ?? "unknown";
}

/** `stdout` of a `gh api -i` call split into its `X-Ratelimit-*` budget and its body; output without headers is all body. */
export function splitHeaders(stdout: string): { body: string; budget?: GitHubCall["budget"] } {
  if (!stdout.startsWith("HTTP/")) return { body: stdout };
  const end = stdout.search(/\r?\n\r?\n/);
  if (end === -1) return { body: "" };
  const head = stdout.slice(0, end);
  const body = stdout.slice(end).replace(/^\r?\n\r?\n/, "");
  const header = (name: string) => head.match(new RegExp(`^x-ratelimit-${name}:\\s*(\\S+)`, "im"))?.[1];
  const [limit, remaining, used, reset, resource] = ["limit", "remaining", "used", "reset", "resource"].map(header);
  if (!limit || !remaining || !used || !reset || !resource) return { body };
  return { body, budget: { resource, limit: Number(limit), remaining: Number(remaining), used: Number(used), reset: new Date(Number(reset) * 1000).toISOString() } };
}

const lastPruned = new Map<string, number>();

/** Append `call` to the log at `file`, and now and then drop calls older than a week. Never throws: the log must not fail a call. */
export function recordCall(file: string, call: GitHubCall, now = Date.now()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(call)}\n`);
    if (now - (lastPruned.get(file) ?? 0) < PRUNE_EVERY_MS) return;
    lastPruned.set(file, now);
    const first = firstLine(file);
    if (first && Date.parse(first.at) >= now - GITHUB_CALLS_KEPT_MS) return;
    const kept = readGitHubCalls(file).filter((c) => Date.parse(c.at) >= now - GITHUB_CALLS_KEPT_MS);
    // Another process appending between the read and the rename loses its line; pruning is rare enough for that.
    const temp = join(dirname(file), `.${GITHUB_CALLS_FILE}.${process.pid}`);
    writeFileSync(temp, kept.map((c) => `${JSON.stringify(c)}\n`).join(""));
    renameSync(temp, file);
  } catch {}
}

/** The oldest logged call, read without reading the whole log. */
function firstLine(file: string): GitHubCall | undefined {
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.alloc(4096);
    const read = readSync(fd, chunk, 0, chunk.length, 0);
    return JSON.parse(chunk.subarray(0, read).toString("utf8").split("\n")[0]!);
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** Every call in the log at `file`, oldest first; unreadable lines are skipped. */
export function readGitHubCalls(file: string): GitHubCall[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    if (!line) return [];
    try {
      return [JSON.parse(line) as GitHubCall];
    } catch {
      return [];
    }
  });
}

const HOUR_MS = 60 * 60 * 1000;

/** Whether a call spent budget: reading `rate_limit` spends none. */
function spends(call: GitHubCall) {
  return call.query !== "rate_limit";
}

/** How many calls, and how many of them failed. */
function count(calls: GitHubCall[]) {
  return { calls: calls.length, failures: calls.filter((c) => c.outcome !== "ok").length };
}

/** `calls` counted by `key`, the most first. */
function countBy<K extends "caller" | "query">(calls: GitHubCall[], key: K) {
  const groups = Map.groupBy(calls, (c) => c[key]);
  return [...groups].map(([value, group]) => ({ [key]: value, ...count(group) }) as Record<K, string> & ReturnType<typeof count>)
    .sort((a, b) => b.calls - a.calls || a[key].localeCompare(b[key]));
}

/** Calls made in a window: counted, by caller and by query, and the minute (UTC) with the most. */
function callsIn(calls: GitHubCall[]) {
  const minutes = [...Map.groupBy(calls, (c) => `${c.at.slice(0, 16)}Z`)].map(([minute, group]) => ({ minute, calls: group.length }));
  const busiestMinute = minutes.reduce<{ minute: string; calls: number } | null>((best, m) => (!best || m.calls > best.calls ? m : best), null);
  return { ...count(calls), busiestMinute, byCaller: countBy(calls, "caller"), byQuery: countBy(calls, "query") };
}

/**
 * What `nico-agent github usage` reports: a rate-limited last call first, the
 * calls of the last hour and 24 hours (or since `since`), their failures, and
 * the account's quota with how much of the hour's spend nico-agent's own calls were.
 */
export function githubUsage(calls: GitHubCall[], now: Date, quota: RateLimit | string, since?: Date) {
  const after = (from: number) => calls.filter((c) => Date.parse(c.at) >= from);
  // `github usage` logs its own quota read; the call before it is the one that tells.
  const last = calls.findLast(spends);
  const windows = since
    ? { since: { from: since.toISOString(), ...callsIn(after(since.getTime())) } }
    : { lastHour: callsIn(after(now.getTime() - HOUR_MS)), last24Hours: callsIn(after(now.getTime() - 24 * HOUR_MS)) };
  const failed = after(since?.getTime() ?? now.getTime() - 24 * HOUR_MS).filter((c) => c.outcome !== "ok");
  return {
    ...(last?.outcome === "rate limited" && {
      rateLimited: `the last GitHub call, ${last.query} for ${last.caller} at ${last.at}, hit the ${last.resource} rate limit; it resets at ${resetOf(last, quota) ?? "an unknown time"}`,
    }),
    ...windows,
    failures: failed.reverse().slice(0, 10).map(({ at, caller, query, repo, outcome, error }) => ({ at, caller, query, ...(repo && { repo }), outcome, ...(error && { error }) })),
    quota: typeof quota === "string" ? `unavailable: ${quota}` : {
      graphql: spent(calls, "graphql", quota.graphql),
      core: spent(calls, "core", quota.core),
    },
  };
}

/** When the budget `call` spent starts over: as its headers said, else as `rate_limit` says. */
function resetOf(call: GitHubCall, quota: RateLimit | string) {
  if (call.budget) return call.budget.reset;
  if (typeof quota === "string" || call.resource === "app") return undefined;
  return quota[call.resource].reset;
}

/**
 * A budget with the calls nico-agent logged against it since its hour began;
 * the rest of what was spent is everyone else on the account. A GraphQL call
 * can cost more than one point, so `byOthers` is an upper bound.
 */
function spent(calls: GitHubCall[], resource: "graphql" | "core", budget: Budget) {
  const began = Date.parse(budget.reset) - HOUR_MS;
  const byNicoAgent = calls.filter((c) => c.resource === resource && spends(c) && Date.parse(c.at) >= began).length;
  const seen = calls.findLast((c) => c.budget?.resource === resource);
  return {
    ...budget,
    byNicoAgent,
    byOthers: Math.max(0, budget.used - byNicoAgent),
    ...(seen?.budget && { lastSeen: { at: seen.at, remaining: seen.budget.remaining, used: seen.budget.used } }),
  };
}
