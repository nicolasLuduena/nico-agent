import { expect, test } from "vitest";
import { anchorUrl, freshness, libraryId, progressed, search, unexplored } from "./wiki";

test("an Anchor opens GitHub at the Wiki's commit, at its lines, its path escaped", () => {
  const wiki = { target: { repo: "acme/api" }, commit: "abc1234" };
  expect(anchorUrl(wiki, { path: "src/lib.rs", start: 1, end: 2 })).toBe("https://github.com/acme/api/blob/abc1234/src/lib.rs#L1-L2");
  expect(anchorUrl(wiki, { path: "docs/a b#c.md", start: 3, end: 3 })).toBe("https://github.com/acme/api/blob/abc1234/docs/a%20b%23c.md#L3-L3");
});

const component = (id: string, name: string, overview: string, interpretations: string[] = []) => ({
  id,
  name,
  parent: null,
  overview,
  interpretations: interpretations.map((text, n) => ({ id: n + 1, kind: "role", text, anchors: [] })),
  gaps: [],
  relationships: [],
});

test("search finds every word, case aside, in a Component's name or overview, then in its Interpretations", () => {
  const wiki = {
    components: [
      component("index", "acme/api", "Serves the API.", ["Reads the Config once at start."]),
      component("config", "Config", "Parses config.toml.", ["Keeps comments when it edits a file.", "Refuses an unknown key."]),
    ],
  };
  expect(search(wiki, "  CONFIG ").map((h) => [h.component.id, h.interpretation?.id ?? null])).toEqual([
    ["config", null],
    ["index", 1],
  ]);
  expect(search(wiki, "comments edits").map((h) => [h.component.id, h.interpretation?.id, h.text])).toEqual([
    ["config", 1, "Keeps comments when it edits a file."],
  ]);
});

test("an empty query finds nothing, and so does a word nowhere", () => {
  const wiki = { components: [component("index", "acme/api", "Serves the API.", ["Reads the Config."])] };
  expect(search(wiki, " ")).toEqual([]);
  expect(search(wiki, "api nowhere")).toEqual([]);
});

test("search reads the text as the page shows it: a link's address and the Markdown marks are not words", () => {
  const wiki = { components: [component("index", "acme/api", "Serves **the API**.", ["Follows [the RFC](https://example.com/rfc) and `serde`."])] };
  expect(search(wiki, "example")).toEqual([]);
  expect(search(wiki, "rfc serde").map((h) => h.text)).toEqual(["Follows the RFC and serde."]);
  expect(search(wiki, "the api").map((h) => h.text)).toEqual(["Serves the API."]);
});

test("freshness says how far behind its Base a Wiki is, and how many Interpretations are Stale when any are", () => {
  expect(freshness({ base: "main", behind: 0, stale: 0 })).toBe("Up to date with main");
  expect(freshness({ base: "main", behind: 1, stale: 1 })).toBe("1 commit behind main · 1 Interpretation Stale");
  expect(freshness({ base: "dev", behind: 3, stale: 0 })).toBe("3 commits behind dev");
  expect(freshness({ base: "main", behind: 12, stale: 4 })).toBe("12 commits behind main · 4 Interpretations Stale");
});

test("what Continue asks about counts the parts the budget left unexplored", () => {
  expect(unexplored(1)).toBe("1 part not explored (budget)");
  expect(unexplored(6)).toBe("6 parts not explored (budget)");
});

test("a Library version's Wiki is named by its slug and tag, then its subfolder when it has one", () => {
  expect(libraryId({ repo: "Effect-TS/effect", tag: "effect@3.17.0", path: "packages/effect" })).toBe("Effect-TS/effect@effect@3.17.0:packages/effect");
  expect(libraryId({ repo: "acme/kit", tag: "v1" })).toBe("acme/kit@v1");
});

test("a build's progress counts its calls and depth against its budget, then its parts, those sent back and its Gaps", () => {
  const progress = { at: "2026-09-30T12:00:00Z", calls: 48, made: 17, depth: 7, reached: 2, asked: 15, sent_back: 2, gaps: 3, asking: "acme/api > Core" };
  expect(progressed(progress)).toEqual(["Call 17 of 48", "depth 2 of 7", "15 parts asked, 2 sent back", "3 Gaps"]);
  expect(progressed({ ...progress, made: 1, reached: 0, asked: 1, sent_back: 0, gaps: 0 })).toEqual(["Call 1 of 48", "depth 0 of 7", "1 part asked, none sent back", "no Gap"]);
  expect(progressed({ ...progress, gaps: 1 })[3]).toBe("1 Gap");
});
