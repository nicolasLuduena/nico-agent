import dagre from "@dagrejs/dagre";
import * as review from "../review";
import type { Review } from "../status";

/** What `GET /api/map/<repo>` answers. */
export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface MapNode {
  /** `owner/repo#N` or a Linear id. */
  key: string;
  /** Null for a Blocker outside a Source cache read before Blockers had titles: only its key is known. */
  title: string | null;
  url: string | null;
  kind: "code" | "research";
  /** A Dispatch's Stage, or Ready, Stackable or Waiting without one; null for a Blocker not offered to the loop. */
  stage: string | null;
  agent_state: { implementer: string; reviewer: string | null } | null;
  pr: { url: string; draft: boolean | null } | null;
  review: Review | null;
  verdict: { result: "pass" | "fail"; sha: string; at: string } | null;
  restarts: number;
  created_at: string | null;
  merged_at: string | null;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: "blocker" | "stack";
}

/** DESIGN.md's node, in px; one with a review line is a row taller. */
export const NODE = { width: 248, height: 88, row: 22 };

export interface Point {
  x: number;
  y: number;
}

/**
 * A node where the map draws it: `x`, `y` its top left corner, `height` its
 * own; `line` where its review stands while it is PR draft; `faded` once its
 * PR merged; `needs` when the needs-you strip lists it.
 */
export type Placed = MapNode & Point & { height: number; line: string | null; faded: boolean; needs: boolean };

/** The review's short line under a PR draft node's Stage. */
const line = (n: MapNode) => (n.stage === "PR draft" && n.review ? review.short[n.review.state] : null);
const heightOf = (n: MapNode) => NODE.height + (line(n) ? NODE.row : 0);

/** An edge as drawn: its points run left to right, the arrowhead at the last. */
export type Drawn = MapEdge & { points: Point[] };

/** Lay out a Repo's map left to right with dagre: Blockers left, the issues they block right. */
export function layout(map: MapData): { width: number; height: number; nodes: Placed[]; edges: Drawn[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 48, edgesep: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of map.nodes) g.setNode(n.key, { width: NODE.width, height: heightOf(n) });
  // A stack edge comes from the stacked issue; lay it out from the issue whose PR it sits on.
  const ends = (e: MapEdge): [string, string] => (e.kind === "stack" ? [e.to, e.from] : [e.from, e.to]);
  for (const e of map.edges) g.setEdge(...ends(e));
  dagre.layout(g);
  const { width = 0, height = 0 } = g.graph();
  return {
    width,
    height,
    nodes: map.nodes.map((n) => {
      const { x, y } = g.node(n.key);
      return {
        ...n,
        x: x - NODE.width / 2,
        y: y - heightOf(n) / 2,
        height: heightOf(n),
        line: line(n),
        // serve sends a merged issue for 7 days after its merge.
        faded: n.stage === "Merged",
        needs:
          n.agent_state?.implementer === "blocked" ||
          n.stage === "Failed" ||
          n.stage === "Verified" ||
          review.needsYou(n.review),
      };
    }),
    edges: map.edges.map((e) => ({ ...e, points: g.edge(...ends(e)).points ?? [] })),
  };
}
