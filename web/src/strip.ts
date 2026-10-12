import * as review from "./review";
import type { Dispatch, Run, Status } from "./status";

/** One row of the needs-you strip: what only the user can act on. */
export interface Need {
  kind: "Asking" | "Blocked" | "Failed" | "Review" | "Verified" | "Paused" | "Check";
  /** The Repo and issue whose node the row opens; neither for a paused Source or the morning agent, no issue for a quality-scan or a check. */
  repo: string | null;
  issue: string | null;
  /** The question's first line, the issue's title, the blocked agent's name, where its review stands, the paused Source, or what a failing check says. */
  text: string;
  /** A failing check's help. */
  help?: string | null;
  /** Since when it is Asking (null till a tick sees it), blocked or failing, when it last changed, its Verdict's time, or the pause's end; null for a review. */
  at: string | null;
}

/** The needs-you strip, across Repos, from `/api/status`. */
export function needsYou(status: Status): Need[] {
  const live = status.dispatches.filter((d) => d.closed_at === null);
  const row = (kind: Need["kind"], d: Dispatch, at: string | null, text = d.title): Need => ({ kind, repo: d.repo, issue: d.issue, text, at });
  // An agent of the loop's own herdr reports blocked holds its Run open till the user takes it over.
  const blocked = (run: Run | undefined, repo: string | null, issue: string | null): Need[] =>
    run?.blocked_since ? [{ kind: "Blocked", repo, issue, text: run.agent, at: run.blocked_since }] : [];
  return [
    // Asking as herdr says now, as the map shows it; the question, one line of its pane, once a tick reads it.
    ...live
      .filter((d) => d.asking || d.agent_state?.implementer === "blocked")
      .map((d) => row("Asking", d, d.asking?.since ?? null, d.asking?.question || d.title)),
    ...live.flatMap((d) => blocked(d.faux_nico, d.repo, d.issue)),
    ...status.repos.flatMap((r) => blocked(r.last_scan, r.slug, null)),
    ...blocked(status.morning, null, null),
    ...live.filter((d) => d.stage === "Failed").map((d) => row("Failed", d, d.updated_at)),
    ...live.filter((d) => review.needsYou(d.review)).map((d) => row("Review", d, null, review.said(d.issue, d.review!))),
    ...live.filter((d) => d.stage === "Verified").map((d) => row("Verified", d, d.verdict?.at ?? null)),
    ...status.repos.flatMap((r) =>
      (r.checks?.results ?? [])
        .filter((c) => !c.ok)
        .map((c): Need => ({ kind: "Check", repo: r.slug, issue: null, text: c.said, help: c.help, at: r.checks!.at })),
    ),
    ...(status.sources.github.paused_until
      ? [{ kind: "Paused" as const, repo: null, issue: null, text: "GitHub", at: status.sources.github.paused_until }]
      : []),
  ];
}
