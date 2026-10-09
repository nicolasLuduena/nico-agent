import { useEffect, useRef } from "react";
import { type Mark, type Reach, type Track, type TrackRow, R, TRACKER_LAYERS, VIEW_BOX, eventDisplay } from "./event";

const LEGEND: [Reach, string][] = [["implementing", "Implementing"], ["pr-ready", "PR ready"], ["review-launched", "Review launched"], ["failed", "Failed"]];

/**
 * The In-flight Dispatches as an event display's transverse view: one track
 * per Dispatch, reaching as far out as its Stage. Rows stay the place to read
 * each one; hovering a track lights its row and the reverse, and clicking a
 * track brings its row into view.
 */
export function EventDisplay({ rows, sampled, lit, onLight, onPick }: {
  rows: TrackRow[];
  sampled: Date;
  lit: string | null;
  onLight: (issue: string | null) => void;
  onPick: (issue: string) => void;
}) {
  const { tracks, counts, blocked } = eventDisplay(rows);
  const legend = (reach: Reach, label: string) => (
    <div key={reach} className={`${reach}${counts[reach] ? "" : " none"}`}><dt><i />{label}</dt><dd>{counts[reach]}</dd></div>
  );
  return (
    <figure className="event">
      <svg viewBox={VIEW_BOX} role="img" aria-label={`${rows.length} ${rows.length === 1 ? "Dispatch" : "Dispatches"} in flight`}>
        <Detector />
        {tracks.map((t) => <TrackPath key={t.issue} track={t} lit={lit === t.issue} onLight={onLight} onPick={onPick} />)}
        <circle className="vertex" r="2.5" />
      </svg>
      <figcaption>
        <p className="lede">{rows.length ? "Each track is a Dispatch. It reaches as far out as its Stage." : "No tracks: nothing in flight."}</p>
        <dl className="stages">
          {LEGEND.map(([reach, label]) => legend(reach, label))}
          {counts.unknown > 0 && legend("unknown", "Stage unknown")}
        </dl>
        <dl className="agents"><div className={`blocked${blocked ? "" : " none"}`}><dt><i />Agent blocked</dt><dd>{blocked}</dd></div></dl>
        <p className="sampled">Sampled <time dateTime={sampled.toISOString()}>{sampled.toTimeString().slice(0, 8)}</time></p>
      </figcaption>
    </figure>
  );
}

/** The detector's fixed geometry: tracker layers, the two calorimeters, two muon stations, named along one radius. */
function Detector() {
  const mid = (r: readonly [number, number]) => (r[0] + r[1]) / 2;
  return (
    <>
      <g className="geometry" fill="none">
        {TRACKER_LAYERS.map((r) => <circle key={r} r={r} />)}
        <circle className="ecal" r={mid(R.ecal)} strokeWidth={R.ecal[1] - R.ecal[0]} pathLength={360} strokeDasharray="6.5 1" />
        <circle className="hcal" r={mid(R.hcal)} strokeWidth={R.hcal[1] - R.hcal[0]} pathLength={360} strokeDasharray="14 1.5" />
        {R.muon.map((r) => <circle key={r} className="muon" r={r} strokeWidth={6} pathLength={360} strokeDasharray="26 4" />)}
      </g>
      <g className="key" textAnchor="middle">
        <text y={R.tracker - 6}>Tracker</text>
        <text y={mid(R.ecal)} dominantBaseline="middle">ECAL</text>
        <text y={mid(R.hcal)} dominantBaseline="middle">HCAL</text>
        <text y={mid(R.muon)} dominantBaseline="middle">Muon</text>
      </g>
    </>
  );
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function TrackPath({ track: t, lit, onLight, onPick }: { track: Track; lit: boolean; onLight: (issue: string | null) => void; onPick: (issue: string) => void }) {
  const path = useRef<SVGPathElement>(null);
  const drawn = useRef(t.reach);
  // A track whose Stage moved draws out to its new reach.
  useEffect(() => {
    if (drawn.current === t.reach) return;
    drawn.current = t.reach;
    if (t.reach === "unknown" || reducedMotion()) return;
    path.current?.animate([{ strokeDasharray: "1 1", strokeDashoffset: 1 }, { strokeDasharray: "1 1", strokeDashoffset: 0 }], { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }, [t.reach]);
  const { control: c, end: e, label } = t;
  return (
    <g
      className={`track ${t.reach}${t.waiting ? " waiting" : ""}${t.working ? " working" : ""}${lit ? " lit" : ""}`}
      onMouseEnter={() => onLight(t.issue)}
      onMouseLeave={() => onLight(null)}
      onClick={() => onPick(t.issue)}
    >
      <title>{t.tooltip}</title>
      <path ref={path} d={`M0 0 Q${c.x} ${c.y} ${e.x} ${e.y}`} pathLength={1} />
      {t.marks.map((m, i) => <MarkShape key={i} mark={m} />)}
      <text x={label.at.x} y={label.at.y} textAnchor={label.anchor} dominantBaseline="middle">{label.text}</text>
    </g>
  );
}

function MarkShape({ mark: m }: { mark: Mark }) {
  if (m.kind === "deposit" || m.kind === "hit") return <line className={m.kind} x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y} />;
  if (m.kind === "burst") {
    return <g className="burst" transform={`translate(${m.at.x} ${m.at.y})`}>{m.angles.map((d) => <line key={d} x1={-5} x2={5} transform={`rotate(${d})`} />)}</g>;
  }
  return <circle className={m.kind} cx={m.at.x} cy={m.at.y} r={m.r} />;
}
