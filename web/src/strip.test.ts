import { describe, expect, it } from "vitest";
import type { Dispatch, Status } from "./status";
import { needsYou } from "./strip";

const status = (dispatches: Partial<Dispatch>[], githubPausedUntil: string | null = null): Status => ({
  repos: [],
  sources: { github: { paused_until: githubPausedUntil }, linear: { paused_until: null } },
  dispatches: dispatches.map((d) => ({
    issue: "acme/api#7",
    title: "Add the export endpoint",
    repo: "acme/api",
    stage: "Implementing",
    asking: null,
    verdict: null,
    updated_at: "2026-09-30T11:00:00Z",
    closed_at: null,
    ...d,
  })),
});

describe("the needs-you strip", () => {
  it("is empty when nothing needs you, a Closed Dispatch's leftovers included", () => {
    const quiet = status([
      { stage: "PR draft" },
      { stage: "Merged", asking: { since: "2026-09-30T10:00:00Z", question: "Ship it?" }, closed_at: "2026-09-30T11:30:00Z" },
    ]);

    expect(needsYou(quiet)).toEqual([]);
  });

  it("lists an Implementer Asking with its Repo, issue and the question's first line", () => {
    const asking = status([
      { repo: "acme/web", issue: "acme/web#3", asking: { since: "2026-09-30T04:12:00Z", question: "Keep the v1 route?" } },
    ]);

    expect(needsYou(asking)).toEqual([
      { kind: "Asking", repo: "acme/web", issue: "acme/web#3", text: "Keep the v1 route?", at: "2026-09-30T04:12:00Z" },
    ]);
  });

  it("lists a Failed Dispatch with its title, as of its last change", () => {
    const failed = status([{ issue: "BLE-12", repo: "acme/web", title: "Retry the webhook", stage: "Failed", updated_at: "2026-09-30T03:40:00Z" }]);

    expect(needsYou(failed)).toEqual([
      { kind: "Failed", repo: "acme/web", issue: "BLE-12", text: "Retry the webhook", at: "2026-09-30T03:40:00Z" },
    ]);
  });

  it("lists a Verified PR waiting to merge, as of its Verdict", () => {
    const verified = status([
      { stage: "Verified", verdict: { result: "pass", sha: "4f2a9c1", at: "2026-09-30T05:02:00Z" } },
    ]);

    expect(needsYou(verified)).toEqual([
      { kind: "Verified", repo: "acme/api", issue: "acme/api#7", text: "Add the export endpoint", at: "2026-09-30T05:02:00Z" },
    ]);
  });

  it("lists GitHub paused, until when, after the work", () => {
    const paused = status([{ stage: "Failed" }], "2026-09-30T13:00:00Z");

    expect(needsYou(paused).map((n) => [n.kind, n.text, n.at])).toEqual([
      ["Failed", "Add the export endpoint", "2026-09-30T11:00:00Z"],
      ["Paused", "GitHub", "2026-09-30T13:00:00Z"],
    ]);
  });
});
