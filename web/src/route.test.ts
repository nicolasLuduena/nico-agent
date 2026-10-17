import { expect, test } from "vitest";
import { hash, route } from "./route";

test("a Project alone is its map, its `/` escaped", () => {
  expect(route("#shop")).toEqual({ project: "shop", view: "map" });
  expect(hash({ project: "shop", view: "map" })).toBe("#shop");
  expect(hash({ project: "acme/api", view: "map" })).toBe("#acme%2Fapi");
  expect(route("#acme%2Fapi")).toEqual({ project: "acme/api", view: "map" });
});

test("a Project's Roadmap is `#<project>/roadmap`", () => {
  expect(route("#shop/roadmap")).toEqual({ project: "shop", view: "roadmap" });
  expect(hash({ project: "acme/api", view: "roadmap" })).toBe("#acme%2Fapi/roadmap");
  expect(route("#acme%2Fapi/roadmap")).toEqual({ project: "acme/api", view: "roadmap" });
});

test("an empty hash, an unknown view or a broken escape selects nothing it cannot read", () => {
  const none = { project: null, view: "map" };
  expect(route("")).toEqual(none);
  expect(route("#")).toEqual(none);
  expect(route("#%E0")).toEqual(none);
  expect(route("#shop/elsewhere/x")).toEqual({ project: "shop", view: "map" });
  expect(hash({ project: null, view: "roadmap" })).toBe("");
});
