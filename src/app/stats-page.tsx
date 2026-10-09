import { type CSSProperties, useState } from "react";
import { type Chart, type StatsJson, shortDay, statsCharts } from "./stats-charts";
import { useResource } from "./stream";

/** The windows the page offers, in days; `stats` counts 30 by default. */
const WINDOWS = [7, 30, 90];

/**
 * The Stats page's column: PRs merged and issues defined per day, over a
 * window of days, for every Repo or one. Asked of `serve` again on each
 * conversation entry (a merge is one) and Board change (a new issue is one);
 * `stats` reads only what nico-agent keeps, so this costs no GitHub request.
 */
export function StatsPane() {
  const [days, setDays] = useState(30);
  const [repo, setRepo] = useState<string | null>(null);
  const { data, failure } = useResource<StatsJson>(`/api/stats?days=${days}`, ["conversation-entry", "board-changed"]);
  // Until the new window's answer arrives, the last one is not shown as if it were it.
  const stats = data && data.days === days && !("error" in data) ? data : null;
  const view = stats && statsCharts(stats, repo);
  return (
    <section className="side stats" aria-labelledby="side-title">
      <h1 id="side-title">Stats</h1>
      <div className="stats-controls">
        <div className="segmented" role="group" aria-label="Days shown">
          {WINDOWS.map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{`${n} days`}</button>
          ))}
        </div>
        {view && view.repos.length > 1 && (
          <label className="repo-filter">
            <span className="visually-hidden">Repo</span>
            <select value={view.repo ?? ""} onChange={(e) => setRepo(e.target.value || null)}>
              <option value="">All Repos</option>
              {view.repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
      </div>
      {failure && <p className="error">{failure}</p>}
      {!view && !failure && <p className="loading">Counting…</p>}
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

/** A count per day as bars: a bar for a count, a tick on the baseline for none, a hatched column for no data. */
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
              className={d.count === null ? "no-data" : d.count === 0 ? "zero" : undefined}
              style={d.count ? ({ "--height": d.count / c.top } as CSSProperties) : undefined}
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

function Legend() {
  return (
    <ul className="legend" aria-label="Key">
      <li><i className="key count" aria-hidden="true" />A day's count</li>
      <li><i className="key zero" aria-hidden="true" />None that day</li>
      <li><i className="key no-data" aria-hidden="true" />No data: before nico-agent was counting</li>
    </ul>
  );
}
