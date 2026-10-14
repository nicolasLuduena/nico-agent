import type { Project } from "./status";

// DESIGN.md's working hues, each a token in app.css with its dark twin: one
// per Stage (a ring, its word, its node's tint), per Harness (a diamond) and
// per Repo of a Project of more than one (a square, a rule).

const STAGES: Record<string, string> = {
  Waiting: "waiting",
  Ready: "ready",
  Stackable: "stackable",
  Implementing: "live",
  "PR draft": "live",
  Verified: "verified",
  Merged: "merged",
  Closed: "closed",
  Failed: "failed",
};

/** A Stage's hue; none for a Blocker not offered to the loop, which reads in ink. */
export const stageHue = (stage: string | null): string | null => (stage && STAGES[stage] ? `var(--${STAGES[stage]})` : null);

/** A Harness's hue: claude, codex and opencode each their own, any other ink-muted. */
export const harnessHue = (harness: string | null | undefined) =>
  harness && ["claude", "codex", "opencode"].includes(harness) ? `var(--harness-${harness})` : "var(--ink-muted)";

/** How many line colours there are; a Project's seventh Repo takes the first again. */
const LINES = 6;

/**
 * The line colour of the Repo `slug` in `project`, by its order there (serve
 * lists a Project's Repos by slug), so it keeps it across reloads; none in a
 * Project of one Repo, nor for a Repo outside it.
 */
export function repoLine(slug: string | null, project: Project | undefined): string | null {
  const at = slug && project && project.repos.length > 1 ? project.repos.indexOf(slug) : -1;
  return at < 0 ? null : `var(--line-${(at % LINES) + 1})`;
}
