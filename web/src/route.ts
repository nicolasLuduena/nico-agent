/** What the Board's URL hash selects: a Project and its view; or Libraries, of no Project. */
export interface Route {
  project: string | null;
  view: "map" | "wiki" | "roadmap" | "libraries";
}

/**
 * `#<project>`, its map, `#<project>/wiki`, its Wiki view, or
 * `#<project>/roadmap`, its Roadmap; the name
 * escaped, as names hold `/`. Libraries is `#/libraries`: no
 * Project, as an escaped name holds no `/`.
 */
export function hash(at: Route): string {
  if (at.project === null) return at.view === "libraries" ? "#/libraries" : "";
  const view = at.view === "wiki" || at.view === "roadmap" ? `/${at.view}` : "";
  return `#${encodeURIComponent(at.project)}${view}`;
}

/** The hash's parts, unescaped; null for a broken escape. */
function parts(hash: string): string[] | null {
  try {
    return hash.replace(/^#/, "").split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** What `hash` selects: nothing it cannot read. */
export function route(hash: string): Route {
  const none: Route = { project: null, view: "map" };
  const [project, view] = parts(hash) ?? [];
  if (!project) return parts(hash)?.length === 2 && view === "libraries" ? { ...none, view } : none;
  return { project, view: view === "wiki" || view === "roadmap" ? view : "map" };
}

/** Escaped for a page's URL, its `/`, `@` and `:` kept as written, as a Library version's id reads. */
const escaped = (text: string) =>
  text
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%40", "@").replaceAll("%3A", ":"))
    .join("/");

/** `text` unescaped; a broken escape left as written, so it names a Wiki no one has. */
const unescaped = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** The fragment opening `component` on its Wiki's page; none, its top one. */
export const fragment = (component: string | null) => (component ? `#${escaped(component)}` : "");

/** A Wiki's page, `/wiki/<id>`, open at `component`, or at its top one; a link to it from anywhere. */
export function page(id: string, component: string | null = null): string {
  return `/wiki/${escaped(id)}${fragment(component)}`;
}

/** What a Wiki's page opens: the Wiki its path names, at the Component its fragment does; none off a Wiki's page. */
export function reading(path: string, hash: string): { wiki: string; component: string | null } | null {
  const id = /^\/wiki\/(.+)$/.exec(path)?.[1];
  return id ? { wiki: unescaped(id), component: unescaped(hash.replace(/^#/, "")) || null } : null;
}

/** Where an old link to a Wiki on the Board, `#<project>/wiki/<wiki>[/<component>]`, is now: its page; none for any other hash. */
export function movedTo(hash: string): string | null {
  const [, view, wiki, component] = parts(hash) ?? [];
  return view === "wiki" && wiki ? page(wiki, component || null) : null;
}
