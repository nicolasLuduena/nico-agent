import type { Role } from "./map/layout";

/** What the Board's URL hash selects: a Project, its view, and on its map the open issue and agent. */
export interface Route {
  project: string | null;
  view: "map" | "roadmap";
  /** The issue whose panel is open on the map. */
  issue: string | null;
  /** Its agent whose panel is open in place of the issue's. */
  agent: Role | null;
}

/**
 * `#<project>`, its map, or `#<project>/roadmap`, its Roadmap; on the map
 * `#<project>/<issue>` opens the issue's panel and `#<project>/<issue>/<role>`
 * its agent's. Each part escaped, as names and keys hold `/` and `#`.
 */
export function hash(at: Pick<Route, "project" | "view"> & Partial<Route>): string {
  if (at.project === null) return "";
  const parts = [at.project];
  if (at.view === "roadmap") parts.push("roadmap");
  else if (at.issue) parts.push(at.issue, ...(at.agent ? [at.agent] : []));
  return `#${parts.map(encodeURIComponent).join("/")}`;
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
  const [project, second, role] = parts(hash) ?? [];
  const none = { view: "map", issue: null, agent: null } as const;
  if (!project) return { project: null, ...none };
  if (second === "roadmap") return { project, ...none, view: "roadmap" };
  if (!second) return { project, ...none };
  const agent = role === "implementer" || role === "reviewer" ? role : null;
  return { project, view: "map", issue: second, agent };
}
