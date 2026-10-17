import { expect, test } from "vitest";
import { hash, movedTo, page, reading, route } from "./route";

test("a Project alone is its map, and its Wiki view is the list of its Wikis", () => {
  expect(route("#shop")).toEqual({ project: "shop", view: "map" });
  expect(route("#shop/wiki")).toEqual({ project: "shop", view: "wiki" });
  expect(hash({ project: "shop", view: "wiki" })).toBe("#shop/wiki");
  expect(hash({ project: "acme/api", view: "map" })).toBe("#acme%2Fapi");
  expect(route("#acme%2Fapi/wiki")).toEqual({ project: "acme/api", view: "wiki" });
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
  expect(hash({ project: null, view: "wiki" })).toBe("");
});

test("Libraries is `#/libraries`, which no Project's name can be: a name's own `/` is escaped", () => {
  const libraries = { project: null, view: "libraries" } as const;
  expect(hash(libraries)).toBe("#/libraries");
  expect(route("#/libraries")).toEqual(libraries);
  expect(route("#libraries")).toEqual({ project: "libraries", view: "map" });
  expect(hash({ project: "libraries", view: "map" })).toBe("#libraries");
  // A Project picked while Libraries showed: its map.
  expect(hash({ project: "shop", view: "libraries" })).toBe("#shop");
});

test("a Wiki's page is /wiki/<id>, its Component in the fragment, a Library version's id read as it is written", () => {
  expect(page("txpipe-shop/thoth")).toBe("/wiki/txpipe-shop/thoth");
  expect(page("txpipe-shop/thoth", "packages-contracts")).toBe("/wiki/txpipe-shop/thoth#packages-contracts");
  expect(page("Effect-TS/effect@effect@3.17.0:packages/effect", "index")).toBe("/wiki/Effect-TS/effect@effect@3.17.0:packages/effect#index");
  expect(page("acme/kit@v1 beta#2", "a b")).toBe("/wiki/acme/kit@v1%20beta%232#a%20b");
});

test("a page's URL opens the Wiki its path names at the Component its fragment names, as page wrote them", () => {
  expect(reading("/wiki/txpipe-shop/thoth", "#packages-contracts")).toEqual({ wiki: "txpipe-shop/thoth", component: "packages-contracts" });
  expect(reading("/wiki/txpipe-shop/thoth", "")).toEqual({ wiki: "txpipe-shop/thoth", component: null });
  for (const [id, component] of [
    ["Effect-TS/effect@effect@3.17.0:packages/effect", "index"],
    ["acme/kit@v1 beta#2", "a b"],
  ]) {
    const url = new URL(page(id, component), "http://127.0.0.1:42069");
    expect(reading(url.pathname, url.hash)).toEqual({ wiki: id, component });
  }
  // The browser's own escapes of what page left as written read the same.
  expect(reading("/wiki/Effect-TS/effect%40effect%403.17.0%3Apackages/effect", "")).toEqual({
    wiki: "Effect-TS/effect@effect@3.17.0:packages/effect",
    component: null,
  });
});

test("a URL off a Wiki's page opens none, and a broken escape names a Wiki no one has", () => {
  expect(reading("/", "#shop")).toBeNull();
  expect(reading("/wiki/", "")).toBeNull();
  expect(reading("/wikis/acme/api", "")).toBeNull();
  expect(reading("/wiki/acme/%E0", "#%E0")).toEqual({ wiki: "acme/%E0", component: "%E0" });
});

test("an old link to a Component on the Board moves to the Wiki's page at that Component; the Wiki view alone stays", () => {
  expect(movedTo("#shop/wiki/txpipe-shop%2Fthoth/packages-contracts")).toBe("/wiki/txpipe-shop/thoth#packages-contracts");
  expect(movedTo("#acme%2Fapi/wiki/acme%2Fapi")).toBe("/wiki/acme/api");
  expect(movedTo("#shop/wiki")).toBeNull();
  expect(movedTo("#shop")).toBeNull();
  expect(movedTo("#/libraries")).toBeNull();
  expect(movedTo("#shop/wiki/%E0")).toBeNull();
});
