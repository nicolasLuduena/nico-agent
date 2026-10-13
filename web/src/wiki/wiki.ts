import { firstText, spans } from "../markdown";
import type { WikiState } from "../status";

/** A GitHub repository at a tag, its Wiki covering only the subfolder `path`, when set. */
export interface Library {
  /** owner/name. */
  repo: string;
  tag: string;
  path?: string;
}

/** The id of a Library version's Wiki, as `/api/wikis` lists it. */
export const libraryId = (l: Library) => `${l.repo}@${l.tag}${l.path ? `:${l.path}` : ""}`;

/** Where the builds of the Wiki `id` stand, in a line. */
export function standing(wikis: WikiState[], id: string): string {
  const w = wikis.find((w) => w.wiki === id);
  if (!w) return "Wiki not built yet";
  if (w.state === "failed") return `Wiki failed: ${w.why}`;
  return w.state === "built" ? `Wiki built at ${w.commit?.slice(0, 7)}` : `Wiki ${w.state}`;
}

/** A Wiki as `GET /api/wikis` lists it, or one not built yet while its build waits, runs or failed. */
export interface Listed {
  id: string;
  /** A Library version's names its tag; a Repo's has none. */
  target: { repo: string; tag?: string };
  /** The commit it describes; null till its first build ends built. */
  commit: string | null;
  builtAt: string | null;
  gaps: number;
  /** How many of its Gaps the budget left, which Continue asks about with a fresh budget of `calls`. */
  budget: number;
  calls: number;
  /** Its build: open in the herdr `pane`, waiting its turn, or failed for `why`. */
  state: "built" | "building" | "queued" | "failed";
  pane: string | null;
  why: string | null;
  /** How far the build its Run runs has got; null but while one is open and its build has started. */
  progress: Progress | null;
}

/** A build's progress: when its Run started, the calls it `made` (started) of its `calls`, the deepest part it `reached` of its `depth`, the parts asked, those sent back for a correction round, the Gaps so far, and the parts asked `now`, by their trails. */
export interface Progress {
  at: string;
  calls: number;
  made: number;
  depth: number;
  reached: number;
  asked: number;
  sent_back: number;
  gaps: number;
  now: string[];
}

/** A build's progress, a line of segments the page keeps whole: "Call 17 of 48", "depth 2 of 7", "15 parts asked, 2 sent back", "3 Gaps". */
export function progressed(p: Progress): string[] {
  const parts = `${p.asked} part${p.asked === 1 ? "" : "s"} asked, ${p.sent_back === 0 ? "none" : p.sent_back} sent back`;
  const gaps = p.gaps === 0 ? "no Gap" : `${p.gaps} Gap${p.gaps === 1 ? "" : "s"}`;
  return [`Call ${p.made} of ${p.calls}`, `depth ${p.reached} of ${p.depth}`, parts, gaps];
}

/** A Wiki as `GET /api/wiki/<id>` answers it: the Bucket's `wiki.json`, only the fields the page reads, a Repo's marked against its Base. */
export interface Wiki {
  /** A Library version's names its tag; a Repo's has none. */
  target: { repo: string; tag?: string };
  /** The commit it describes. */
  commit: string;
  builtAt: string;
  /** The Repo's Base, how many commits its head is past `commit`, and how many Interpretations are `stale`; a Library version's has none. */
  base: string;
  behind: number;
  stale: number;
  /** Its Component tree, by `parent`: the top one has none. */
  components: Component[];
}

export interface Component {
  id: string;
  name: string;
  parent: string | null;
  /** Markdown, at most about 5 sentences. */
  overview: string;
  /** The names its text uses, each with what it stands for; none on a Wiki built before Components had them. */
  terms?: Term[];
  interpretations: Interpretation[];
  /** What it uses, calls, reads or writes; what does so to it is in the other Components' own. */
  relationships: Relationship[];
  explainer?: Explainer;
  gaps: Gap[];
}

export interface Relationship {
  /** The Component's id. */
  to: string;
  kind: "uses" | "calls" | "reads" | "writes";
  description: string;
}

