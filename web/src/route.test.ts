import { expect, test } from "vitest";
import { hash, route } from "./route";

const map = { view: "map", issue: null, agent: null };

test("a Project alone is its map, its `/` escaped", () => {
  expect(route("#shop")).toEqual({ project: "shop", ...map });
  expect(hash({ project: "shop", view: "map" })).toBe("#shop");
  expect(hash({ project: "acme/api", view: "map" })).toBe("#acme%2Fapi");
  expect(route("#acme%2Fapi")).toEqual({ project: "acme/api", ...map });
});

test("a Project's Roadmap is `#<project>/roadmap`", () => {
  expect(route("#shop/roadmap")).toEqual({ project: "shop", ...map, view: "roadmap" });
  expect(hash({ project: "acme/api", view: "roadmap" })).toBe("#acme%2Fapi/roadmap");
  expect(route("#acme%2Fapi/roadmap")).toEqual({ project: "acme/api", ...map, view: "roadmap" });
});

test("an issue's panel is `#<project>/<issue>`, its agent's `#<project>/<issue>/<role>`, the key escaped", () => {
  const issue = { project: "shop", view: "map", issue: "acme/api#7", agent: null } as const;
  expect(hash(issue)).toBe("#shop/acme%2Fapi%237");
  expect(route("#shop/acme%2Fapi%237")).toEqual(issue);
  expect(hash({ ...issue, agent: "reviewer" })).toBe("#shop/acme%2Fapi%237/reviewer");
  expect(route("#shop/acme%2Fapi%237/reviewer")).toEqual({ ...issue, agent: "reviewer" });
  expect(route("#shop/acme%2Fapi%237/faux-nico")).toEqual(issue);
  // An agent without its issue, or on the Roadmap, is no link.
  expect(hash({ project: "shop", view: "map", issue: null, agent: "implementer" })).toBe("#shop");
  expect(hash({ ...issue, view: "roadmap", agent: "implementer" })).toBe("#shop/roadmap");
});

test("an empty hash or a broken escape selects nothing it cannot read", () => {
  const none = { project: null, ...map };
  expect(route("")).toEqual(none);
  expect(route("#")).toEqual(none);
  expect(route("#%E0")).toEqual(none);
  expect(hash({ project: null, view: "roadmap" })).toBe("");
});
