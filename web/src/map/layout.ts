import dagre from "@dagrejs/dagre";
import * as review from "../review";
import type { Assignee, Review, Run } from "../status";

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
  /** Its faux-nico's Run, while one answers it: blocked, it needs you as a faux-nico's Blocked row did. */
  faux_nico: Run | null;
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

/**
 * DESIGN.md's node, in px: room for a title of two lines; one with a line
 * under its Stage is a row taller, and each live agent adds its own row: 28px,
 * or on a phone 52px, 44px at the map's least scale.
 */
export const NODE = { width: 248, height: 108, row: 20, agent: 28, touchAgent: 52 };

export interface Point {
  x: number;
  y: number;
}

/** A box where a drawing puts it: `x`, `y` its top left corner. */
export interface Box extends Point {
  width: number;
  height: number;
}

/** A lane framing its nodes, its name on the frame's top line. */
export type Lane = Box & { name: string };

export type Role = "implementer" | "reviewer";

/** An agent's Agent state as its row says it: herdr's `blocked` is Asking; `unknown` while herdr could not say. */
export type AgentState = "working" | "asking" | "idle" | "done" | "unknown";

/** A live agent of its Dispatch: its role and Agent state. */
export interface AgentRow {
  role: Role;
  state: AgentState;
}

/**
 * A node where the map draws it: `x`, `y` its top left corner, `height` its
 * own; `line` where its review stands while it is PR draft, or why it waits
 * while Waiting; `agents` its live agents; `faded` once its PR merged;
 * `needs` when it needs you: what has no node is a toast (toasts.ts).
 */
export type Placed = MapNode & Point & { height: number; line: string | null; agents: AgentRow[]; faded: boolean; needs: boolean };

export const ROLE: Record<Role, string> = { implementer: "Implementer", reviewer: "Reviewer" };

/** What each Agent state means, in words: its row's tip and accessible name, its panel's header. */
export const SAYS: Record<AgentState, string> = {
  working: "Working",
  asking: "Asking you something",
  idle: "Idle: finished its turn",
  done: "Done",
  unknown: "Not known: herdr could not be read",
};

const STATES: Record<string, AgentState> = { working: "working", blocked: "asking", idle: "idle", done: "done" };

/** Its live agents, the Implementer then the Reviewer: none that herdr no longer lists (`gone`) or that it never had. */
export function agentsOf(n: MapNode): AgentRow[] {
  const a = n.agent_state;
  if (!a) return [];
  const rows: AgentRow[] = [];
  for (const role of ["implementer", "reviewer"] as const) {
    const said = a[role];
    if (said === null || said === "gone") continue;
    // A tick's record of the Asking says it while herdr cannot.
    const asked = role === "implementer" && n.asking !== null;
    rows.push({ role, state: asked ? "asking" : (STATES[said] ?? "unknown") });
  }
  return rows;
}

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
/** Whether it needs you: an Implementer Asking, its faux-nico blocked, a Failed Dispatch, a review given up on or stopped, a Verified PR. */
export const needs = (n: MapNode) =>
  n.asking !== null ||
  !!n.faux_nico?.blocked_since ||
  n.agent_state?.implementer === "blocked" ||
  n.stage === "Failed" ||
  n.stage === "Verified" ||
  review.needsYou(n.review);

/** A row under the Stage for its line, and one per live agent, each `agentRow` tall. */
const heightOf = (n: MapNode, agentRow: number) => NODE.height + (line(n) ? NODE.row : 0) + agentsOf(n).length * agentRow;

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

/** Between two packed groups of nodes, across and down. */
const GAP = 24;

/**
 * Lay out a Project's map: each group of linked issues left to right with dagre,
 * Blockers left, the issues they block right; then the groups packed into rows
 * as wide as `room` (the field, in px), or wider when they would not fit its
 * height, to its shape: the largest first, the unlinked issues wrapping into a grid.
 * Each live agent's row is `agentRow` tall.
 */
export function layout(
  map: MapData,
  room = { width: 1200, height: 800 },
  agentRow = NODE.agent,
): { width: number; height: number; nodes: Placed[]; edges: Drawn[] } {
  // A stack edge comes from the stacked issue; lay it out from the issue whose PR it sits on.
  const ends = (e: MapEdge): [string, string] => (e.kind === "stack" ? [e.to, e.from] : [e.from, e.to]);
  // The groups: issues joined by any edge, each a union under its first key.
  const root = new Map(map.nodes.map((n) => [n.key, n.key]));
  const find = (k: string): string => (root.get(k) === k ? k : find(root.get(k)!));
  // An edge to a key with no node has nowhere to be drawn.
  const edges = map.edges.filter((e) => root.has(e.from) && root.has(e.to));
  for (const e of edges) root.set(find(e.from), find(e.to));
  const groups = new Map<string, MapNode[]>();
  for (const n of map.nodes) groups.set(find(n.key), [...(groups.get(find(n.key)) ?? []), n]);

  const laid = [...groups.values()].map((nodes) => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 48, edgesep: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.key, { width: NODE.width, height: heightOf(n, agentRow) });
    const keys = new Set(nodes.map((n) => n.key));
    for (const e of edges) if (keys.has(e.from)) g.setEdge(...ends(e));
    dagre.layout(g);
    const { width = 0, height = 0 } = g.graph();
    return { nodes, g, width, height, at: { x: 0, y: 0 } };
  });
  // Largest first, so a long chain gets a row and the unlinked issues fill in under it.
  laid.sort((a, b) => b.nodes.length - a.nodes.length);

  const area = laid.reduce((sum, c) => sum + (c.width + GAP) * (c.height + GAP), 0);
  const across = Math.max(room.width, Math.sqrt((area * room.width) / room.height), ...laid.map((c) => c.width));
  let [x, y, row] = [0, 0, 0];
  for (const c of laid) {
    if (x > 0 && x + c.width > across) [x, y, row] = [0, y + row + GAP, 0];
    c.at = { x, y };
    x += c.width + GAP;
    row = Math.max(row, c.height);
  }

  const place = new Map(laid.flatMap((c) => c.nodes.map((n) => [n.key, c] as const)));
  return {
    width: Math.max(0, ...laid.map((c) => c.at.x + c.width)),
    height: Math.max(0, ...laid.map((c) => c.at.y + c.height)),
    nodes: map.nodes.map((n) => {
      const { g, at } = place.get(n.key)!;
      const { x, y } = g.node(n.key);
      return {
        ...n,
        x: at.x + x - NODE.width / 2,
        y: at.y + y - heightOf(n, agentRow) / 2,
        height: heightOf(n, agentRow),
        line: line(n),
        agents: agentsOf(n),
        // serve sends a merged issue for 7 days after its merge, unless the map hides them.
        faded: n.stage === "Merged",
        needs: needs(n),
      };
    }),
    edges: edges.map((e) => {
      const { g, at } = place.get(e.from)!;
      return { ...e, points: (g.edge(...ends(e)).points ?? []).map((p: Point) => ({ x: at.x + p.x, y: at.y + p.y })) };
    }),
  };
}
