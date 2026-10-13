import { describe, expect, it } from "vitest";
import { explainer, relationships } from "./layout";
import type { Component, Explainer, Wiki } from "./wiki";

const component = (id: string, rest: Partial<Component> = {}): Component => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  parent: "index",
  overview: "",
  interpretations: [],
  relationships: [],
  gaps: [],
  ...rest,
});

const wiki = (components: Component[]): Wiki => ({ target: { repo: "acme/api" }, commit: "abc1234", builtAt: "", components });

describe("a Component's Relationship diagram", () => {
  // The Web front calls Core, Core reads the Store, and the Store writes the Web front, which is no Relationship of Core's.
  const core = component("core", { relationships: [{ to: "store", kind: "reads", description: "It reads rows." }] });
  const shop = wiki([
    component("index", { parent: null }),
    component("web", { name: "Web front", relationships: [{ to: "core", kind: "calls", description: "It calls the API." }] }),
    core,
    component("store", { relationships: [{ to: "web", kind: "writes", description: "It renders." }] }),
  ]);

  it("draws what uses it left of it and what it uses right of it, each arrow naming its kind, when that fits", () => {
    const drawn = relationships(shop, core, 2000);

    const at = (id: string) => drawn.components.find((c) => c.id === id)!;
    expect(drawn.components.map((c) => [c.id, c.lines, c.here])).toEqual([
      ["core", ["Core"], true],
      ["web", ["Web front"], false],
      ["store", ["Store"], false],
    ]);
    expect(at("web").x + at("web").width).toBeLessThan(at("core").x);
    expect(at("core").x + at("core").width).toBeLessThan(at("store").x);
    expect(drawn.arrows.map((a) => [a.from, a.to, a.label])).toEqual([
      ["core", "store", "reads"],
      ["web", "core", "calls"],
    ]);
    // Each runs from the right side of one to the left side of the other, its kind between them.
    const reads = drawn.arrows[0];
    expect(reads.points[0].x).toBeCloseTo(at("core").x + at("core").width);
    expect(reads.points.at(-1)!.x).toBeCloseTo(at("store").x);
    expect(reads.at.x).toBeGreaterThan(at("core").x + at("core").width);
    expect(reads.at.x).toBeLessThan(at("store").x);
    expect(drawn.width).toBeLessThanOrEqual(2000);
  });

  it("goes top to bottom in a room too narrow for left to right", () => {
    const wide = relationships(shop, core, 2000);

    const drawn = relationships(shop, core, wide.width - 1);

    const at = (id: string) => drawn.components.find((c) => c.id === id)!;
    expect(at("web").y + at("web").height).toBeLessThan(at("core").y);
    expect(at("core").y + at("core").height).toBeLessThan(at("store").y);
    expect(drawn.width).toBeLessThan(wide.width);
  });

  it("is the Component alone, with no arrow, when no Relationship touches it", () => {
    const drawn = relationships(shop, shop.components[0], 2000);

    expect(drawn.components.map((c) => c.id)).toEqual(["index"]);
    expect(drawn.arrows).toEqual([]);
  });

  it("wraps a long name onto a second line, and cuts it short past that", () => {
    const long = component("long", { name: "The component whose name runs on and on past two lines of a box" });
    const drawn = relationships(wiki([long, component("core", { relationships: [{ to: "long", kind: "uses", description: "" }] })]), long, 2000);

    const [here, user] = drawn.components;
    expect(here.lines).toHaveLength(2);
    expect(here.lines[1].endsWith("…")).toBe(true);
    expect(here.height).toBeGreaterThan(user.height);
  });
});

describe("an Explainer's layout", () => {
  const step = (n: number, caption: string, lane?: string) => ({
    n,
    caption,
    anchors: [{ path: "src/lib.rs", start: n, end: n }],
    ...(lane ? { lane } : {}),
  });

  it("draws its steps in their arrows' order, each arrow with its label, when that fits", () => {
    const walk: Explainer = {
      title: "How a request is served",
      steps: [step(1, "The request arrives."), step(2, "It is parsed."), step(3, "It is answered.")],
      arrows: [
        { from: 1, to: 2, label: "then" },
        { from: 2, to: 3 },
      ],
    };

    const drawn = explainer(walk, 2000);

    const [one, two, three] = drawn.steps;
    expect(drawn.steps.map((s) => [s.n, s.lines])).toEqual([
      [1, ["The request arrives."]],
      [2, ["It is parsed."]],
      [3, ["It is answered."]],
    ]);
    expect(one.x + one.width).toBeLessThan(two.x);
    expect(two.x + two.width).toBeLessThan(three.x);
    expect(drawn.arrows.map((a) => [a.from, a.to, a.label])).toEqual([
      ["1", "2", "then"],
      ["2", "3", ""],
    ]);
    expect(drawn.lanes).toEqual([]);

    const narrow = explainer(walk, drawn.width - 1);
    expect(narrow.steps[0].y + narrow.steps[0].height).toBeLessThan(narrow.steps[1].y);
  });

  it("wraps a long caption to at most 4 lines, cut short past them, its box taller for each", () => {
    const long =
      "The request arrives at the router, which reads its path and its method, looks up the handler for both, and hands it the parsed body and its headers before anything else runs.";

    const drawn = explainer({ title: "", steps: [step(1, "Short."), step(2, long)], arrows: [] }, 2000);

    const [short, wrapped] = drawn.steps;
    expect(wrapped.lines).toHaveLength(4);
    expect(wrapped.lines[3].endsWith("…")).toBe(true);
    expect(wrapped.lines.every((l) => l.length <= 34)).toBe(true);
    expect(wrapped.height - short.height).toBe(3 * 18);
  });

  it("frames each lane around its own steps, and no step in another", () => {
    const drawn = explainer(
      {
        title: "",
        steps: [step(1, "Arrives.", "HTTP"), step(2, "Parsed.", "HTTP"), step(3, "Stored.", "Store"), step(4, "Logged.")],
        arrows: [
          { from: 1, to: 2 },
          { from: 2, to: 3 },
          { from: 3, to: 4 },
        ],
      },
      2000,
    );

    expect(drawn.lanes.map((l) => l.name)).toEqual(["HTTP", "Store"]);
    const inside = (l: (typeof drawn.lanes)[number], s: (typeof drawn.steps)[number]) =>
      s.x >= l.x && s.y >= l.y && s.x + s.width <= l.x + l.width && s.y + s.height <= l.y + l.height;
    for (const lane of drawn.lanes) {
      expect(drawn.steps.filter((s) => inside(lane, s)).map((s) => s.n)).toEqual(
        drawn.steps.filter((s) => s.lane === lane.name).map((s) => s.n),
      );
    }
  });
});