/** A walkthrough of how something in a Component works: steps numbered from 1, arrows between them by number. */
export interface Explainer {
  title: string;
  steps: Step[];
  arrows: Arrow[];
}

/** From one step to another, by number. */
export interface Arrow {
  from: number;
  to: number;
  label?: string;
}

export interface Step {
  n: number;
  /** One sentence. */
  caption: string;
  anchors: Anchor[];
  /** Where the step happens; steps of one lane are framed together. */
  lane?: string;
}

export interface Interpretation {
  id: number;
  kind: string;
  text: string;
  anchors: Anchor[];
  /** A file it cites changed on the Base since it was written. */
  stale?: true;
}

/** A name a Component's text uses, with what it stands for, citing the lines that declare it. */
export interface Term {
  name: string;
  /** One sentence. */
  meaning: string;
  anchors: Anchor[];
  /** A file it cites changed on the Base since it was written. */
  stale?: true;
}

/** Lines of a file, 1-based and inclusive. */
export interface Anchor {
  path: string;
  start: number;
  end: number;
}

export interface Gap {
  paths: string[];
  reason: "budget" | "depth" | "unreadable";
}

/** The kinds of Interpretation, in the order a Component lists them. */
export const KINDS = ["role", "invariant", "precondition", "postcondition", "effect"];

/** A Component's Interpretations by kind, in `KINDS`' order, the kinds it has none of left out. */
export function byKind(component: Component): { kind: string; interpretations: Interpretation[] }[] {
  return KINDS.map((kind) => ({ kind, interpretations: component.interpretations.filter((i) => i.kind === kind) })).filter(
    (k) => k.interpretations.length > 0,
  );
}

/** Why the build left each Gap, as the page says it. */
export const REASONS: Record<Gap["reason"], string> = {
  budget: "Not explored: the build's calls ran out",
  depth: "Not explored: deeper than the build divides",
  unreadable: "Unreadable: an answer failed its checks",
};

/** How far behind its Base the Wiki is, and how many of its Interpretations are Stale, if any: the header's last words. */
export function freshness(wiki: Pick<Wiki, "base" | "behind" | "stale">): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const behind = wiki.behind === 0 ? `Up to date with ${wiki.base}` : `${count(wiki.behind, "commit")} behind ${wiki.base}`;
  return wiki.stale === 0 ? behind : `${behind} · ${count(wiki.stale, "Interpretation")} Stale`;
}

/** The file at `path` on GitHub, at the commit the Wiki describes. */
export function fileUrl(wiki: Pick<Wiki, "target" | "commit">, path: string): string {
  return `https://github.com/${wiki.target.repo}/blob/${wiki.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The Anchor's lines on GitHub, at the commit the Wiki describes. */
export function anchorUrl(wiki: Pick<Wiki, "target" | "commit">, a: Anchor): string {
  return `${fileUrl(wiki, a.path)}#L${a.start}-L${a.end}`;
}

/** Where `search` found its words: a Component by its name or overview, or one of its Terms or Interpretations. */
export interface Hit {
  component: Component;
  term: Term | null;
  interpretation: Interpretation | null;
  /** The text found, the overview, the Term's meaning or the Interpretation's, as the page shows it: without its Markdown marks. */
  text: string;
}

/** Every Component whose name or overview holds each word of `query`, case aside, then every Term whose name and meaning do, then every Interpretation that does, in the Wiki's order; each read as the page shows it. */
export function search(wiki: Pick<Wiki, "components">, query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const holds = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const shown = (markdown: string) =>
    spans(markdown)
      .map((s) => s.text)
      .join("");
  return [
    ...wiki.components
      .map((c) => ({ component: c, term: null, interpretation: null, text: shown(c.overview) }))
      .filter((h) => holds(`${h.component.name}\n${h.text}`)),
    ...wiki.components.flatMap((c) =>
      (c.terms ?? []).map((t) => ({ component: c, term: t, interpretation: null, text: shown(t.meaning) })).filter((h) => holds(`${h.term.name}\n${h.text}`)),
    ),
    ...wiki.components.flatMap((c) =>
      c.interpretations.map((i) => ({ component: c, term: null, interpretation: i, text: shown(i.text) })).filter((h) => holds(h.text)),
    ),
  ];
}

