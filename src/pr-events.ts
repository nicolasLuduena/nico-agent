import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Entry, type PrChange, append } from "./conversation";
import type { PrLookup } from "./stage";
import { loadDispatches, writeJsonAtomic } from "./state";
import { type CheckResult, type PullRequest, type PullRequestActivity, type PullRequestComment, type World, WorldError, worldErrorMessage } from "./world";

/** How often `serve` asks GitHub what changed on the PRs it watches. */
export const PR_WATCH_INTERVAL_MS = 60_000;

/** The PRs watched and what was last seen of each, by URL. */
const FILE = "pr-watch.json";
/** The longest comment excerpt an event quotes. */
const EXCERPT = 120;

/** What was last seen of a watched PR. */
interface Watched {
  repo: string;
  number: number;
  /** The issue whose Dispatch opened it. */
  issue: string;
  /** Whether it was a draft; unset until it is first asked about. */
  draft?: boolean;
  /** Whether it was last known to conflict with its base. */
  conflicting?: boolean;
  /** The last result of each check, by name. */
  checks: Record<string, CheckResult>;
  /** When the latest comment seen was published; comments are asked for from then on. */
  since?: string;
  /** The ids of the comments published at `since`, the only ones asked for again. */
  seen: string[];
  /**
   * Set once it is merged or closed: it is asked about no more, and kept so a
   * stale lookup can't watch it afresh, until its issue has no Dispatch.
   */
  finished?: true;
}

/**
 * Watch each In-flight issue's open PR, and every PR watched before, until it
 * is merged or closed (a Dispatch Closed with its PR ready leaves the PR
 * watched). Each new review comment, check result, merge conflict, ready for
 * review, merge and close is written once as an `event` entry, reaching the
 * Lead's Inbox. A PR GitHub cannot be asked about is a warning, and asked
 * again next time.
 */
export async function watchPrs(world: World, configDir: string, prs: PrLookup): Promise<{ events: Entry[]; warnings: string[] }> {
  const dispatches = loadDispatches(configDir);
  const watched = load(configDir);
  for (const [url, pr] of Object.entries(watched)) {
    if (pr.finished && !dispatches.some((d) => d.issue === pr.issue)) delete watched[url];
  }
  for (const dispatch of dispatches) {
    let pr: PullRequest | null;
    try {
      pr = await prs(dispatch);
    } catch (e) {
      // The Board reports a PR it cannot look up; the next tick asks again.
      if (e instanceof WorldError) continue;
      throw e;
    }
    if (pr?.state === "open" && !watched[pr.url]) {
      watched[pr.url] = { repo: pr.repo, number: pr.number, issue: dispatch.issue, checks: {}, seen: [] };
    }
  }
  const events: Entry[] = [];
  const warnings: string[] = [];
  for (const [url, pr] of Object.entries(watched)) {
    if (pr.finished) continue;
    let activity: PullRequestActivity;
    try {
      activity = await world.githubPullRequestActivity(pr.repo, pr.number, pr.since ? new Date(pr.since) : undefined);
    } catch (e) {
      warnings.push(`${url}: ${worldErrorMessage(e)}`);
      continue;
    }
    for (const { change, text } of changes(pr, activity)) {
      events.push(await append(configDir, { type: "event", pr: url, issue: pr.issue, change, text: `${url}: ${text}` }, world.now()));
    }
    if (activity.state !== "open") pr.finished = true;
    // Saved after each PR's events, so none is written twice.
    writeJsonAtomic(join(configDir, FILE), watched);
  }
  writeJsonAtomic(join(configDir, FILE), watched);
  return { events, warnings };
}

/** What changed on `pr` since it was last seen, in order; `pr` is updated to what is seen now. */
function changes(pr: Watched, activity: PullRequestActivity): { change: PrChange; text: string }[] {
  const found: { change: PrChange; text: string }[] = [];
  if (activity.state === "open" && pr.draft === true && !activity.draft) found.push({ change: "ready", text: "ready for review" });
  pr.draft = activity.draft;
  const fresh = activity.comments.filter((c) => !pr.seen.includes(c.id));
  for (const comment of fresh) {
    const said = commentText(comment);
    if (said) found.push({ change: comment.review ? "review" : "comment", text: said });
  }
  if (fresh.length) {
    const latest = Math.max(...fresh.map((c) => Date.parse(c.at)));
    pr.since = new Date(latest).toISOString();
    pr.seen = activity.comments.filter((c) => Date.parse(c.at) === latest).map((c) => c.id);
  }
  for (const [name, result] of checkResults(activity)) {
    if (result !== "pending" && pr.checks[name] !== result) found.push({ change: "check", text: `check ${name} ${result}` });
    pr.checks[name] = result;
  }
  // Unknown leaves what was known: GitHub reports it while working mergeability out again.
  if (activity.state === "open" && activity.mergeable !== "unknown") {
    const conflicting = activity.mergeable === "conflicting";
    if (conflicting && !pr.conflicting) found.push({ change: "conflict", text: `conflicts with ${activity.baseBranch}` });
    pr.conflicting = conflicting;
  }
  if (activity.state === "merged") found.push({ change: "merged", text: "merged" });
  if (activity.state === "closed") found.push({ change: "closed", text: "closed without merging" });
  return found;
}

/** One result per check name: failed if any of that name failed, else pending while any runs, else passed. */
function checkResults({ checks }: PullRequestActivity): Map<string, CheckResult> {
  const rank: CheckResult[] = ["passed", "pending", "failed"];
  const results = new Map<string, CheckResult>();
  for (const { name, result } of checks) {
    const known = results.get(name);
    if (!known || rank.indexOf(result) > rank.indexOf(known)) results.set(name, result);
  }
  return results;
}

/** What a review's verdict says it did. */
const REVIEWED = { "approved": "approved", "changes requested": "requested changes", "commented": "reviewed" } as const;

/** A comment in one line: who, what kind, where, and its first line; null for a review that only carries inline comments. */
function commentText({ author, body, path, review }: PullRequestComment): string | null {
  // Bots open their comments with hidden HTML comments; the text starts after them.
  const line = body.replace(/<!--[\s\S]*?-->/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const quote = line.length > EXCERPT ? `"${line.slice(0, EXCERPT - 1)}…"` : `"${line}"`;
  if (review === "commented" && !line) return null;
  const did = review ? REVIEWED[review] : "commented";
  return `${author} ${did}${path ? ` on ${path}` : ""}${line ? `: ${quote}` : ""}`;
}

function load(configDir: string): Record<string, Watched> {
  try {
    return JSON.parse(readFileSync(join(configDir, FILE), "utf8")) as Record<string, Watched>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}
