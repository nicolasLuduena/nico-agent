import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { type PrChange, append } from "../src/conversation";
import { run } from "../src/cli";
import { FakeWorld } from "./fake-world";
import { setup } from "./harness";

const DAY = 24 * 60 * 60 * 1000;

/** acme/api configured, with the clock on 2026-09-30. */
async function withRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  expect((await ctx.cli("repo", "add", "acme/api", "--path", "/src/api")).exitCode).toBe(0);
  return ctx;
}

/** An event entry on `pr`, as `serve`'s PR watch writes it, at `at`. */
function event(configDir: string, pr: string, change: PrChange, at: string) {
  return append(configDir, { type: "event", pr, issue: "acme/api#7", change, text: `${pr}: ${change}` }, new Date(at));
}

/** The day `day` of `stats --json`'s series. */
function onDay(stats: { series: Record<string, unknown>[] }, day: string) {
  return stats.series.find((d) => d.day === day);
}

describe("nico-agent stats", () => {
  test("counts an issue as defined on the day a Board read first saw it", async () => {
    const { cli, world } = await withRepo();
    expect((await cli("board")).exitCode).toBe(0);
    world.addIssue("acme/api", { number: 7 });
    expect((await cli("board")).exitCode).toBe(0);

    const stats = (await cli("stats", "--json")).json();
    expect(onDay(stats, "2026-09-30")).toMatchObject({ defined: 1, repos: [{ repo: "acme/api", defined: 1 }] });
  });

  test("the issues a Repo's first read finds were defined before, so they are not counted on that day", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    world.addIssue("acme/api", { number: 8 });
    await cli("board");

    const stats = (await cli("stats", "--json")).json();
    expect(onDay(stats, "2026-09-30")).toMatchObject({ defined: 0 });
    expect(stats.countedSince.defined).toBe("2026-09-30");
  });

  test("a Repo's Linear issues start counting from Linear's own first read", async () => {
    const ctx = setup();
    ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
    await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
    ctx.world.linearFailure = "Linear is down";
    await ctx.cli("board");
    ctx.world.clock = new Date(ctx.world.clock.getTime() + DAY);
    ctx.world.linearFailure = null;
    ctx.world.addLinearIssue({ identifier: "BLE-1" });
    await ctx.cli("board");
    ctx.world.addLinearIssue({ identifier: "BLE-2" });
    await ctx.cli("board");

    const stats = (await ctx.cli("stats", "--json")).json();
    expect(onDay(stats, "2026-10-01")).toMatchObject({ defined: 1 });
  });

  test("counts each issue once, on its first day, across reads on later days", async () => {
    const { cli, world } = await withRepo();
    await cli("board");
    world.addIssue("acme/api", { number: 7 });
    await cli("board");
    world.clock = new Date(world.clock.getTime() + 2 * DAY);
    world.addIssue("acme/api", { number: 8 });
    await cli("board");
    await cli("board");

    const stats = (await cli("stats", "--json")).json();
    expect(onDay(stats, "2026-09-30")).toMatchObject({ defined: 1 });
    expect(onDay(stats, "2026-10-01")).toMatchObject({ defined: 0 });
    expect(onDay(stats, "2026-10-02")).toMatchObject({ defined: 1 });
    expect(stats.total).toMatchObject({ defined: 2 });
  });

  test("keeps the record across restarts: a new process counts the same issues once", async () => {
    const { cli, configDir, world } = await withRepo();
    await cli("board");
    world.addIssue("acme/api", { number: 7 });
    await cli("board");

    const restarted = new FakeWorld();
    restarted.clock = new Date("2026-10-01T09:00:00Z");
    restarted.addIssue("acme/api", { number: 7 });
    const again = (...argv: string[]) => run(argv, { world: restarted, configDir, bin: "nico-agent" });
    expect((await again("board")).exitCode).toBe(0);

    const stats = JSON.parse((await again("stats", "--json")).stdout);
    expect(onDay(stats, "2026-09-30")).toMatchObject({ defined: 1 });
    expect(onDay(stats, "2026-10-01")).toMatchObject({ defined: 0 });
  });

  test("the Scheduler's Board read records issues too", async () => {
    const { cli, configDir, world } = await withRepo();
    const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ ...config, scheduler: { harness: "claude", model: "opus", effort: "high" } }));
    expect((await cli("advance")).exitCode).toBe(0);
    world.addIssue("acme/api", { number: 7 });
    expect((await cli("advance")).exitCode).toBe(0);

    expect(onDay((await cli("stats", "--json")).json(), "2026-09-30")).toMatchObject({ defined: 1 });
  });

  test("marks the days before the first Board read as no data, not zero", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    await cli("board");

    const stats = (await cli("stats", "--json")).json();
    expect(stats).toMatchObject({ from: "2026-09-01", to: "2026-09-30", days: 30, countedSince: { defined: "2026-09-30", merged: null } });
    expect(stats.series).toHaveLength(30);
    expect(onDay(stats, "2026-09-29")).toEqual({ day: "2026-09-29", merged: null, defined: null, repos: [{ repo: "acme/api", merged: null, defined: null }] });
  });

  test("counts each merged PR once, on the day of its merged event, per Repo", async () => {
    const { cli, configDir, world } = await withRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    await event(configDir, "https://github.com/acme/api/pull/9", "check", "2026-09-27T10:00:00Z");
    await event(configDir, "https://github.com/acme/api/pull/9", "merged", "2026-09-28T10:00:00Z");
    // Seen merged again, as after a watch restarted: still one merge.
    await event(configDir, "https://github.com/acme/api/pull/9", "merged", "2026-09-29T10:00:00Z");
    await event(configDir, "https://github.com/acme/web/pull/3", "merged", "2026-09-28T23:59:00Z");
    await event(configDir, "https://github.com/acme/web/pull/4", "closed", "2026-09-28T12:00:00Z");

    const stats = (await cli("stats", "--json")).json();
    expect(stats.countedSince.merged).toBe("2026-09-27");
    expect(onDay(stats, "2026-09-26")).toMatchObject({ merged: null });
    expect(onDay(stats, "2026-09-27")).toMatchObject({ merged: 0 });
    expect(onDay(stats, "2026-09-28")).toMatchObject({ merged: 2, repos: [{ repo: "acme/api", merged: 1 }, { repo: "acme/web", merged: 1 }] });
    expect(onDay(stats, "2026-09-29")).toMatchObject({ merged: 0 });
    expect(stats.total).toMatchObject({ merged: 2, repos: [{ repo: "acme/api", merged: 1 }, { repo: "acme/web", merged: 1 }] });
  });

  test("--days and --repo narrow the series", async () => {
    const { cli, configDir, world } = await withRepo();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    await cli("board");
    world.addIssue("acme/api", { number: 7 });
    world.addIssue("acme/web", { number: 1 });
    await cli("board");
    await event(configDir, "https://github.com/acme/web/pull/3", "merged", "2026-09-30T08:00:00Z");

    const stats = (await cli("stats", "--days", "2", "--repo", "ACME/web", "--json")).json();
    expect(stats).toMatchObject({ from: "2026-09-29", to: "2026-09-30", days: 2 });
    expect(stats.series).toEqual([
      { day: "2026-09-29", merged: null, defined: null, repos: [{ repo: "acme/web", merged: null, defined: null }] },
      { day: "2026-09-30", merged: 1, defined: 1, repos: [{ repo: "acme/web", merged: 1, defined: 1 }] },
    ]);
    expect(stats.total).toEqual({ merged: 1, defined: 1, repos: [{ repo: "acme/web", merged: 1, defined: 1 }] });
  });

  test("refuses a --days that is not a whole number of days, and a --repo that is not owner/name", async () => {
    const { cli } = await withRepo();
    for (const args of [["--days", "0"], ["--days", "1.5"], ["--days", "week"], ["--repo", "api"]]) {
      const result = await cli("stats", ...args, "--json");
      expect(result.exitCode).toBe(2);
      expect(result.json().help).toEqual(["Usage: `nico-agent stats [--days <n>] [--repo <owner/name>]`"]);
    }
  });

  test("refuses a --repo that is neither configured nor counted before", async () => {
    const { cli } = await withRepo();
    const result = await cli("stats", "--repo", "acme/typo", "--json");
    expect(result.exitCode).toBe(1);
    expect(result.json()).toEqual({ error: "acme/typo is not a configured Repo, and nico-agent has counted nothing for it", help: ["Run `nico-agent repo list` to see the Repos"] });
  });

  test("reads nothing from GitHub", async () => {
    const { cli, configDir, world } = await withRepo();
    world.addIssue("acme/api", { number: 7 });
    await cli("board");
    await event(configDir, "https://github.com/acme/api/pull/9", "merged", "2026-09-30T08:00:00Z");
    world.calls.length = 0;

    expect((await cli("stats")).exitCode).toBe(0);
    expect(world.calls).toEqual([]);
  });
});

describe("/api/stats", () => {
  test("is `stats --json`, narrowed by days and repo in the query", async () => {
    const { cli, configDir, web, world } = await withRepo();
    await cli("board");
    world.addIssue("acme/api", { number: 7 });
    await cli("board");
    await event(configDir, "https://github.com/acme/api/pull/9", "merged", "2026-09-30T08:00:00Z");

    const all = await web("/api/stats");
    expect(all.status).toBe(200);
    expect(all.type).toBe("application/json; charset=utf-8");
    expect(JSON.parse(all.body)).toEqual((await cli("stats", "--json")).json());

    const narrowed = await web("/api/stats?days=7&repo=acme/api");
    expect(JSON.parse(narrowed.body)).toEqual((await cli("stats", "--days", "7", "--repo", "acme/api", "--json")).json());
  });

  test("a bad query is the CLI's usage error", async () => {
    const { web } = await withRepo();
    const { status, body } = await web("/api/stats?days=none");
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toBe("--days must be a whole number from 1 to 366 (got `none`)");
  });
});
