import type { Failure, Restart } from "./status";

/**
 * A Dispatch Failed because the Reviewer kept failing it, with the restarts
 * it had: what to say of it, and its help, which names only what ends it.
 * Null for any other failure, a `verdict` restart that failed at a step
 * included, which is shown as it is.
 */
export function reviewerKeptFailing(failure: Failure | null, restarts: Restart[]): { said: string; help: string } | null {
  if (failure?.reason !== "verdict" || failure.step !== "restart") return null;
  // Each `verdict` restart followed a failing Verdict, and the last one used them up.
  const rounds = restarts.filter((r) => r.reason === "verdict").length + 1;
  return {
    said: `The Reviewer failed it ${rounds} ${rounds === 1 ? "round" : "rounds"} running; the Findings and Rulings are in its Evidence`,
    help: "Merge its PR or close it on GitHub, and the loop Closes the Dispatch",
  };
}
