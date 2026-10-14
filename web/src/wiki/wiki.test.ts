import { expect, test } from "vitest";
import { anchorUrl, cited, freshness, gist, libraryId, named, next, outline, progressed, search, seams, trail, unexplored } from "./wiki";

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
  const progress = { at: "2026-09-30T12:00:00Z", calls: 48, made: 17, depth: 7, reached: 2, asked: 15, sent_back: 2, gaps: 3, now: ["acme/api > Core"] };
  expect(progressed(progress)).toEqual(["Call 17 of 48", "depth 2 of 7", "15 parts asked, 2 sent back", "3 Gaps"]);
  expect(progressed({ ...progress, made: 1, reached: 0, asked: 1, sent_back: 0, gaps: 0 })).toEqual(["Call 1 of 48", "depth 0 of 7", "1 part asked, none sent back", "no Gap"]);
  expect(progressed({ ...progress, gaps: 1 })[3]).toBe("1 Gap");
});

/** thoth's tree, as the build wrote it: each Component after its parent, siblings in order. */
const tree = {
  components: [
    { ...component("index", "txpipe-shop/thoth", ""), parent: null },
    { ...component("core", "packages/core", ""), parent: "index" },
    { ...component("contracts", "packages/contracts", ""), parent: "index" },
    { ...component("registry", "attestor_registry", ""), parent: "contracts" },
    { ...component("attestation", "attestation", ""), parent: "contracts" },
    { ...component("zk-tls", "packages/zk-tls", ""), parent: "index" },
  ],
};
const at = (id: string) => tree.components.find((c) => c.id === id)!;

test("a Component's trail is each Component above it, from the top down; the top one has none", () => {
  expect(trail(tree, at("registry")).map((c) => c.name)).toEqual(["txpipe-shop/thoth", "packages/contracts"]);
  expect(trail(tree, at("index"))).toEqual([]);
});

test("the next Component is the tree's next in reading order: its first part, else its next sibling, else its parent's", () => {
  const order = ["index", "core", "contracts", "registry", "attestation", "zk-tls"];
  expect(order.map((id) => next(tree, at(id))?.id ?? null)).toEqual([...order.slice(1), null]);
});

const anchor = (path: string, start = 1, end = 2) => ({ path, start, end });

test("a Component whose every Anchor, its Explainer's too, is in one file cites that file; one citing two, or none, cites no one file", () => {
  const one = { ...component("registry", "attestor_registry", ""), interpretations: [
    { id: 1, kind: "role", text: "", anchors: [anchor("packages/contracts/attestor_registry.compact", 52, 78)] },
    { id: 2, kind: "invariant", text: "", anchors: [anchor("packages/contracts/attestor_registry.compact", 3, 3)] },
  ] };
  expect(cited(one)).toBe("packages/contracts/attestor_registry.compact");
  const step = { n: 1, caption: "", anchors: [anchor("packages/contracts/attestation.compact")] };
  expect(cited({ ...one, explainer: { title: "", steps: [step], arrows: [] } })).toBeNull();
  expect(cited(component("index", "acme/api", ""))).toBeNull();
});

test("a sub-Component's gist is its overview's first sentence, whole, even past a dotted name or an abbreviation", () => {
  expect(gist("@thoth/core is the keyless claim law: the shape, and its hashes. It declares three entry points.")).toBe(
    "@thoth/core is the keyless claim law: the shape, and its hashes.",
  );
  expect(gist("Start at `src/index.ts`, e.g. for the types. Then `src/claim.ts`.")).toBe("Start at `src/index.ts`, e.g. for the types.");
  expect(gist("Serves the API? Yes.\n\nMore.")).toBe("Serves the API?");
  expect(gist("One sentence with no stop")).toBe("One sentence with no stop");
  expect(gist("- a list item first. Then more.")).toBe("a list item first.");
  expect(gist("")).toBe("");
});

test("each cited file is named by its file's name, with as many of its folders as tell it from another of that name", () => {
  const paths = ["packages/zk-tls/src/client/index.ts", "packages/zk-tls/src/index.ts", "packages/zk-tls/src/client/collect.ts", "packages/core/src/index.ts", "README.md"];
  expect(paths.map(named(paths))).toEqual(["client/index.ts", "zk-tls/src/index.ts", "collect.ts", "core/src/index.ts", "README.md"]);
});

const term = (name: string, meaning: string, path = "packages/core/src/claim.ts") => ({ name, meaning, anchors: [anchor(path, 31, 31)] });

test("search finds a Term by its name or meaning, after the Components and before the Interpretations, its text the meaning", () => {
  const claim = { ...component("claim", "@thoth/core/claim", "The claim's header.", ["The header hashes appId first."]), terms: [term("appId", "The **app** a claim is made for."), term("holder", "Who holds the claim.")] };
  const wiki = { components: [component("index", "thoth", "Claims, attested."), claim] };
  expect(search(wiki, "appid").map((h) => [h.component.id, h.term?.name ?? null, h.interpretation?.id ?? null, h.text])).toEqual([
    ["claim", "appId", null, "The app a claim is made for."],
    ["claim", null, 1, "The header hashes appId first."],
  ]);
  expect(search(wiki, "who holds").map((h) => h.term?.name)).toEqual(["holder"]);
});

test("a Component's outline is its name, then its Terms before its Interpretations, then each other section it shows, with how many each holds", () => {
  const claim = { ...component("claim", "@thoth/core/claim", "", ["The header hashes appId first."]), terms: [term("appId", ""), term("holder", "")] };
  expect(outline(claim, true, 2).map((h) => [h.id, h.name, h.count])).toEqual([
    ["component-name", "@thoth/core/claim", null],
    ["head-terms", "Terms", 2],
    ["head-interpretations", "Interpretations", 1],
    ["head-relationships", "Relationships", null],
    ["head-parts", "Components", 2],
  ]);
  // A Wiki built before Components had Terms has none to list.
  expect(outline(component("index", "thoth", ""), false, 0).map((h) => h.name)).toEqual(["thoth"]);
});

test("the files a Component cites count its Terms' Anchors too", () => {
  const one = { ...component("claim", "@thoth/core/claim", ""), terms: [term("appId", "")] };
  expect(cited(one)).toBe("packages/core/src/claim.ts");
  expect(cited({ ...one, terms: [...one.terms, term("Claim", "", "packages/contracts/attestation.compact")] })).toBeNull();
});

test("a Term's name breaks only at its seams: between a word and a capital, and after _ . / or ::", () => {
  expect(seams("InstallationTokenCache")).toEqual(["Installation", "Token", "Cache"]);
  expect(seams("wiki_build_budget_calls")).toEqual(["wiki_", "build_", "budget_", "calls"]);
  expect(seams("@thoth/core::Claim.appId")).toEqual(["@thoth/", "core::", "Claim.", "app", "Id"]);
  expect(seams("header")).toEqual(["header"]);
  expect(seams("URL")).toEqual(["URL"]);
});
