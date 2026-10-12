import * as review from "./review";
import type { Dispatch, Status } from "./status";

/** One row of the needs-you strip: what only the user can act on. */
export interface Need {
  kind: "Asking" | "Failed" | "Review" | "Verified" | "Paused";
  /** The Repo and issue whose node the row opens; none for a paused Source. */
  repo: string | null;
  issue: string | null;
  /** The question's first line, the issue's title, where its review stands, or the paused Source. */
  text: string;
  /** Since when it is Asking (null till a tick sees it), when it last changed, its Verdict's time, or the pause's end; null for a review. */
  at: string | null;
}

/** The needs-you strip, across Repos, from `/api/status`. */
export function needsYou(status: Status): Need[] {
  const live = status.dispatches.filter((d) => d.closed_at === null);
  const row = (kind: Need["kind"], d: Dispatch, at: string | null, text = d.title): Need => ({ kind, repo: d.repo, issue: d.issue, text, at });
  return [
    // Asking as herdr says now, as the map shows it; the question, one line of its pane, once a tick reads it.
    ...live
      .filter((d) => d.asking || d.agent_state?.implementer === "blocked")
      .map((d) => row("Asking", d, d.asking?.since ?? null, d.asking?.question || d.title)),
    ...live.filter((d) => d.stage === "Failed").map((d) => row("Failed", d, d.updated_at)),
    ...live.filter((d) => review.needsYou(d.review)).map((d) => row("Review", d, null, review.said(d.issue, d.review!))),
    ...live.filter((d) => d.stage === "Verified").map((d) => row("Verified", d, d.verdict?.at ?? null)),
    ...(status.sources.github.paused_until
      ? [{ kind: "Paused" as const, repo: null, issue: null, text: "GitHub", at: status.sources.github.paused_until }]
      : []),
  ];
}
