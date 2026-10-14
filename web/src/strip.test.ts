import { describe, expect, it } from "vitest";
import type { Dispatch, Repo, Run, Status } from "./status";
import { needsYou } from "./strip";

const status = (dispatches: Partial<Dispatch>[], githubPausedUntil: string | null = null): Status => ({
  projects: [],
  repos: [],
  wikis: [],
  libraries: [],
  sources: { github: { paused_until: githubPausedUntil }, linear: { paused_until: null } },
  wiki_settings: { hour: 2, launch: { harness: "opencode", model: null, effort: null }, calls: 48, depth: 7, concurrency: 4, embed_model: "nomic-embed-text", harnesses: {} },
  dispatches: dispatches.map((d) => ({
    issue: "acme/api#7",
    title: "Add the export endpoint",
    repo: "acme/api",
    stage: "Implementing",
    implementer: { harness: "claude", model: null, effort: null },
    asking: null,
    review: null,
    verdict: null,
    failure: null,
    restarts: [],
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

  it("lists an Implementer Asking as soon as herdr says it is blocked, by its title till a tick reads the question", () => {
    const blocked = status([{ agent_state: { implementer: "blocked", reviewer: null } }]);

    expect(needsYou(blocked)).toEqual([
      { kind: "Asking", repo: "acme/api", issue: "acme/api#7", text: "Add the export endpoint", at: null },
    ]);
  });

  it("lists each blocked agent of the loop after the Asking, by the name to take it over with, as of its block", () => {
    const blocked = (agent: string, at: string): Run => ({ agent, blocked_since: at });
    const asking = { since: "2026-09-30T04:12:00Z", question: "Keep the v1 route?" };
    const loop: Status = {
      ...status([{ stage: "Failed", asking, faux_nico: blocked("faux-nico-api-7", "2026-09-30T04:20:00Z") }]),
      repos: [{ slug: "acme/api", last_scan: blocked("quality-scan-api", "2026-09-30T03:10:00Z") } as Repo],
      morning: blocked("morning", "2026-09-30T07:10:00Z"),
    };

    expect(needsYou(loop)).toEqual([
      { kind: "Asking", repo: "acme/api", issue: "acme/api#7", text: "Keep the v1 route?", at: "2026-09-30T04:12:00Z" },
      { kind: "Blocked", repo: "acme/api", issue: "acme/api#7", text: "faux-nico-api-7", at: "2026-09-30T04:20:00Z" },
      { kind: "Blocked", repo: "acme/api", issue: null, text: "quality-scan-api", at: "2026-09-30T03:10:00Z" },
      { kind: "Blocked", repo: null, issue: null, text: "morning", at: "2026-09-30T07:10:00Z" },
      { kind: "Failed", repo: "acme/api", issue: "acme/api#7", text: "Add the export endpoint", at: "2026-09-30T11:00:00Z" },
    ]);
  });

  it("lists no agent of the loop that is not blocked", () => {
    const quiet: Status = {
      ...status([{ faux_nico: { agent: "faux-nico-api-7" } }]),
      repos: [{ slug: "acme/api", last_scan: { agent: "quality-scan-api" } } as Repo],
      morning: { agent: "morning" },
    };

    expect(needsYou(quiet)).toEqual([]);
  });

  it("lists a Failed Dispatch with its title, as of its last change", () => {
    const failed = status([{ issue: "BLE-12", repo: "acme/web", title: "Retry the webhook", stage: "Failed", updated_at: "2026-09-30T03:40:00Z" }]);

    expect(needsYou(failed)).toEqual([
      { kind: "Failed", repo: "acme/web", issue: "BLE-12", text: "Retry the webhook", at: "2026-09-30T03:40:00Z" },
    ]);
  });

  it("lists a Dispatch the Reviewer kept failing with how many rounds, where the Findings and Rulings are, and what ends it", () => {
    const verdict = { at: "2026-09-30T02:00:00Z", reason: "verdict", by: "loop" };
    const failed = status([
      {
        stage: "Failed",
        failure: { step: "restart", error: "verdict again after 2 restarts for it", reason: "verdict" },
        restarts: [verdict, { ...verdict, reason: "rebooted" }, verdict],
      },
    ]);

    expect(needsYou(failed)).toEqual([
      {
        kind: "Failed",
        repo: "acme/api",
        issue: "acme/api#7",
        text: "The Reviewer failed it 3 rounds running; the Findings and Rulings are in its Evidence",
        help: "Merge its PR or close it on GitHub, and the loop Closes the Dispatch",
        at: "2026-09-30T11:00:00Z",
      },
    ]);
  });

  it("lists a Dispatch Failed for any other reason by its title, a verdict restart that failed at a step included", () => {
    const failed = status([
      { stage: "Failed", failure: { step: "restart", error: "stalled again after 2 restarts for it", reason: "stalled" } },
      { issue: "acme/api#8", title: "Page the export", stage: "Failed", failure: { step: "tab", error: "herdr is down", reason: "verdict" } },
    ]);

    expect(needsYou(failed)).toEqual([
      { kind: "Failed", repo: "acme/api", issue: "acme/api#7", text: "Add the export endpoint", at: "2026-09-30T11:00:00Z" },
      { kind: "Failed", repo: "acme/api", issue: "acme/api#8", text: "Page the export", at: "2026-09-30T11:00:00Z" },
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

  it("lists a review that gave up or stopped, with how to record its Verdict by hand, and not one still trying", () => {
    const review = { sha: "4f2a9c1e0b", harness: "codex", attempts: 0, cap: 2 };
    const stuck = status([
      { stage: "PR draft", review: { ...review, state: "gave_up", attempts: 3 } },
      { issue: "acme/api#8", title: "Page the export", stage: "PR draft", review: { ...review, state: "stopped" } },
      { issue: "acme/api#9", stage: "PR draft", review: { ...review, state: "retrying", attempts: 1 } },
    ]);

    expect(needsYou(stuck)).toEqual([
      {
        kind: "Review",
        repo: "acme/api",
        issue: "acme/api#7",
        text: "Reviewer gave up on 4f2a9c1: review it by hand with `nico-agent verdict acme/api#7 pass|fail --sha 4f2a9c1e0b`",
        at: null,
      },
      {
        kind: "Review",
        repo: "acme/api",
        issue: "acme/api#8",
        text: "Reviewer on codex stopped without a Verdict: review it by hand with `nico-agent verdict acme/api#8 pass|fail --sha 4f2a9c1e0b`",
        at: null,
      },
    ]);
  });

  it("lists GitHub paused, until when, after the work", () => {
    const paused = status([{ stage: "Failed" }], "2026-09-30T13:00:00Z");

    expect(needsYou(paused).map((n) => [n.kind, n.text, n.at])).toEqual([
      ["Failed", "Add the export endpoint", "2026-09-30T11:00:00Z"],
      ["Paused", "GitHub", "2026-09-30T13:00:00Z"],
    ]);
  });

  it("lists each failing Readiness check with its Repo, what it says and its help, since when it fails, after the work", () => {
    const check = (name: string, ok: boolean, said: string, help: string | null = null) => ({ name, ok, said, help });
    const checked: Status = {
      ...status([{ stage: "Failed" }]),
      repos: [
        {
          slug: "acme/api",
          checks: {
            at: "2026-09-30T07:00:00Z",
            results: [
              check("clone", true, "/src/api is a clone of acme/api"),
              check("skills", false, "no verdict skill for codex, the Reviewer's Harness", "Install verdict in one of ~/.agents/skills"),
            ],
          },
        } as Repo,
        { slug: "acme/web" } as Repo,
      ],
    };

    expect(needsYou(checked)).toEqual([
      { kind: "Failed", repo: "acme/api", issue: "acme/api#7", text: "Add the export endpoint", at: "2026-09-30T11:00:00Z" },
      {
        kind: "Check",
        repo: "acme/api",
        issue: null,
        text: "no verdict skill for codex, the Reviewer's Harness",
        help: "Install verdict in one of ~/.agents/skills",
        at: "2026-09-30T07:00:00Z",
      },
    ]);
  });

  it("lists a failed or refused Install with its Repo, its output's last line and the command to run it again, and not one that went fine", () => {
    const install = (ok: boolean, output: string) => ({
      command: "make install",
      last: { at: "2026-09-30T02:10:00Z", sha: ok ? "4f2a9c1" : null, ok, output },
    });
    const installed: Status = {
      ...status([]),
      repos: [
        { slug: "acme/api", install: install(false, "Compiling api\nerror: could not compile") } as Repo,
        { slug: "acme/web", install: install(true, "done") } as Repo,
        { slug: "acme/cli", install: { command: "make install", last: null } } as Repo,
      ],
    };

    expect(needsYou(installed)).toEqual([
      {
        kind: "Install",
        repo: "acme/api",
        issue: null,
        text: "error: could not compile",
        help: "Run `nico-agent install acme/api` once it is fixed",
        at: "2026-09-30T02:10:00Z",
      },
    ]);
  });
});
