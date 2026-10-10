import { describe, expect, test } from "bun:test";
import type { BoardJson } from "../src/app/board";
import { boardSummary } from "../src/board-summary";

describe("the Board as the Front voice reads it", () => {
  test("an empty Board says so", () => {
    expect(boardSummary({ inFlight: "0 Dispatches" })).toBe("Nothing is Ready or In flight.");
  });

  test("what is In flight with its Stage and PR, what is Asking, what is Ready, Stackable or has a PR, and each Repo's Queue", () => {
    const board = {
      bin: "~/.local/bin/nico-agent",
      ready: "1 issue",
      issues: [{ issue: "acme/api#7", title: "Add retries", repo: "acme/api", url: "https://github.com/acme/api/issues/7", base: "main" }],
      stackable: [{ issue: "acme/api#9", title: "Retry budget", blockers: [{ issue: "acme/api#5", pr: "https://github.com/acme/api/pull/12", base: "x" }] }],
      prOpen: [{ issue: "acme/api#3", title: "Fix typo", pr: "https://github.com/acme/api/pull/4", state: "OPEN" }],
      rooms: [{ repo: "acme/api", running: [], room: 2, candidates: [], queue: ["acme/api#20", "acme/api#21"] }, { repo: "acme/web", queue: [] }],
      specs: [{ spec: "acme/api#20", title: "Billing", held: { issue: "acme/api#22", reason: "acme/api#22's Dispatch Failed at launch: herdr is down" } }],
      inFlight: "2 Dispatches",
      dispatches: [
        { issue: "acme/api#5", title: "Retry client", stage: "PR ready", pr: "https://github.com/acme/api/pull/12", implementer: "idle", reviewer: "", harness: "claude" },
        { issue: "acme/api#6", title: "Timeouts", stage: "Implementing", pr: "", implementer: "blocked", reviewer: "" },
      ],
      asking: [{ issue: "acme/api#6", question: "Which timeout, 5s or 10s?" }, { gardener: "acme/web", question: "Which name wins?" }],
      gardeners: [{ repo: "acme/web", state: "blocked" }],
      warning: "GitHub's rate limit is spent until 14:05",
      help: ["Run `nico-agent dispatch ...`"],
    };

    expect(boardSummary(board as unknown as BoardJson)).toBe([
      "In flight (2):",
      "- acme/api#5 Retry client: PR ready, https://github.com/acme/api/pull/12",
      "- acme/api#6 Timeouts: Implementing, its Implementer is Asking",
      "Asking the user:",
      "- acme/api#6: Which timeout, 5s or 10s?",
      "- the Gardener of acme/web: Which name wins?",
      "Ready (1): acme/api#7 Add retries",
      "Stackable (1): acme/api#9 Retry budget",
      "PR open outside a Dispatch (1): acme/api#3 Fix typo, https://github.com/acme/api/pull/4",
      "Held: acme/api#20 Billing (acme/api#22's Dispatch Failed at launch: herdr is down)",
      "Queue of acme/api: acme/api#20, acme/api#21",
      "Warning: GitHub's rate limit is spent until 14:05",
    ].join("\n"));
  });

  test("a long list is cut short, and a long question keeps its end", () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({ issue: `acme/api#${i + 1}`, title: `Issue ${i + 1}` }));
    const question = `${"x".repeat(1000)}Which one?`;
    const summary = boardSummary({ issues, asking: [{ issue: "acme/api#1", question }] } as BoardJson);

    expect(summary).toContain("Ready (30): acme/api#1 Issue 1;");
    expect(summary).toContain("acme/api#20 Issue 20; and 10 more");
    expect(summary).not.toContain("Issue 21");
    expect(summary).toContain("- acme/api#1: …");
    expect(summary).toContain("xWhich one?");
    expect(summary.length).toBeLessThan(1200);
  });

  test("a Board that could not be loaded says why", () => {
    expect(boardSummary({ errors: [{ repo: "acme/api", error: "gh: not logged in" }] }))
      .toBe("Nothing is Ready or In flight.\nCould not load: acme/api: gh: not logged in");
  });

  test("a Board that could not be read at all says so, not that nothing is Ready", () => {
    expect(boardSummary({ error: "config.json is not valid JSON", help: [] })).toBe("The Board could not be read: config.json is not valid JSON");
  });

  test("an Asking agent whose screen could not be read says why", () => {
    expect(boardSummary({ asking: [{ issue: "acme/api#6", question: "", error: "herdr: no such agent" }] }))
      .toBe("Asking the user:\n- acme/api#6: (its question could not be read: herdr: no such agent)");
  });
});
