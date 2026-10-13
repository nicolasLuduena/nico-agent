import { spans } from "../markdown";
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
  /** How far the build its Run runs has got; null but while one is open and has made a call. */
  progress: Progress | null;
}

/** A build's progress: when its Run started, the calls it `made` of its `calls`, the deepest part it `reached` of its `depth`, the parts asked, those sent back for a correction round, the Gaps so far, and the part `asking` last, by its trail. */
export interface Progress {
  at: string;
  calls: number;
  made: number;
  depth: number;
  reached: number;
  asked: number;
  sent_back: number;
  gaps: number;
  asking: string;
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

/** The Anchor's lines on GitHub, at the commit the Wiki describes. */
export function anchorUrl(wiki: Pick<Wiki, "target" | "commit">, a: Anchor): string {
  return `https://github.com/${wiki.target.repo}/blob/${wiki.commit}/${a.path.split("/").map(encodeURIComponent).join("/")}#L${a.start}-L${a.end}`;
}

/** Where `search` found its words: a Component by its name or overview, or one of its Interpretations. */
export interface Hit {
  component: Component;
  interpretation: Interpretation | null;
  /** The text found, the overview or the Interpretation's, as the page shows it: without its Markdown marks. */
  text: string;
}

/** Every Component whose name or overview holds each word of `query`, case aside, then every Interpretation that does, in the Wiki's order; each read as the page shows it. */
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
      .map((c) => ({ component: c, interpretation: null, text: shown(c.overview) }))
      .filter((h) => holds(`${h.component.name}\n${h.text}`)),
    ...wiki.components.flatMap((c) =>
      c.interpretations.map((i) => ({ component: c, interpretation: i, text: shown(i.text) })).filter((h) => holds(h.text)),
    ),
  ];
}

/** What Continue asks about, before its button: "6 parts not explored (budget)". */
export function unexplored(budget: number): string {
  return `${budget} part${budget === 1 ? "" : "s"} not explored (budget)`;
}
