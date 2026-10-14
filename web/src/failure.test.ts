import { describe, expect, it } from "vitest";
import { reviewerKeptFailing } from "./failure";

const restart = (reason: string) => ({ at: "2026-09-30T02:00:00Z", reason, by: "loop" });

describe("the Failure section of a Dispatch's panel", () => {
  it("says the Reviewer failed it N rounds running, the restarts it had for its Verdicts and the last, and what ends it", () => {
    const failure = { step: "restart", error: "verdict again after 2 restarts for it", reason: "verdict" };

    expect(reviewerKeptFailing(failure, [restart("verdict"), restart("stalled"), restart("verdict")])).toEqual({
      said: "The Reviewer failed it 3 rounds running; the Findings and Rulings are in its Evidence",
      help: "Merge its PR or close it on GitHub, and the loop Closes the Dispatch",
    });
  });

  it("says one round when the first failing Verdict used the restarts up", () => {
    const failure = { step: "restart", error: "verdict again after 0 restarts for it", reason: "verdict" };

    expect(reviewerKeptFailing(failure, [])?.said).toBe("The Reviewer failed it 1 round running; the Findings and Rulings are in its Evidence");
  });

  it("says nothing of its own for any other failure, shown as it is", () => {
    const failures = [
      { step: "restart", error: "stalled again after 2 restarts for it", reason: "stalled" },
      { step: "tab", error: "acme/api#7 failed at tab of its verdict restart: herdr is down", reason: "verdict" },
      { step: "restart", error: "the PR below, https://github.com/acme/api/pull/8, closed unmerged" },
      { step: "worktree", error: "the branch is taken" },
    ];

    expect(failures.map((f) => reviewerKeptFailing(f, [restart("verdict")]))).toEqual([null, null, null, null]);
  });
});
