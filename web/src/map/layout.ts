import dagre from "@dagrejs/dagre";
import * as review from "../review";
import type { Assignee, Review } from "../status";

/** What `GET /api/map/<project>` answers. */
export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface MapNode {
  /** `owner/repo#N` or a Linear id. */
  key: string;
  /** The Repo of the Project it is in; null for a Blocker outside the Project. */
  repo: string | null;
  /** Null for a Blocker outside a Source cache read before Blockers had titles: only its key is known. */
  title: string | null;
  url: string | null;
  kind: "code" | "research";
  /** Who it is assigned to, as its Source was last read; null when no read holds it, as a Blocker outside them. */
  assignees: Assignee[] | null;
  /** A Dispatch's Stage, or Ready, Stackable or Waiting without one; null for a Blocker not offered to the loop. */
  stage: string | null;
  agent_state: { implementer: string; reviewer: string | null } | null;
  /** While its Implementer waits on the user, as a tick recorded it; herdr's `blocked` says it sooner. */
  asking: { since: string; question: string } | null;
  pr: { url: string; draft: boolean | null } | null;
  review: Review | null;
  verdict: { result: "pass" | "fail"; sha: string; at: string } | null;
  restarts: number;
  created_at: string | null;
  merged_at: string | null;
  /** Why a Waiting node waits, as `status` says it, or as a hand Dispatch is refused. */
  waits?: string;
  /** Whether who it is assigned to is what keeps it from Ready: someone else, or no one in a Repo with `mine` on. */
  assignee_holds?: true;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: "blocker" | "stack";
}

/** DESIGN.md's node, in px; one with a line under its Stage is a row taller. */
export const NODE = { width: 248, height: 88, row: 22 };

export interface Point {
  x: number;
  y: number;
}

/**
 * A node where the map draws it: `x`, `y` its top left corner, `height` its
 * own; `line` where its review stands while it is PR draft, or why it waits
 * while Waiting; `faded` once its PR merged; `needs` when it needs you
 * (strip.ts).
 */
export type Placed = MapNode & Point & { height: number; line: string | null; faded: boolean; needs: boolean };

/** The short line under a node's Stage: its review's while PR draft, why it waits while Waiting, less its own key, or who has it. */
function line(n: MapNode) {
  if (n.stage === "PR draft" && n.review) return review.short[n.review.state];
  if (n.stage === "Waiting" && n.assignee_holds) {
    const others = (n.assignees ?? []).filter((a) => !a.you);
    return others.length ? `assigned to ${others.map((a) => `@${a.name}`).join(", ")}` : "unassigned";
  }
  if (n.stage === "Waiting" && n.waits) return n.waits.startsWith(`${n.key} `) ? n.waits.slice(n.key.length + 1) : n.waits;
  return null;
}
const heightOf = (n: MapNode) => NODE.height + (line(n) ? NODE.row : 0);

/** An edge as drawn: its points run left to right, the arrowhead at the last. */
export type Drawn = MapEdge & { points: Point[] };

/** The map without its merged issues and the edges to or from them: "Hide merged". */
export function withoutMerged(map: MapData): MapData {
  const merged = new Set(map.nodes.filter((n) => n.stage === "Merged").map((n) => n.key));
  return {
    nodes: map.nodes.filter((n) => !merged.has(n.key)),
    edges: map.edges.filter((e) => !merged.has(e.from) && !merged.has(e.to)),
  };
}

/** Lay out a Project's map left to right with dagre: Blockers left, the issues they block right. */
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
        // serve sends a merged issue for 7 days after its merge, unless the map hides them.
        faded: n.stage === "Merged",
        needs:
          n.asking !== null ||
          n.agent_state?.implementer === "blocked" ||
          n.stage === "Failed" ||
          n.stage === "Verified" ||
          review.needsYou(n.review),
      };
    }),
    edges: map.edges.map((e) => ({ ...e, points: g.edge(...ends(e)).points ?? [] })),
  };
}
