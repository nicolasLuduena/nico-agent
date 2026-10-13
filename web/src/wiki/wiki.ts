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

/** A Wiki as `GET /api/wikis` lists it. */
export interface Listed {
  id: string;
  target: { repo: string };
  commit: string;
  builtAt: string;
  gaps: number;
}

/** A Wiki as `GET /api/wiki/<id>` answers it: the Bucket's `wiki.json`, only the fields the page reads. */
export interface Wiki {
  target: { repo: string };
  /** The commit it describes. */
  commit: string;
  builtAt: string;
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