/** What Continue asks about, before its button: "6 parts not explored (budget)". */
export function unexplored(budget: number): string {
  return `${budget} part${budget === 1 ? "" : "s"} not explored (budget)`;
}

/** The heads the page gives ids, for the outline: the Component's name, then each section it shows, with how many it holds; `related` when a Relationship joins it to another Component, either way, and `parts` how many sub-Components it has. */
export function outline(component: Component, related: boolean, parts: number): { id: string; name: string; count: number | null }[] {
  const terms = component.terms ?? [];
  return [
    { id: "component-name", name: component.name, count: null },
    ...(terms.length > 0 ? [{ id: "head-terms", name: "Terms", count: terms.length }] : []),
    ...(component.interpretations.length > 0 ? [{ id: "head-interpretations", name: "Interpretations", count: component.interpretations.length }] : []),
    ...(related ? [{ id: "head-relationships", name: "Relationships", count: null }] : []),
    ...(component.explainer ? [{ id: "head-explainer", name: "Explainer", count: component.explainer.steps.length }] : []),
    ...(parts > 0 ? [{ id: "head-parts", name: "Components", count: parts }] : []),
    ...(component.gaps.length > 0 ? [{ id: "head-gaps", name: "Gaps", count: component.gaps.length }] : []),
  ];
}

/** A Term's name cut where a line may break inside it, besides after a hyphen: before a capital after a lower-case letter or digit, and after `_`, `.`, `/` or `::`. */
export function seams(name: string): string[] {
  return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_./]|::)/);
}

/** The Components above `component`, from the top one down. */
export function trail(wiki: Pick<Wiki, "components">, component: Component): Component[] {
  const above = wiki.components.find((c) => c.id === component.parent);
  return above ? [...trail(wiki, above), above] : [];
}

/** The Component after `component` in the tree's reading order, as a book is read: its first part, else the next part of it or of a Component above it. */
export function next(wiki: Pick<Wiki, "components">, component: Component): Component | null {
  const parts = (parent: string | null) => wiki.components.filter((c) => c.parent === parent);
  const first = parts(component.id)[0];
  if (first) return first;
  for (let at: Component | undefined = component; at; at = wiki.components.find((c) => c.id === at?.parent)) {
    const siblings = parts(at.parent);
    const after = siblings[siblings.indexOf(at) + 1];
    if (after) return after;
  }
  return null;
}

/** Each file the Anchors of `component` cite, its Terms' and its Explainer's too, once. */
export function citedFiles(component: Component): string[] {
  const anchors = [...(component.terms ?? []), ...component.interpretations, ...(component.explainer?.steps ?? [])].flatMap((x) => x.anchors);
  return [...new Set(anchors.map((a) => a.path))];
}

/** The one file every Anchor of `component` cites, its Explainer's too; null when they cite more, or none. */
export function cited(component: Component): string | null {
  const files = citedFiles(component);
  return files.length === 1 ? files[0] : null;
}

/** A namer of each of `paths`: its file's name, with as many of its folders as tell it from another of `paths` of that name. */
export function named(paths: string[]): (path: string) => string {
  return (path) => {
    const parts = path.split("/");
    const ending = (p: string, n: number) => p.split("/").slice(-n).join("/");
    let n = 1;
    while (n < parts.length && paths.some((p) => p !== path && ending(p, n) === ending(path, n))) n++;
    return ending(path, n);
  };
}

/** The first sentence of `overview`'s first line, its Markdown kept, a list item's marker dropped: a sub-Component's gist. */
export function gist(overview: string): string {
  const text = firstText(overview);
  // A stop ends it before a space and a word not in lower case: not `index.ts`, nor `e.g. the`.
  const end = /[.!?](?=\s+[^\sa-z])/.exec(text);
  return end ? text.slice(0, end.index + 1) : text;
}
