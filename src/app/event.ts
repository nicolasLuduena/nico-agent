/**
 * The event display's model: the In-flight Dispatches as a detector's
 * transverse view, one track per Dispatch reaching as far out as its Stage.
 * Pure geometry, kept apart from the SVG that draws it.
 */

/** An In-flight Dispatch as the display reads it: its Stage and raw Agent states (`reviewer` empty without one). */
export interface TrackRow {
  issue: string;
  title: string;
  stage: string;
  implementer: string;
  reviewer: string;
}

/** Where a row's track ends, by Stage: inside the tracker, in the calorimeter, out through the muon stations. */
export type Reach = "implementing" | "pr-ready" | "review-launched" | "failed" | "unknown";

export interface Point {
  x: number;
  y: number;
}

export type Mark =
  /** An energy deposit: a tower through the electromagnetic calorimeter. */
  | { kind: "deposit"; from: Point; to: Point }
  /** A hit in a muon station. */
  | { kind: "hit"; from: Point; to: Point }
  /** Where a Failed track ends, its strokes at these angles in degrees. */
  | { kind: "burst"; at: Point; angles: number[] }
  | { kind: "tip"; at: Point; r: number }
  /** A ring round the tip of a track whose agent waits on the user. */
  | { kind: "attention"; at: Point; r: number };

export interface Track {
  issue: string;
  reach: Reach;
  /** An agent of it is blocked, waiting on the user. */
  waiting: boolean;
  working: boolean;
  tooltip: string;
  /** A quadratic curve from the vertex through `control` to `end`. */
  control: Point;
  end: Point;
  marks: Mark[];
  label: { text: string; at: Point; anchor: "start" | "middle" | "end" };
}

export interface EventDisplay {
  tracks: Track[];
  counts: Record<Reach, number>;
  /** Tracks with an agent waiting on the user. */
  blocked: number;
}

/** The subdetectors' radii, in the display's units. */
export const R = { tracker: 62, ecal: [70, 86], hcal: [92, 112], muon: [126, 146], failedEarly: 40, failedReview: 112 } as const;

/** The tracker's layers. */
export const TRACKER_LAYERS = [14, 26, 38, 50, 62] as const;

/** The display's view box, centred on the vertex. */
export const VIEW_BOX = "-200 -162 400 324";

export function reachOf(stage: string): Reach {
  if (stage.startsWith("Failed")) return "failed";
  if (stage === "Implementing" || stage === "PR ready" || stage === "Review launched") {
    return stage.toLowerCase().replace(/[^a-z]+/g, "-") as Reach;
  }
  return "unknown";
}

export function eventDisplay(rows: TrackRow[]): EventDisplay {
  const counts: Record<Reach, number> = { implementing: 0, "pr-ready": 0, "review-launched": 0, failed: 0, unknown: 0 };
  let blocked = 0;
  const angles = spread(rows.map((r) => r.issue));
  const tracks = rows.map((row) => {
    const track = trackOf(row, angles.get(row.issue)!);
    counts[track.reach]++;
    if (track.waiting) blocked++;
    return track;
  });
  return { tracks, counts, blocked };
}

/** A stable 32-bit hash, so a Dispatch's track keeps its angle and bend across polls. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Each issue's track angle: its hash's home angle, nudged apart from close
 * neighbours. A Dispatch coming or going moves only the tracks beside it.
 */
function spread(issues: string[]) {
  const TAU = 2 * Math.PI;
  // The ring key runs straight down; it holds its place and tracks keep clear of it.
  const KEY = "";
  const points = [{ issue: KEY, a: Math.PI / 2 }, ...issues.map((issue) => ({ issue, a: ((hash(issue) % 3600) / 3600) * TAU }))];
  const min = Math.min(TAU / points.length, 0.5) * 0.85;
  for (let pass = 0; pass < 24 && points.length > 1; pass++) {
    points.sort((x, y) => x.a - y.a || x.issue.localeCompare(y.issue));
    let moved = false;
    points.forEach((p, i) => {
      const next = points[(i + 1) % points.length]!;
      const gap = (next.a - p.a + TAU) % TAU;
      if (gap >= min) return;
      const push = (min - gap) / (p.issue === KEY || next.issue === KEY ? 1 : 2);
      if (p.issue !== KEY) p.a = (p.a - push + TAU) % TAU;
      if (next.issue !== KEY) next.a = (next.a + push) % TAU;
      moved = true;
    });
    if (!moved) break;
  }
  return new Map(points.filter((p) => p.issue !== KEY).map((p) => [p.issue, p.a]));
}

/** Coordinates to a tenth, as the display draws them. */
const tenth = (v: number) => Math.round(v * 10) / 10;

function trackOf(row: TrackRow, angle: number): Track {
  const { issue } = row;
  const reach = reachOf(row.stage);
  const waiting = row.implementer === "blocked" || row.reviewer === "blocked";
  const h = hash(issue);
  // A track's bend is its charge: either way, never straight.
  const bend = (((h >>> 12) % 100) / 100 - 0.5) * 0.7 + (((h >>> 12) % 100) < 50 ? -0.12 : 0.12);
  const end = reach === "implementing" ? R.tracker - 4
    : reach === "pr-ready" ? R.ecal[0]
    : reach === "review-launched" ? R.muon[1] + 6
    : reach === "failed" ? (row.stage.startsWith("Failed at review") ? R.failedReview : R.failedEarly)
    : R.tracker - 4;
  const at = (r: number, a = angle): Point => ({ x: tenth(r * Math.cos(a)), y: tenth(r * Math.sin(a)) });
  const tip = at(end);
  // Curvature eases off beyond the tracker, where the field is weak.
  const control = at(Math.min(end, R.tracker) * 0.55, angle - bend * (Math.min(end, R.tracker) / end));
  const marks: Mark[] = [];
  if (reach === "pr-ready") marks.push({ kind: "deposit", from: at(R.ecal[0]), to: at(R.ecal[1] - 1) });
  if (reach === "review-launched") for (const r of R.muon) marks.push({ kind: "hit", from: at(r - 3), to: at(r + 3) });
  if (reach === "failed") marks.push({ kind: "burst", at: tip, angles: [0, 60, 120].map((d) => d + (h % 60)) });
  else marks.push({ kind: "tip", at: tip, r: waiting ? 2.6 : 1.8 });
  if (waiting) marks.push({ kind: "attention", at: tip, r: 6 });
  // The label's anchor follows the unrounded point, as its side of the vertex does.
  const lr = end + (reach === "pr-ready" ? R.ecal[1] - R.ecal[0] + 6 : waiting ? 13 : 8);
  const [lx, ly] = [lr * Math.cos(angle), lr * Math.sin(angle)];
  const text = issue.slice(issue.indexOf("/") + 1);
  // Labels stay inside the display: one that would run off the edge turns back along its track.
  const width = text.length * 6;
  let anchor: Track["label"]["anchor"] = Math.cos(angle) > 0.25 ? "start" : Math.cos(angle) < -0.25 ? "end" : "middle";
  let x = lx;
  if (anchor === "start" && lx + width > 196) [anchor, x] = ["end", Math.min(lx, 196)];
  if (anchor === "end" && lx - width < -196) [anchor, x] = ["start", Math.max(lx, -196)];
  return {
    issue, reach, waiting,
    working: row.implementer === "working" || row.reviewer === "working",
    tooltip: `${issue} ${row.title}: ${row.stage}`,
    control, end: tip, marks,
    label: { text, at: { x: tenth(x), y: tenth(ly) }, anchor },
  };
}
