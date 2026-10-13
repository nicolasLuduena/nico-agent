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
  gaps: Gap[];
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
