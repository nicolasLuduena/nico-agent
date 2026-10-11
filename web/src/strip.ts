import type { Dispatch, Status } from "./status";

/** One row of the needs-you strip: what only the user can act on. */
export interface Need {
  kind: "Asking" | "Failed" | "Verified" | "Paused";
  /** The Repo and issue whose node the row opens; none for a paused Source. */
  repo: string | null;
  issue: string | null;
  /** The question's first line, the issue's title, or the paused Source. */
  text: string;
  /** Since when it is Asking, when it last changed, its Verdict's time, or the pause's end. */
  at: string | null;
}

/** The needs-you strip, across Repos, from `/api/status`. */
export function needsYou(status: Status): Need[] {
  const live = status.dispatches.filter((d) => d.closed_at === null);
  const row = (kind: Need["kind"], d: Dispatch, at: string | null, text = d.title): Need => ({ kind, repo: d.repo, issue: d.issue, text, at });
  return [
    // The question is one line, the last meaningful one of its pane; empty when it could not be read.
    ...live.flatMap((d) => (d.asking ? [row("Asking", d, d.asking.since, d.asking.question || d.title)] : [])),
    ...live.filter((d) => d.stage === "Failed").map((d) => row("Failed", d, d.updated_at)),
    ...live.filter((d) => d.stage === "Verified").map((d) => row("Verified", d, d.verdict?.at ?? null)),
    ...(status.sources.github.paused_until
      ? [{ kind: "Paused" as const, repo: null, issue: null, text: "GitHub", at: status.sources.github.paused_until }]
      : []),
  ];
}
