import type { Stats } from "../stats";

/** What `/api/stats` answers: `nico-agent stats --json`, or why it could not count. */
export type StatsJson = Stats;
export type StatsAnswer = StatsJson | { error: string; help: string[] };

type Metric = "merged" | "defined";

/** A day of a chart: its count, or null where nothing was counted yet, which is not zero. */
export interface ChartDay {
  day: string;
  count: number | null;
  /** How the day is drawn: a bar for a count, a dash for none, hatched for no data. */
  kind: "count" | "zero" | "no-data";
  /** The day and its count in words, such as `Sep 29: 1 PR merged` or `Sep 27: no data`. */
  label: string;
}

/** One count's chart: its title, its total over the window, and a bar a day. */
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

/** The months as the app abbreviates them, the same in every locale. */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A `YYYY-MM-DD` day as `Sep 29`, the same in every locale and time zone. */
export function shortDay(day: string) {
  const [, month, date] = day.split("-").map(Number);
  return `${MONTHS[month! - 1]} ${date}`;
}

/**
 * The Stats page's charts, one per count, over what `stats` counted: every
 * Repo, or the one `/api/stats?repo=` narrowed it to; with the Repos it holds.
 */
export function statsCharts(stats: StatsJson) {
  const charts = METRICS.map(({ metric, title, one, many }): Chart => {
    const days = stats.series.map((d): ChartDay => {
      const count = d[metric];
      const kind = count === null ? "no-data" : count === 0 ? "zero" : "count";
      const words = { "no-data": "no data", zero: `no ${many}`, count: `${count} ${count === 1 ? one : many}` }[kind];
      return { day: d.day, count, kind, label: `${shortDay(d.day)}: ${words}` };
    });
    return { metric, title, total: stats.total[metric], top: Math.max(1, ...days.map((d) => d.count ?? 0)), days };
  });
  return { repos: stats.total.repos.map((r) => r.repo), charts, counted: countedLine(stats) };
}

/** What the counts are, and the first day each was kept from. */
function countedLine({ countedSince: { merged, defined } }: StatsJson) {
  const since = [merged && `merged PRs since ${shortDay(merged)}`, defined && `issues defined since ${shortDay(defined)}`].filter(Boolean);
  return `Counted from the PRs and issues nico-agent has seen, not the Repos' full history: ${since.length ? since.join(", ") : "nothing seen yet"}.`;
}
