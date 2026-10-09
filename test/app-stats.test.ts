import { describe, expect, test } from "bun:test";
import { type PrChange, append } from "../src/conversation";
import { statsCharts } from "../src/app/stats-charts";
import type { Stats } from "../src/stats";
import { setup } from "./harness";

/** acme/api and acme/web configured, the clock on 2026-09-30, with a little counted on each. */
async function counted() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  ctx.world.addClone("/src/web", "git@github.com:acme/web.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  await ctx.cli("repo", "add", "acme/web", "--path", "/src/web");
  await ctx.cli("board");
  ctx.world.addIssue("acme/api", { number: 7 });
  ctx.world.addIssue("acme/api", { number: 8 });
  ctx.world.addIssue("acme/web", { number: 1 });
  await ctx.cli("board");
  const event = (pr: string, change: PrChange, at: string) =>
    append(ctx.configDir, { type: "event", pr, issue: "acme/api#7", change, text: `${pr}: ${change}` }, new Date(at));
  await event("https://github.com/acme/api/pull/9", "check", "2026-09-28T10:00:00Z");
  await event("https://github.com/acme/api/pull/9", "merged", "2026-09-29T10:00:00Z");
  await event("https://github.com/acme/web/pull/3", "merged", "2026-09-30T08:00:00Z");
  return { ...ctx, stats: async (...args: string[]): Promise<Stats> => (await ctx.cli("stats", ...args, "--json")).json() };
}

/** A chart's last `n` days as `[day, count]`. */
const lastDays = (chart: { days: { day: string; count: number | null }[] }, n: number) => chart.days.slice(-n).map((d) => [d.day, d.count]);

describe("the Stats page's charts", () => {
  test("a chart of merged PRs and one of issues defined, over every Repo, matching `stats --json`", async () => {
    const { stats } = await counted();
    const { charts } = statsCharts(await stats("--days", "7"));

    expect(charts.map((c) => [c.metric, c.title, c.total])).toEqual([
      ["merged", "PRs merged", 2],
      ["defined", "Issues defined", 3],
    ]);
    expect(lastDays(charts[0]!, 4)).toEqual([["2026-09-27", null], ["2026-09-28", 0], ["2026-09-29", 1], ["2026-09-30", 1]]);
    expect(lastDays(charts[1]!, 2)).toEqual([["2026-09-29", null], ["2026-09-30", 3]]);
    expect(charts[0]!.days).toHaveLength(7);
  });

  test("every Repo counted can be picked, and a picked Repo's answer charts only it", async () => {
    const { stats } = await counted();
    expect(statsCharts(await stats("--days", "7")).repos).toEqual(["acme/api", "acme/web"]);

    const web = statsCharts(await stats("--days", "7", "--repo", "acme/web"));
    expect(web.repos).toEqual(["acme/web"]);
    expect(web.charts.map((c) => c.total)).toEqual([1, 1]);
    expect(lastDays(web.charts[0]!, 2)).toEqual([["2026-09-29", 0], ["2026-09-30", 1]]);
  });

  test("a picked Repo says since when it was counted, not when any Repo was", async () => {
    const { cli, world, stats } = await counted();
    world.clock = new Date(world.clock.getTime() + 24 * 60 * 60 * 1000);
    world.addClone("/src/docs", "git@github.com:acme/docs.git");
    await cli("repo", "add", "acme/docs", "--path", "/src/docs");
    await cli("board");

    expect(statsCharts(await stats("--repo", "acme/docs")).counted).toBe(
      "Counted from the PRs and issues nico-agent has seen, not the Repos' full history: merged PRs since Sep 28, issues defined since Oct 1.",
    );
  });

  test("each day is labelled, a day with no data unlike a day with none, and bars scale to the busiest day", async () => {
    const { stats } = await counted();
    const [merged, defined] = statsCharts(await stats("--days", "7")).charts;

    expect(merged!.days.slice(-4).map((d) => d.kind)).toEqual(["no-data", "zero", "count", "count"]);
    expect(merged!.days.slice(-4).map((d) => d.label)).toEqual([
      "Sep 27: no data",
      "Sep 28: no PRs merged",
      "Sep 29: 1 PR merged",
      "Sep 30: 1 PR merged",
    ]);
    expect(defined!.days.at(-1)!.label).toBe("Sep 30: 3 issues defined");
    expect([merged!.top, defined!.top]).toEqual([1, 3]);
  });

  test("a chart with nothing counted still has a scale", async () => {
    const ctx = setup();
    const { charts } = statsCharts((await ctx.cli("stats", "--days", "7", "--json")).json());

    expect(charts.map((c) => [c.total, c.top])).toEqual([[null, 1], [null, 1]]);
  });

  test("says what is counted, and since when", async () => {
    const { stats } = await counted();
    expect(statsCharts(await stats()).counted).toBe(
      "Counted from the PRs and issues nico-agent has seen, not the Repos' full history: merged PRs since Sep 28, issues defined since Sep 30.",
    );
    const none = setup();
    expect(statsCharts((await none.cli("stats", "--json")).json()).counted).toBe(
      "Counted from the PRs and issues nico-agent has seen, not the Repos' full history: nothing seen yet.",
    );
  });
});
