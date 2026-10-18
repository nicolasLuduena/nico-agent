import { type Lane, NODE, type Point } from "../map/layout";
import type { Assignee } from "../status";

/** An issue a Roadmap node links to, on the Roadmap or off it. */
export interface Link {
  key: string;
  /** Null for a Blocker whose title no read holds. */
  title: string | null;
  /** Null for a Linear issue no read holds. */
  url: string | null;
}

export interface RoadmapNode {
  /** `owner/repo#N` or a Linear id. */
  key: string;
  repo: string;
  title: string;
  url: string;
  /** The first of the lanes its labels match: a label, or `no label`. */
  lane: string;
  labels: string[];
  assignees: Assignee[];
  /** Its description, in Markdown. */
  body: string;
  blocked_by: Link[];
  blocks: Link[];
}

/** What `GET /api/roadmap/<project>` answers. */
export interface RoadmapData {
  /** The lanes that hold an issue, left to right. */
  lanes: string[];
  nodes: RoadmapNode[];
  edges: { from: string; to: string; kind: "blocker" }[];
}

/** A Roadmap node: the map's, its title and number rows without the Stage's. */
export const CARD = { width: NODE.width, height: NODE.height - NODE.row };
/** Inside a lane's frame; above its first node, room for its name on the frame's top line. */
const PAD = 12;
const TOP = 24;
/** Between nodes in a lane, and between lanes, as the map's dagre spaces its ranks. */
const GAP = 16;
const BETWEEN = 48;
const MARGIN = 8;
/** Between arrows sharing a gutter or the channel above the lanes. */
const SLOT = 6;
/**
 * How far from a node's middle an arrow meets its side: on the right, out
 * above and in below; on the left, in above and out below. One going out and
 * one coming in never share a line, and one between two nodes on a row runs straight.
 */
const PORT = 6;

export type PlacedIssue = RoadmapNode & Point;
export type Arrow = { from: string; to: string; points: Point[] };

/**
 * Each lane a column, left to right in `data`'s order, its issues stacked in
 * it. Each Blocker's arrow leaves its node's side facing the issue it blocks
 * into the gutter beside its lane, and enters the other's from the gutter
 * beside that lane; one that skips a lane runs between the two gutters in a
 * channel above the lanes, its own line there, so no arrow runs behind a node.
 */
// shortcut: lanes are columns, not dagre's ranks, which go by edges: unconnected issues would share one rank, so no lane holds a column.
export function layoutRoadmap(data: RoadmapData): { width: number; height: number; nodes: PlacedIssue[]; arrows: Arrow[]; lanes: Lane[] } {
  const laneWidth = CARD.width + 2 * PAD;
  const laneX = (i: number) => MARGIN + i * (laneWidth + BETWEEN);
  const column = new Map(data.nodes.map((n) => [n.key, data.lanes.indexOf(n.lane)]));
  const edges = data.edges.filter((e) => column.has(e.from) && column.has(e.to));
  const far = edges.filter((e) => Math.abs(column.get(e.to)! - column.get(e.from)!) > 1);
  // The channel, when there is one, clear of the lanes' names.
  const top = MARGIN + (far.length ? (far.length + 1) * SLOT + TOP / 2 : 0);
  const lanes: Lane[] = data.lanes.map((name, i) => {
    const held = data.nodes.filter((n) => n.lane === name).length;
    return { name, x: laneX(i), y: top, width: laneWidth, height: TOP + held * (CARD.height + GAP) - GAP + PAD };
  });
  const nodes: PlacedIssue[] = data.lanes.flatMap((name, i) =>
    data.nodes.filter((n) => n.lane === name).map((n, j) => ({ ...n, x: laneX(i) + PAD, y: top + TOP + j * (CARD.height + GAP) })),
  );
  const at = new Map(nodes.map((n) => [n.key, n]));
  const arrows: Arrow[] = edges.map(({ from, to }, k) => {
    const [a, b] = [at.get(from)!, at.get(to)!];
    const [ca, cb] = [column.get(from)!, column.get(to)!];
    // Each arrow its own line in a gutter, while a gutter holds no more than seven: the first
    // down its middle, the next either side of it, so a lone one never hugs a lane's frame.
    const i = k % 7;
    const slot = (i % 2 ? (i + 1) / 2 : -i / 2) * SLOT;
    const left = (c: number) => laneX(c) - BETWEEN / 2 + slot;
    const right = (c: number) => laneX(c) + laneWidth + BETWEEN / 2 + slot;
    const out = cb < ca ? { x: a.x, y: a.y + CARD.height / 2 + PORT } : { x: a.x + CARD.width, y: a.y + CARD.height / 2 - PORT };
    const into = cb > ca ? { x: b.x, y: b.y + CARD.height / 2 - PORT } : { x: b.x + CARD.width, y: b.y + CARD.height / 2 + PORT };
    const [leaves, enters] = [cb < ca ? left(ca) : right(ca), cb > ca ? left(cb) : right(cb)];
    const over = MARGIN + (far.indexOf(edges[k]) + 1) * SLOT;
    const between =
      leaves === enters
        ? [{ x: leaves, y: out.y }, { x: leaves, y: into.y }]
        : [{ x: leaves, y: out.y }, { x: leaves, y: over }, { x: enters, y: over }, { x: enters, y: into.y }];
    return { from, to, points: [out, ...between, into] };
  });
  // Room right of the last lane for its gutter.
  const width = lanes.length ? laneX(lanes.length - 1) + laneWidth + BETWEEN : 0;
  const height = Math.max(0, ...lanes.map((l) => l.y + l.height)) + MARGIN;
  return { width, height, nodes, arrows, lanes };
}
