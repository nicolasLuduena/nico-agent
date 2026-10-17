import { describe, expect, it } from "vitest";
import type { Review } from "../status";
import { layout, withoutMerged, type MapEdge, type MapNode } from "./layout";

const node = (key: string, rest: Partial<MapNode> = {}): MapNode => ({
  key,
  repo: null,
  title: `Issue ${key}`,
  url: null,
  kind: "code",
  assignees: null,
  stage: "Ready",
  agent_state: null,
  asking: null,
  faux_nico: null,
  pr: null,
  review: null,
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

  it("hides the merged issues and every edge to or from one, and nothing else", () => {
    const map = {
      nodes: [node("acme/api#8", { stage: "Merged" }), node("acme/api#9", { stage: "Verified" }), node("acme/api#10")],
      edges: [
        { from: "acme/api#8", to: "acme/api#10", kind: "blocker" },
        { from: "acme/api#9", to: "acme/api#8", kind: "stack" },
        { from: "acme/api#9", to: "acme/api#10", kind: "blocker" },
      ] satisfies MapEdge[],
    };

    const shown = withoutMerged(map);

    expect(shown.nodes.map((n) => n.key)).toEqual(["acme/api#9", "acme/api#10"]);
    expect(shown.edges).toEqual([{ from: "acme/api#9", to: "acme/api#10", kind: "blocker" }]);
  });

  it("flags what needs you: an Implementer Asking (as herdr says it, or as a tick recorded it), a blocked faux-nico, a Failed Dispatch, a Verified PR", () => {
    const drawn = layout({
      nodes: [
        node("acme/api#11", { stage: "Implementing", agent_state: { implementer: "blocked", reviewer: null } }),
        node("acme/api#10", { stage: "Implementing", agent_state: { implementer: "unknown", reviewer: null }, asking: { since: "2026-09-30T04:12:00Z", question: "Keep it?" } }),
        node("acme/api#12", { stage: "Failed" }),
        node("acme/api#13", { stage: "Verified" }),
        node("acme/api#9", { stage: "Implementing", faux_nico: { agent: "faux-nico-api-9", blocked_since: "2026-09-30T04:20:00Z" } }),
        node("acme/api#8", { stage: "Implementing", faux_nico: { agent: "faux-nico-api-8" } }),
        node("acme/api#14", { stage: "PR draft", agent_state: { implementer: "idle", reviewer: "working" } }),
        node("acme/api#15", { stage: "Waiting" }),
      ],
      edges: [],
    });

    expect(drawn.nodes.filter((n) => n.needs).map((n) => n.key)).toEqual(["acme/api#11", "acme/api#10", "acme/api#12", "acme/api#13", "acme/api#9"]);
  });

  it("gives a PR draft node a row under its Stage saying where its review stands, and flags one that stopped or gave up", () => {
    const review = (state: Review["state"]): Review => ({ state, sha: "4f2a9c1e0b", harness: "codex", attempts: 0, cap: 2 });
    const drawn = layout({
      nodes: [
        node("acme/api#16", { stage: "PR draft", review: review("reviewing") }),
        node("acme/api#17", { stage: "PR draft", review: review("off") }),
        node("acme/api#18", { stage: "PR draft", review: review("gave_up") }),
        node("acme/api#19", { stage: "PR draft", review: review("stopped") }),
        node("acme/api#20", { stage: "PR draft", review: review("retrying") }),
        node("acme/api#21", { stage: "PR draft", review: review("waiting") }),
        node("acme/api#22", { stage: "PR draft", review: review("failed") }),
        node("acme/api#23", { stage: "Verified", review: review("passed") }),
        node("acme/api#24", { stage: "Implementing" }),
      ],
      edges: [],
    });

    expect(drawn.nodes.map((n) => [n.key, n.line, n.height, n.needs])).toEqual([
      ["acme/api#16", "reviewing", 128, false],
      ["acme/api#17", "review off", 128, false],
      ["acme/api#18", "review gave up", 128, true],
      ["acme/api#19", "review stopped", 128, true],
      ["acme/api#20", "review retrying", 128, false],
      ["acme/api#21", "waiting for review", 128, false],
      ["acme/api#22", "verdict fail", 128, false],
      ["acme/api#23", null, 108, true],
      ["acme/api#24", null, 108, false],
    ]);
  });

  it("gives a Waiting node a row under its Stage saying what it waits on, without its own key", () => {
    const drawn = layout({
      nodes: [
        node("acme/api#3", { stage: "Waiting", waits: "acme/api#3 waits on acme/web#1 to be installed in acme/web" }),
        node("acme/api#4", { stage: "Waiting", waits: "acme/api#4's PR https://github.com/acme/api/pull/9 was closed unmerged" }),
        node("acme/api#5", { stage: "Waiting" }),
      ],
      edges: [],
    });

    expect(drawn.nodes.map((n) => [n.key, n.line, n.height])).toEqual([
      ["acme/api#3", "waits on acme/web#1 to be installed in acme/web", 128],
      ["acme/api#4", "acme/api#4's PR https://github.com/acme/api/pull/9 was closed unmerged", 128],
      ["acme/api#5", null, 108],
    ]);
  });

  it("says on a Waiting node's row who it is assigned to, when that is what keeps it from Ready", () => {
    const you = { name: "nico", you: true };
    const colleague = { name: "colleague", you: false };
    const held = { stage: "Waiting", assignee_holds: true } as const;
    const drawn = layout({
      nodes: [
        node("acme/api#6", { ...held, assignees: [colleague], waits: "acme/api#6 is assigned to colleague" }),
        node("acme/api#7", { ...held, assignees: [you, colleague, { name: "ada", you: false }], waits: "acme/api#7 is assigned to colleague, ada" }),
        node("acme/api#8", { ...held, assignees: [], waits: "acme/api#8 is not assigned to you, and acme/api takes only issues assigned to you" }),
        node("acme/api#9", { stage: "Ready", assignees: [you] }),
      ],
      edges: [],
    });

    expect(drawn.nodes.map((n) => [n.key, n.line, n.height])).toEqual([
      ["acme/api#6", "assigned to @colleague", 128],
      ["acme/api#7", "assigned to @colleague, @ada", 128],
      ["acme/api#8", "unassigned", 128],
      ["acme/api#9", null, 108],
    ]);
  });
});
