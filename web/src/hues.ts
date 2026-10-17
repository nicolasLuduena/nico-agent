// DESIGN.md's working hues, each a token in app.css with its dark twin: one
// per Stage (its mark and its word) and per Harness (a dot in a launch picker).

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
