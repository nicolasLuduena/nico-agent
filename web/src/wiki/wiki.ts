import { spans } from "../markdown";

/** A Wiki as `GET /api/wikis` lists it. */
export interface Listed {
  id: string;
  target: { repo: string };
  commit: string;
  builtAt: string;
  gaps: number;
}

/** A Wiki as `GET /api/wiki/<id>` answers it: the Bucket's `wiki.json`, only the fields the page reads, marked against its Repo's Base. */
export interface Wiki {
  target: { repo: string };
  /** The commit it describes. */
  commit: string;
  builtAt: string;
  /** The Repo's Base, how many commits its head is past `commit`, and how many Interpretations are `stale`. */
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
