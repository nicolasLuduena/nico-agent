import { sameSlug } from "../slug";
import type { Stats } from "../stats";

/** What `/api/stats` answers: `nico-agent stats --json`. */
export type StatsJson = Stats;

type Metric = "merged" | "defined";

/** A day of a chart: its count, or null where nothing was counted yet, which is not zero. */
export interface ChartDay {
  day: string;
  count: number | null;
  /** The day and its count in words, such as `Sep 29: 1 PR merged` or `Sep 27: no data`. */
  label: string;
}

export interface Chart {
  metric: Metric;
  title: string;
  /** Over the window, or null when no day has data. */
  total: number | null;
  /** The height of a full bar: the busiest day's count, at least 1. */
  top: number;
  days: ChartDay[];
}

const METRICS: { metric: Metric; title: string; one: string; many: string }[] = [
  { metric: "merged", title: "PRs merged", one: "PR merged", many: "PRs merged" },
  { metric: "defined", title: "Issues defined", one: "issue defined", many: "issues defined" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A `YYYY-MM-DD` day as `Sep 29`, the same in every locale and time zone. */
export function shortDay(day: string) {
  const [, month, date] = day.split("-").map(Number);
  return `${MONTHS[month! - 1]} ${date}`;
}

/**
 * The Stats page's charts, one per count, over every Repo of `stats` or only
 * `repo`, with the Repos that can be picked. A `repo` the stats do not hold
 * shows every Repo, so a Repo removed since it was picked falls back to all.
 */
export function statsCharts(stats: StatsJson, repo: string | null) {
  const repos = stats.total.repos.map((r) => r.repo);
  const index = repo === null ? -1 : repos.findIndex((r) => sameSlug(r, repo));
  const charts = METRICS.map(({ metric, title, one, many }): Chart => {
    const days = stats.series.map((d): ChartDay => {
      const count = (index < 0 ? d : d.repos[index]!)[metric];
      const words = count === null ? "no data" : count === 0 ? `no ${many}` : `${count} ${count === 1 ? one : many}`;
      return { day: d.day, count, label: `${shortDay(d.day)}: ${words}` };
    });
    const total = (index < 0 ? stats.total : stats.total.repos[index]!)[metric];
    return { metric, title, total, top: Math.max(1, ...days.map((d) => d.count ?? 0)), days };
  });
  return { repos, repo: index < 0 ? null : repos[index]!, charts, counted: countedLine(stats) };
}

/** What the counts are, and the first day each was kept from. */
function countedLine({ countedSince: { merged, defined } }: StatsJson) {
  const since = [merged && `merged PRs since ${shortDay(merged)}`, defined && `issues defined since ${shortDay(defined)}`].filter(Boolean);
  return `Counted from the PRs and issues nico-agent has seen, not the Repos' full history: ${since.length ? since.join(", ") : "nothing seen yet"}.`;
}
