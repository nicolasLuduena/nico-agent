import { describe, expect, it } from "vitest";
import { layout, type MapEdge, type MapNode } from "./layout";

const node = (key: string, rest: Partial<MapNode> = {}): MapNode => ({
  key,
  title: `Issue ${key}`,
  url: null,
  kind: "code",
  stage: "Ready",
  agent_state: null,
  pr: null,
  verdict: null,
  restarts: 0,
  created_at: null,
  merged_at: null,
  ...rest,
});

const at = (drawn: ReturnType<typeof layout>, key: string) => drawn.nodes.find((n) => n.key === key)!;

describe("the map's layout", () => {
  it("draws a Blocker chain of three left to right, with two blocker edges from each Blocker to the issue it blocks", () => {
    const edges: MapEdge[] = [
      { from: "acme/api#1", to: "acme/api#2", kind: "blocker" },
      { from: "acme/api#2", to: "acme/api#3", kind: "blocker" },
    ];

    const drawn = layout({ nodes: [node("acme/api#3"), node("acme/api#1"), node("acme/api#2")], edges });

    const [one, two, three] = ["acme/api#1", "acme/api#2", "acme/api#3"].map((k) => at(drawn, k));
    expect(drawn.nodes).toHaveLength(3);
    expect(one.x + 248).toBeLessThan(two.x);
    expect(two.x + 248).toBeLessThan(three.x);
    expect(drawn.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["acme/api#1", "acme/api#2", "blocker"],
      ["acme/api#2", "acme/api#3", "blocker"],
    ]);
    // Each runs from its Blocker's right side to the blocked issue's left side.
    const first = drawn.edges[0].points;
    expect(first[0].x).toBeCloseTo(one.x + 248);
    expect(first.at(-1)!.x).toBeCloseTo(two.x);
  });

  it("draws a Stacked dispatch right of the issue whose PR it sits on, its stack edge running from that PR to it", () => {
    // serve sends a stack edge from the stacked issue to the issue its PR sits on.
    const drawn = layout({
      nodes: [node("acme/api#4", { stage: "PR draft" }), node("acme/api#5", { stage: "Implementing" })],
      edges: [{ from: "acme/api#5", to: "acme/api#4", kind: "stack" }],
    });

    const [below, stacked] = [at(drawn, "acme/api#4"), at(drawn, "acme/api#5")];
    expect(below.x + 248).toBeLessThan(stacked.x);
    expect(drawn.edges).toHaveLength(1);
    expect(drawn.edges[0]).toMatchObject({ from: "acme/api#5", to: "acme/api#4", kind: "stack" });
    const points = drawn.edges[0].points;
    expect(points[0].x).toBeCloseTo(below.x + 248);
    expect(points.at(-1)!.x).toBeCloseTo(stacked.x);
  });

  it("fades an issue whose PR merged, which serve sends for the last 7 days, and nothing else", () => {
    const drawn = layout({
      nodes: [
        node("acme/api#8", { stage: "Merged", merged_at: "2026-09-28T10:00:00Z" }),
        node("acme/api#9", { stage: "Verified" }),
        node("acme/api#10", { stage: "Closed" }),
      ],
      edges: [],
    });

    expect(drawn.nodes.map((n) => [n.key, n.faded])).toEqual([
      ["acme/api#8", true],
      ["acme/api#9", false],
      ["acme/api#10", false],
    ]);
  });

  it("flags what needs you, as the strip lists it: an Implementer Asking, a Failed Dispatch, a Verified PR", () => {
    const drawn = layout({
      nodes: [
        node("acme/api#11", { stage: "Implementing", agent_state: { implementer: "blocked", reviewer: null } }),
        node("acme/api#12", { stage: "Failed" }),
        node("acme/api#13", { stage: "Verified" }),
        node("acme/api#14", { stage: "PR draft", agent_state: { implementer: "idle", reviewer: "working" } }),
        node("acme/api#15", { stage: "Waiting" }),
      ],
      edges: [],
    });

    expect(drawn.nodes.filter((n) => n.needs).map((n) => n.key)).toEqual(["acme/api#11", "acme/api#12", "acme/api#13"]);
  });
});
