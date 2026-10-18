import { describe, expect, it } from "vitest";
import type { Dispatch, Repo, Run, Status } from "./status";
import { needsYou } from "./toasts";

const status = (dispatches: Partial<Dispatch>[], githubPausedUntil: string | null = null): Status => ({
  projects: [],
  repos: [],
  rate_limits: {},
  sources: { github: { paused_until: githubPausedUntil }, linear: { paused_until: null } },
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

describe("the notices", () => {
  it("are none when nothing needs you, and none for what has a node to flag: an Asking, a Failed or Verified Dispatch, a blocked faux-nico", () => {
    const asking = { since: "2026-09-30T04:12:00Z", question: "Keep the v1 route?" };
    const flagged = status([
      { asking, faux_nico: { agent: "faux-nico-api-7", blocked_since: "2026-09-30T04:20:00Z" } },
      { issue: "acme/api#8", stage: "Failed" },
      { issue: "acme/api#9", stage: "Verified", verdict: { result: "pass", sha: "4f2a9c1", at: "2026-09-30T05:02:00Z" } },
    ]);

    expect(needsYou(flagged)).toEqual([]);
  });

  it("list each blocked agent of the loop with no node, by the name to take it over with, as of its block", () => {
    const blocked = (agent: string, at: string): Run => ({ agent, blocked_since: at });
    const loop: Status = {
      ...status([]),
      repos: [{ slug: "acme/api", last_scan: blocked("quality-scan-api", "2026-09-30T03:10:00Z") } as Repo],
      morning: blocked("morning", "2026-09-30T07:10:00Z"),
    };

    expect(needsYou(loop)).toEqual([
      { kind: "Blocked", repo: "acme/api", text: "quality-scan-api", at: "2026-09-30T03:10:00Z" },
      { kind: "Blocked", repo: null, text: "morning", at: "2026-09-30T07:10:00Z" },
    ]);
  });

  it("list no agent of the loop that is not blocked", () => {
    const quiet: Status = {
      ...status([]),
      repos: [{ slug: "acme/api", last_scan: { agent: "quality-scan-api" } } as Repo],
      morning: { agent: "morning" },
    };

    expect(needsYou(quiet)).toEqual([]);
  });

  it("list GitHub paused, until when, last", () => {
    const paused: Status = {
      ...status([], "2026-09-30T13:00:00Z"),
      repos: [{ slug: "acme/api", last_scan: { agent: "quality-scan-api", blocked_since: "2026-09-30T03:10:00Z" } } as Repo],
    };

    expect(needsYou(paused)).toEqual([
      { kind: "Blocked", repo: "acme/api", text: "quality-scan-api", at: "2026-09-30T03:10:00Z" },
      { kind: "Paused", repo: null, text: "GitHub", at: "2026-09-30T13:00:00Z" },
    ]);
  });

  it("list one notice per Repo with a failing Readiness check: what each failing one says, where to fix them, since when", () => {
    const check = (name: string, ok: boolean, said: string, help: string | null = null) => ({ name, ok, said, help });
    const checked: Status = {
      ...status([]),
      repos: [
        {
          slug: "acme/api",
          checks: {
            at: "2026-09-30T07:00:00Z",
            results: [
              check("clone", true, "/src/api is a clone of acme/api"),
              check("skills", false, "no verdict skill for codex, the Reviewer's Harness", "Install verdict in one of ~/.agents/skills"),
              check("bot", false, "could not check the GitHub App on acme/api", "Run `gh auth login`"),
            ],
          },
        } as Repo,
        { slug: "acme/web", checks: { at: "2026-09-30T07:05:00Z", results: [check("herdr", false, "herdr is not running")] } } as Repo,
        { slug: "acme/cli", checks: { at: "2026-09-30T07:05:00Z", results: [check("clone", true, "fine")] } } as Repo,
        { slug: "acme/docs" } as Repo,
      ],
    };

    const fix = "Readiness, under Repos";
    expect(needsYou(checked)).toEqual([
      {
        kind: "Check",
        repo: "acme/api",
        checks: ["no verdict skill for codex, the Reviewer's Harness", "could not check the GitHub App on acme/api"],
        help: fix,
        at: "2026-09-30T07:00:00Z",
      },
      { kind: "Check", repo: "acme/web", checks: ["herdr is not running"], help: fix, at: "2026-09-30T07:05:00Z" },
    ]);
  });

  it("list a failed or refused Install with its Repo, its output's last line and the command to run it again, and not one that went fine", () => {
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
        text: "error: could not compile",
        help: "Run `nico-agent install acme/api` once it is fixed",
        at: "2026-09-30T02:10:00Z",
      },
    ]);
  });
});
