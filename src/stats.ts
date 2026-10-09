import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry } from "./conversation";
import { sameSlug } from "./slug";
import { withFileLock, writeJsonAtomic } from "./state";

/** When each Source was first read, and each issue first seen on the Board: what issues defined are counted from. */
const FILE = "issues-seen.json";

interface SeenFile {
  /** When each Source of a Repo was first read, by `GitHub owner/name` or `Linear owner/name`. */
  sources: Record<string, string>;
  /**
   * When each issue (`owner/repo#N` or a Linear identifier) was first seen,
   * and its Repo; `before` marks one its Source's first read found, defined
   * before nico-agent looked, so not counted.
   */
  issues: Record<string, { repo: string; at: string; before?: true }>;
}

/** What one Board read saw: each Source whose issues loaded, with every issue it listed. */
export type BoardSighting = { source: "GitHub" | "Linear"; repo: string; issues: string[] }[];

function load(dir: string): SeenFile {
  try {
    return JSON.parse(readFileSync(join(dir, FILE), "utf8")) as SeenFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { sources: {}, issues: {} };
    throw e;
  }
}

/**
 * Record the Sources and issues a Board read saw for the first time, at `at`;
 * what was seen before keeps its first time. Nothing is written when nothing is new.
 */
export function recordSighting(dir: string, sighting: BoardSighting, at: Date): Promise<void> {
  if (!sighting.length) return Promise.resolve();
  return withFileLock(dir, FILE, () => {
    const seen = load(dir);
    let changed = false;
    for (const { source, repo, issues } of sighting) {
      const key = `${source} ${repo}`;
      const first = !Object.keys(seen.sources).some((k) => k.toLowerCase() === key.toLowerCase());
      if (first) seen.sources[key] = at.toISOString();
      for (const issue of issues) {
        if (seen.issues[issue]) continue;
        seen.issues[issue] = { repo, at: at.toISOString(), ...(first && { before: true as const }) };
        changed = true;
      }
      changed ||= first;
    }
    if (changed) writeJsonAtomic(join(dir, FILE), seen);
  });
}

/** A day's counts; null where nothing was counted yet that day, which is not zero. */
interface Counts {
  merged: number | null;
  defined: number | null;
}

type RepoCounts = { repo: string } & Counts;

/** A day (UTC) as `YYYY-MM-DD`, which sorts and compares as text. */
type Day = string;

export interface Stats {
  /** The first and last day of the series (UTC), and how many days it spans. */
  from: Day;
  to: Day;
  days: number;
  /** The first day each count was kept from; null when it was never kept. */
  countedSince: { merged: Day | null; defined: Day | null };
  /** Over the whole series, in total and per Repo; days with no data count nothing. */
  total: Counts & { repos: RepoCounts[] };
  /** Each day, oldest first, in total and per Repo. */
  series: ({ day: Day } & Counts & { repos: RepoCounts[] })[];
}

/** A `--repo` that is not configured and has nothing counted. */
export class UnknownRepo extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayOf(time: string | Date): Day {
  return new Date(time).toISOString().slice(0, 10);
}

/** The Repo (`owner/name`) of a GitHub PR's URL. */
function repoOfPr(url: string) {
  return url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1];
}

/** Each merged PR once, with its Repo and the day of its first `merged` event. */
function merges(entries: Entry[]) {
  const merged = new Map<string, { repo: string; day: Day }>();
  for (const e of entries) {
    if (e.type !== "event" || e.change !== "merged" || merged.has(e.pr)) continue;
    const repo = repoOfPr(e.pr);
    if (repo) merged.set(e.pr, { repo, day: dayOf(e.at) });
  }
  return [...merged.values()];
}

/** The first day `repo` had a Source read, or null. */
function definedSince(seen: SeenFile, repo: string): Day | null {
  const starts = Object.entries(seen.sources).filter(([key]) => sameSlug(key.split(" ")[1]!, repo)).map(([, at]) => dayOf(at)).sort();
  return starts[0] ?? null;
}

/**
 * PRs merged and issues defined per day (UTC) over the `days` days up to
 * `now`, per Repo and in total, from what nico-agent already keeps: the
 * conversation's `merged` events, each PR once, from the first PR event on;
 * and each issue on the day the Board first listed it as Ready, from its
 * Source's first read on. A day before that is no data, not zero. `repos`
 * are the configured Repos, listed even without data; `repo` narrows it all
 * to one, which must be configured or have something counted.
 */
export function stats(dir: string, entries: Entry[], opts: { now: Date; days: number; repos: string[]; repo?: string }): Stats {
  const seen = load(dir);
  const merged = merges(entries);
  const firstEvent = entries.find((e) => e.type === "event");
  const mergedSince = firstEvent ? dayOf(firstEvent.at) : null;

  // One spelling per Repo: the configured one, else the first counted.
  const spellings: string[] = [];
  const counted = [...Object.keys(seen.sources).map((key) => key.split(" ")[1]!), ...merged.map((m) => m.repo)];
  for (const repo of [...opts.repos, ...counted]) {
    if (!spellings.some((s) => sameSlug(s, repo))) spellings.push(repo);
  }
  let shownRepos = spellings;
  if (opts.repo) {
    const known = spellings.find((s) => sameSlug(s, opts.repo!));
    if (!known) throw new UnknownRepo(`${opts.repo} is not a configured Repo, and nico-agent has counted nothing for it`);
    shownRepos = [known];
  }

  const today = dayOf(opts.now);
  const days = Array.from({ length: opts.days }, (_, i) => dayOf(new Date(Date.parse(today) - (opts.days - 1 - i) * DAY_MS)));
  const defined = Object.values(seen.issues).filter((i) => !i.before);
  const countOn = (day: Day, repo: string): Counts => {
    const since = definedSince(seen, repo);
    return {
      merged: mergedSince && day >= mergedSince ? merged.filter((m) => m.day === day && sameSlug(m.repo, repo)).length : null,
      defined: since && day >= since ? defined.filter((i) => dayOf(i.at) === day && sameSlug(i.repo, repo)).length : null,
    };
  };
  const series = days.map((day) => {
    const repos = shownRepos.map((repo) => ({ repo, ...countOn(day, repo) }));
    return { day, ...sumCounts(repos), repos };
  });
  const totals = shownRepos.map((repo, i) => ({ repo, ...sumCounts(series.map((d) => d.repos[i]!)) }));
  const definedStarts = shownRepos.map((repo) => definedSince(seen, repo)).filter((d) => d !== null).sort();
  return {
    from: days[0]!,
    to: today,
    days: opts.days,
    countedSince: { merged: mergedSince, defined: definedStarts[0] ?? null },
    total: { ...sumCounts(totals), repos: totals },
    series,
  };
}

/** Each count summed over the ones with data; null when none has. */
function sumCounts(counts: Counts[]): Counts {
  return { merged: sumKnown(counts.map((c) => c.merged)), defined: sumKnown(counts.map((c) => c.defined)) };
}

function sumKnown(counts: (number | null)[]) {
  const known = counts.filter((c) => c !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
