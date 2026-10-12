import type { Review } from "./status";

/** Where the review of `issue`'s PR stands, in a line; the ones that need you say how to record a Verdict by hand. */
export function said(issue: string, r: Review): string {
  const sha = r.sha.slice(0, 7);
  const byHand = `review it by hand with \`nico-agent verdict ${issue} pass|fail --sha ${r.sha}\``;
  switch (r.state) {
    case "off":
      return "Review is off for this Repo";
    case "passed":
      return `Verdict pass at ${sha}`;
    case "failed":
      return `Verdict fail at ${sha}`;
    case "reviewing":
      return `Reviewing ${sha} on ${r.harness}`;
    case "stopped":
      return `Reviewer on ${r.harness} stopped without a Verdict: ${byHand}`;
    case "retrying":
      return `Reviewer failed to start or left herdr (${r.attempts} of ${r.cap}); trying again next tick`;
    case "gave_up":
      return `Reviewer gave up on ${sha}: ${byHand}`;
    case "waiting":
      return "Waiting for a Reviewer";
  }
}

/** The review's short line under a PR draft node's Stage. */
export const short: Record<Review["state"], string> = {
  off: "review off",
  passed: "verdict pass",
  failed: "verdict fail",
  reviewing: "reviewing",
  stopped: "review stopped",
  retrying: "review retrying",
  gave_up: "review gave up",
  waiting: "waiting for review",
};

/** A review only the user can move on: its Reviewer stopped without a Verdict, or the loop gave up starting one. */
export const needsYou = (r: Review | null) => r?.state === "stopped" || r?.state === "gave_up";
