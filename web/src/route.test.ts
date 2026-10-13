import { expect, test } from "vitest";
import { hash, route } from "./route";

test("a Component of a Wiki is its Project, the Wiki view, the Wiki and the Component, each escaped", () => {
  const at = { project: "acme/api", view: "wiki", wiki: "acme/api", component: "core/config" } as const;
  expect(hash(at)).toBe("#acme%2Fapi/wiki/acme%2Fapi/core%2Fconfig");
  expect(route("#acme%2Fapi/wiki/acme%2Fapi/core%2Fconfig")).toEqual(at);
});

test("a Project alone is its map, and the Wiki view may name no Wiki or no Component yet", () => {
  expect(route("#shop")).toEqual({ project: "shop", view: "map", wiki: null, component: null });
  expect(route("#shop/wiki")).toEqual({ project: "shop", view: "wiki", wiki: null, component: null });
  expect(route("#shop/wiki/acme%2Fapi")).toEqual({ project: "shop", view: "wiki", wiki: "acme/api", component: null });
  expect(hash({ project: "shop", view: "wiki", wiki: null, component: null })).toBe("#shop/wiki");
});

test("the map's hash carries no Wiki, and no Project is no hash", () => {
  expect(hash({ project: "shop", view: "map", wiki: "acme/api", component: "core" })).toBe("#shop");
  expect(hash({ project: null, view: "wiki", wiki: "acme/api", component: null })).toBe("");
});

test("an empty hash, an unknown view or a broken escape selects nothing it cannot read", () => {
  const none = { project: null, view: "map", wiki: null, component: null };
  expect(route("")).toEqual(none);
  expect(route("#")).toEqual(none);
  expect(route("#%E0")).toEqual(none);
  expect(route("#shop/elsewhere/x")).toEqual({ project: "shop", view: "map", wiki: null, component: null });
});
