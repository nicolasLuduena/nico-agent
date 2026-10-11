import { type CSSProperties, useEffect, useState } from "react";
import { sameSlug } from "../slug";
import { type Chart, type StatsAnswer, shortDay, statsCharts } from "./stats-charts";
import { useResource } from "./stream";

/** The windows the page offers, in days; `stats` counts 30 by default. */
const WINDOWS = [7, 30, 90];

/**
 * The Stats page's column: PRs merged and issues defined per day, over a
 * window of days, for every Repo or the one picked from `repos` (the
 * configured Repos), as `/api/stats` counts them. Asked of `serve` again when
 * a Sync's `state-changed` names the stats; `serve` answers from its Local
 * state (ADR-0015), so this costs no GitHub request.
 */
export function StatsPane({ repos }: { repos: string[] }) {
  const [days, setDays] = useState(30);
  const [repo, setRepo] = useState<string | null>(null);
  const path = `/api/stats?days=${days}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`;
  const { data, failure } = useResource<StatsAnswer>(path, [], ["stats"]);
  const refused = data && "error" in data ? data.error : null;
  // Until the answer for this window and Repo arrives, the last one is not shown as if it were it.
  const stats = data && !("error" in data) && data.days === days && (!repo || data.total.repos.every((r) => sameSlug(r.repo, repo))) ? data : null;
  const view = stats && statsCharts(stats);
  // A Repo picked and since gone has nothing to count: back to every Repo.
  useEffect(() => {
    if (refused && repo) setRepo(null);
  }, [refused, repo]);
  return (
    <section className="side stats" aria-labelledby="side-title">
      <h1 id="side-title">Stats</h1>
      <div className="stats-controls">
        <div className="segmented" role="group" aria-label="Days shown">
          {WINDOWS.map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{`${n} days`}</button>
          ))}
        </div>
        {repos.length > 1 && (
          <label className="repo-filter">
            <span className="visually-hidden">Repo</span>
            <select value={repo ?? ""} onChange={(e) => setRepo(e.target.value || null)}>
              <option value="">All Repos</option>
              {repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
      </div>
      {(failure ?? refused) && <p className="error">{failure ?? refused}</p>}
      {!view && !failure && !refused && <p className="loading">Counting…</p>}
      {view && (
        <>
          {view.charts.map((c) => <BarChart key={c.metric} chart={c} />)}
          <p className="lede counted">{view.counted}</p>
          <Legend />
        </>
      )}
    </section>
  );
}

/** A count per day as bars: a bar for a count, a dash on the baseline for none, a hatched column for no data. */
function BarChart({ chart: c }: { chart: Chart }) {
  const first = c.days[0];
  const last = c.days.at(-1);
  return (
    <figure className="chart">
      <figcaption>
        <h2>{c.title}</h2>
        <span className="total">{c.total === null ? "No data" : c.total}</span>
      </figcaption>
      <div className="plot">
        <span className="scale" aria-hidden="true">{c.top}</span>
        <ol className="bars" aria-label={`${c.title} per day`} style={{ "--days": c.days.length } as CSSProperties}>
          {c.days.map((d) => (
            <li
              key={d.day}
              className={d.kind}
              style={d.kind === "count" ? ({ "--height": d.count! / c.top } as CSSProperties) : undefined}
              title={d.label}
            >
              <span className="visually-hidden">{d.label}</span>
            </li>
          ))}
        </ol>
      </div>
      {first && last && (
        <div className="axis" aria-hidden="true"><span>{shortDay(first.day)}</span><span>{shortDay(last.day)}</span></div>
      )}
    </figure>
  );
}

/** What each kind of day looks like. */
function Legend() {
  return (
    <ul className="legend" aria-label="Key">
      <li><i className="key count" aria-hidden="true" />A day's count</li>
      <li><i className="key zero" aria-hidden="true" />None that day</li>
      <li><i className="key no-data" aria-hidden="true" />No data: before nico-agent was counting</li>
    </ul>
  );
}
