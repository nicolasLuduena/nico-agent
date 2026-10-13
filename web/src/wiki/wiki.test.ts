import { expect, test } from "vitest";
import { anchorUrl, search } from "./wiki";

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
