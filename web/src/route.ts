/** What the URL's hash selects: a Project's tab, its view, and in its Wiki view a Wiki and one of its Components. */
export interface Route {
  project: string | null;
  view: "map" | "wiki";
  /** The Wiki's id; null, the Project's first. */
  wiki: string | null;
  /** The Component's id; null, the Wiki's top one. */
  component: string | null;
}

/** `#<project>`, its map, or `#<project>/wiki/<wiki>/<component>`, the last two optional; each part escaped, as names and ids hold `/`. */
export function hash(at: Route): string {
  if (at.project === null) return "";
  const parts = [at.project];
  if (at.view === "wiki") parts.push("wiki");
  if (at.view === "wiki" && at.wiki) parts.push(at.wiki);
  if (at.view === "wiki" && at.wiki && at.component) parts.push(at.component);
  return `#${parts.map(encodeURIComponent).join("/")}`;
}

/** What `hash` selects: nothing it cannot read. */
export function route(hash: string): Route {
  const none: Route = { project: null, view: "map", wiki: null, component: null };
  let parts: string[];
  try {
    parts = hash.replace(/^#/, "").split("/").map(decodeURIComponent);
  } catch {
    return none;
  }
  const [project, view, wiki, component] = parts;
  if (!project) return none;
  if (view !== "wiki") return { ...none, project };
  return { project, view, wiki: wiki || null, component: (wiki && component) || null };
}
