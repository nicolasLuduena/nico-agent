import dagre from "@dagrejs/dagre";
import { NODE, type Point } from "../map/layout";
import type { Component, Explainer, Relationship, Step, Wiki } from "./wiki";

/** A box where a drawing puts it: `x`, `y` its top left corner. */
export interface Box extends Point {
  width: number;
  height: number;
}

/** An arrow as drawn: its points, the arrowhead at the last, and its label centred `at`. */
export interface DrawnArrow {
  from: string;
  to: string;
  label: string;
  points: Point[];
  at: Point;
}

/** A lane framing its steps, its name on the frame's top line. */
export type Lane = Box & { name: string };

/** A line of 14px text, in px. */
export const LINE = 18;
// shortcut: lines are cut by count, not measured, at about 7px a character (Barlow at 14px); measure them if wide names overrun.
/** A Component in its Relationship diagram, a name and nothing else. */
const COMPONENT = { width: 200, chars: 22, lines: 2, pad: 12 };
/** A step: its number on the first row as a map node's, then its caption. */
const STEP = { width: NODE.width, chars: 34, lines: 4, top: 36, bottom: 16 };

/** `text` in lines of at most `chars`, broken between words where it can; past `most` lines, cut short with "…". */
function wrap(text: string, chars: number, most: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= chars) lines[lines.length - 1] = `${last} ${word}`;
    else for (let i = 0; i < word.length; i += chars) lines.push(word.slice(i, i + chars));
  }
  if (lines.length <= most) return lines;
  const cut = lines.slice(0, most);
  cut[most - 1] = `${cut[most - 1].slice(0, chars - 1).trimEnd()}…`;
  return cut;
}

type Sized = { id: string; width: number; height: number; lane?: string };
type Joining = { from: string; to: string; label: string };

/**
 * Lay out `boxes` and the arrows between them with dagre, as the map is: left
 * to right while that fits in `room` px, top to bottom otherwise; a box with a
 * lane inside that lane's frame.
 */
function layout<B extends Sized, A extends Joining>(boxes: B[], arrows: A[], room: number) {
  const towards = (rankdir: "LR" | "TB") => {
    const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
    // The margin leaves room above the top lane for its name.
    g.setGraph({ rankdir, nodesep: 16, ranksep: 48, edgesep: 8, marginx: 8, marginy: 8 });
    for (const b of boxes) g.setNode(b.id, { width: b.width, height: b.height });
    const lanes = [...new Set(boxes.flatMap((b) => (b.lane ? [b.lane] : [])))];
    for (const lane of lanes) g.setNode(`lane:${lane}`, {});
    for (const b of boxes) if (b.lane) g.setParent(b.id, `lane:${b.lane}`);
    // shortcut: a label's width is guessed from its length, with room for its arrow either side; measure it if labels overrun.
    arrows.forEach((a, i) =>
      g.setEdge(a.from, a.to, { width: a.label ? a.label.length * 10 + 32 : 0, height: a.label ? LINE : 0, labelpos: "c" }, String(i)),
    );
    dagre.layout(g);
    const corner = (id: string) => {
      const { x, y, width, height } = g.node(id);
      return { x: x - width / 2, y: y - height / 2, width, height };
    };
    const { width = 0, height = 0 } = g.graph();
    return {
      width,
      height,
      boxes: boxes.map((b) => ({ ...b, ...corner(b.id) })),
      arrows: arrows.map((a, i) => {
        const { points = [], x = 0, y = 0 } = g.edge(a.from, a.to, String(i));
        return { ...a, points, at: { x, y } };
      }),
      lanes: lanes.map((name) => ({ name, ...corner(`lane:${name}`) })),
    };
  };
  const across = towards("LR");
  return across.width <= room ? across : towards("TB");
}

/** A Component as its Relationship diagram draws it: `here` the one whose page it is. */
export type Related = Box & { id: string; lines: string[]; here: boolean };

/** A Relationship as its diagram draws it, labelled with its kind. */
export type RelationshipArrow = DrawnArrow & Pick<Relationship, "kind" | "description">;

/**
 * `component`'s Relationship diagram in `room` px: it, what it uses, calls,
 * reads or writes, and what does so to it, each arrow labelled with its kind.
 */
export function layoutRelationships(
  wiki: Wiki,
  component: Component,
  room: number,
): { width: number; height: number; components: Related[]; arrows: RelationshipArrow[] } {
  const arrows = [
    ...component.relationships.map((r) => ({ from: component.id, ...r })),
    ...wiki.components
      .filter((c) => c.id !== component.id)
      .flatMap((c) => c.relationships.filter((r) => r.to === component.id).map((r) => ({ from: c.id, ...r }))),
  ].map((r) => ({ ...r, label: r.kind }));
  const touched = new Set(arrows.flatMap((a) => [a.from, a.to]));
  const shown = [component, ...wiki.components.filter((c) => c.id !== component.id && touched.has(c.id))];
  const boxes = shown.map((c) => {
    const lines = wrap(c.name, COMPONENT.chars, COMPONENT.lines);
    return { id: c.id, lines, here: c.id === component.id, width: COMPONENT.width, height: 2 * COMPONENT.pad + lines.length * LINE };
  });
  const drawn = layout(boxes, arrows, room);
  return { width: drawn.width, height: drawn.height, components: drawn.boxes, arrows: drawn.arrows };
}

/** A step as its Explainer draws it, its caption in `lines`. */
export type PlacedStep = Step & Box & { id: string; lines: string[] };

/** `explainer`'s steps, arrows and lanes in `room` px. */
export function layoutExplainer(
  explainer: Explainer,
  room: number,
): { width: number; height: number; steps: PlacedStep[]; arrows: DrawnArrow[]; lanes: Lane[] } {
  const boxes = explainer.steps.map((s) => {
    const lines = wrap(s.caption, STEP.chars, STEP.lines);
    return { ...s, id: String(s.n), lines, width: STEP.width, height: STEP.top + lines.length * LINE + STEP.bottom };
  });
  const arrows = explainer.arrows.map((a) => ({ from: String(a.from), to: String(a.to), label: wrap(a.label ?? "", 24, 1)[0] ?? "" }));
  const drawn = layout(boxes, arrows, room);
  return { width: drawn.width, height: drawn.height, steps: drawn.boxes, arrows: drawn.arrows, lanes: drawn.lanes };
}
