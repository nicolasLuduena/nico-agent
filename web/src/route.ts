/** What the Board's URL hash selects: a Project and its view. */
export interface Route {
  project: string | null;
  view: "map" | "roadmap";
}

/**
 * `#<project>`, its map, or `#<project>/roadmap`, its Roadmap; the name
 * escaped, as names hold `/`.
 */
export function hash(at: Route): string {
  if (at.project === null) return "";
  return `#${encodeURIComponent(at.project)}${at.view === "roadmap" ? "/roadmap" : ""}`;
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
  const [project, view] = parts(hash) ?? [];
  if (!project) return { project: null, view: "map" };
  return { project, view: view === "roadmap" ? view : "map" };
}
