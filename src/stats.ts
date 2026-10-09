import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry } from "./conversation";
import { sameSlug } from "./slug";
import { withFileLock, writeJsonAtomic } from "./state";

/** When each issue was first seen on the Board, and each Repo first read: the record issues defined are counted from. */
const FILE = "issues-seen.json";

interface SeenFile {
  /** When each Repo's issues were first read, by slug: its record starts that day. */
  repos: Record<string, string>;
  /** When each issue (`owner/repo#N` or a Linear identifier) was first seen, and its Repo. */
  issues: Record<string, { repo: string; at: string }>;
}

/** What one Board read saw: the Repos whose issues loaded, and every issue they listed. */
export interface BoardSighting {
  repos: string[];
  issues: { repo: string; issue: string }[];
}

function load(dir: string): SeenFile {
  try {
    return JSON.parse(readFileSync(join(dir, FILE), "utf8")) as SeenFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { repos: {}, issues: {} };
    throw e;
  }
}

/**
 * Record the Repos and issues a Board read saw for the first time, at `at`;
 * what was seen before keeps its first time. Nothing is written when nothing is new.
 */
export function recordSighting(dir: string, sighting: BoardSighting, at: Date): Promise<void> {
  if (!sighting.repos.length && !sighting.issues.length) return Promise.resolve();
  return withFileLock(dir, FILE, () => {
    const seen = load(dir);
    let changed = false;
    for (const repo of sighting.repos) {
      if (Object.keys(seen.repos).some((r) => sameSlug(r, repo))) continue;
      seen.repos[repo] = at.toISOString();
      changed = true;
    }
    for (const { repo, issue } of sighting.issues) {
      if (seen.issues[issue]) continue;
      seen.issues[issue] = { repo, at: at.toISOString() };
      changed = true;
    }
    if (changed) writeJsonAtomic(join(dir, FILE), seen);
  });
}

/** A day's counts; null where there is no record for that day yet, which is not zero. */
interface Counts {
  merged: number | null;
  defined: number | null;
}

export interface Stats {
  /** The first and last day of the series (UTC), and how many days it spans. */
  from: string;
  to: string;
  days: number;
  /** The first day each count has a record from; null when it has none yet. */
  recordSince: { merged: string | null; defined: string | null };
  /** Over the whole series, in total and per Repo; days with no data count nothing. */
  total: Counts & { repos: ({ repo: string } & Counts)[] };
  /** Each day, oldest first, in total and per Repo. */
  series: ({ day: string } & Counts & { repos: ({ repo: string } & Counts)[] })[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayOf(time: string | Date) {
  return new Date(time).toISOString().slice(0, 10);
}

/** The Repo (`owner/name`) of a GitHub PR's URL. */
function repoOfPr(url: string) {
  return url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1];
}

/**
 * PRs merged and issues defined per day (UTC) over the `days` days up to
 * `now`, per Repo and in total, from what nico-agent already keeps: the
 * conversation's `merged` events, each PR once, and the record of when each
 * issue was first seen on the Board. A day before a record starts is no data,
 * not zero. `repos` are the configured Repos, listed even without data;
 * `repo` narrows it all to one.
 */
export function stats(dir: string, entries: Entry[], opts: { now: Date; days: number; repos: string[]; repo?: string }): Stats {
  const seen = load(dir);
  const merges = new Map<string, { repo: string; day: string }>();
  for (const e of entries) {
    if (e.type !== "event" || e.change !== "merged" || merges.has(e.pr)) continue;
    const repo = repoOfPr(e.pr);
    if (repo) merges.set(e.pr, { repo, day: dayOf(e.at) });
  }
  const firstEvent = entries.find((e) => e.type === "event");
  const mergedSince = firstEvent ? dayOf(firstEvent.at) : null;

  // One spelling per Repo: the configured one, else the first recorded.
  const names: string[] = [];
  const name = (repo: string) => {
    const known = names.find((n) => sameSlug(n, repo));
    if (known) return known;
    names.push(repo);
    return repo;
  };
  for (const repo of [...opts.repos, ...Object.keys(seen.repos), ...[...merges.values()].map((m) => m.repo)]) name(repo);
  const shown = opts.repo ? [name(opts.repo)] : names;
  const definedSince = (repo: string) => {
    const at = Object.entries(seen.repos).find(([r]) => sameSlug(r, repo))?.[1];
    return at ? dayOf(at) : null;
  };

  const today = dayOf(opts.now);
  const days = Array.from({ length: opts.days }, (_, i) => dayOf(new Date(Date.parse(today) - (opts.days - 1 - i) * DAY_MS)));
  const count = (day: string, repo: string): Counts => {
    const since = definedSince(repo);
    return {
      merged: mergedSince && day >= mergedSince ? [...merges.values()].filter((m) => m.day === day && sameSlug(m.repo, repo)).length : null,
      defined: since && day >= since ? Object.values(seen.issues).filter((i) => dayOf(i.at) === day && sameSlug(i.repo, repo)).length : null,
    };
  };
  const sum = (counts: Counts[]): Counts => ({
    merged: add(counts.map((c) => c.merged)),
    defined: add(counts.map((c) => c.defined)),
  });
  const series = days.map((day) => {
    const repos = shown.map((repo) => ({ repo, ...count(day, repo) }));
    return { day, ...sum(repos), repos };
  });
  const totals = shown.map((repo) => ({ repo, ...sum(series.map((d) => d.repos.find((r) => r.repo === repo)!)) }));
  const definedStarts = shown.map(definedSince).filter((d): d is string => d !== null).sort();
  return {
    from: days[0]!,
    to: today,
    days: opts.days,
    recordSince: { merged: mergedSince, defined: definedStarts[0] ?? null },
    total: { ...sum(totals), repos: totals },
    series,
  };
}

/** The sum of the counts that have data; null when none has. */
function add(counts: (number | null)[]) {
  const known = counts.filter((c): c is number => c !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
