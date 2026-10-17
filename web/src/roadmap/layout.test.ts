import { describe, expect, it } from "vitest";
import { layoutRoadmap, type RoadmapNode } from "./layout";

const node = (n: number, lane: string): RoadmapNode => ({
  key: `acme/api#${n}`,
  repo: "acme/api",
  title: `Issue ${n}`,
  url: `https://github.com/acme/api/issues/${n}`,
  lane,
  labels: [],
  assignees: [],
  body: "",
  blocked_by: [],
  blocks: [],
});

const lanes = ["needs-triage", "wontfix", "no label"];
const nodes = [node(1, "no label"), node(2, "needs-triage"), node(3, "needs-triage"), node(4, "wontfix")];

describe("the Roadmap's layout", () => {
  it("sets each lane as a column, left to right in the order given, each issue in its own lane's, stacked", () => {
    const drawn = layoutRoadmap({ lanes, nodes, edges: [] });

    const at = (n: number) => drawn.nodes.find((p) => p.key === `acme/api#${n}`)!;
    expect(drawn.lanes.map((l) => [l.name, l.x, l.y])).toEqual([
      ["needs-triage", 8, 8],
      ["wontfix", 8 + 272 + 48, 8],
      ["no label", 8 + 2 * (272 + 48), 8],
    ]);
    expect([at(2).x, at(3).x, at(4).x, at(1).x]).toEqual([20, 20, 340, 660]);
    expect([at(2).y, at(3).y]).toEqual([32, 32 + 66 + 16]);
    expect(drawn.lanes[0].height).toBe(24 + 2 * 66 + 16 + 12);
    expect(drawn.width).toBe(8 + 3 * 272 + 2 * 48 + 48);
  });

  it("runs a Blocker's arrow from its side facing the other through the gutter between their lanes, out above and in below the middle of a right side, the other way round on a left one", () => {
    const drawn = layoutRoadmap({
      lanes,
      nodes,
      edges: [
        { from: "acme/api#2", to: "acme/api#4", kind: "blocker" },
        { from: "acme/api#4", to: "acme/api#3", kind: "blocker" },
        { from: "acme/api#2", to: "acme/api#3", kind: "blocker" },
      ],
    });

    const [right, left, same] = drawn.arrows.map((a) => a.points);
    // #2 to #4, one lane right on the same row: straight across, in the gutter's first line.
    expect(right).toEqual([
      { x: 268, y: 59 },
      { x: 286, y: 59 },
      { x: 286, y: 59 },
      { x: 340, y: 59 },
    ]);
    // #4 to #3, back left a row down: out below #4's left middle, into below #3's right, on the next line.
    expect(left).toEqual([
      { x: 340, y: 71 },
      { x: 292, y: 71 },
      { x: 292, y: 153 },
      { x: 268, y: 153 },
    ]);
    // #2 to #3, in one lane: out of the right side and back in.
    expect(same).toEqual([
      { x: 268, y: 59 },
      { x: 298, y: 59 },
      { x: 298, y: 153 },
      { x: 268, y: 153 },
    ]);
  });

  it("runs an arrow that skips a lane through a channel above the lanes, which moves them down", () => {
    const drawn = layoutRoadmap({ lanes, nodes, edges: [{ from: "acme/api#1", to: "acme/api#2", kind: "blocker" }] });

    expect(drawn.lanes[0].y).toBe(8 + 2 * 6 + 12);
    // Out of #1's left side, up into the channel, across to the gutter right of #2's lane, down into #2's right.
    expect(drawn.arrows[0].points).toEqual([
      { x: 660, y: 95 },
      { x: 606, y: 95 },
      { x: 606, y: 14 },
      { x: 286, y: 14 },
      { x: 286, y: 95 },
      { x: 268, y: 95 },
    ]);
  });
});
