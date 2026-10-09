import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { PR_WATCH_INTERVAL_MS as MINUTE } from "../src/pr-events";
import { setup } from "./harness";

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const PR = "https://github.com/acme/api/pull/9";
const NUDGE = "herdr agent prompt lead Read your Inbox";

/** `serve` up with an idle Lead, acme/api#7 In flight with its draft PR #9, and the calls so far forgotten. */
async function serving() {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], lead: LAUNCH, scheduler: LAUNCH }));
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  expect((await ctx.cli("repo", "add", "acme/api", "--path", "/src/api")).exitCode).toBe(0);
  ctx.world.addIssue("acme/api", { number: 7 });
  expect((await ctx.cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
  ctx.world.linkPr("acme/api", 7, { number: 9 });
  ctx.world.activity.set("acme/api#9", { state: "open", draft: true, comments: [], checks: [] });
  expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
  ctx.world.agentStates.set("lead", "idle");
  expect((await ctx.cli("serve")).exitCode).toBe(0);
  ctx.world.calls.length = 0;
  return ctx;
}

/** The `event` entries of the conversation, as `nico-agent lead log --json` shows them. */
async function logged(cli: ReturnType<typeof setup>["cli"]) {
  const { entries } = (await cli("lead", "log", "--json")).json() as { entries: Record<string, unknown>[] };
  return entries.filter((e) => e.type === "event");
}

describe("PR events", () => {
  let log: string[];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    log = [];
    spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => void log.push(args.map(String).join(" ")));
  });
  afterEach(() => spy.mockRestore());

  test("one tick writes one event per review comment and check result, a second tick none, a new comment one more", async () => {
    const { cli, world } = await serving();
    world.activity.set("acme/api#9", {
      state: "open",
      draft: true,
      comments: [
        { id: "c1", author: "alice", at: "2026-09-30T11:00:00Z", body: "Use a Map here.\nIt is faster.", path: "src/retry.ts" },
        { id: "r1", author: "bob", at: "2026-09-30T11:05:00Z", body: "The retry loop never ends", review: "changes requested" },
      ],
      checks: [{ name: "test", result: "failed" }, { name: "lint", result: "passed" }, { name: "build", result: "pending" }],
    });

    await world.tick(MINUTE);
    const first = await logged(cli);
    expect(first).toEqual([
      { id: 1, who: "nico-agent", at: "2026-09-30T12:01:00.000Z", type: "event", pr: PR, issue: "acme/api#7", change: "comment", text: `${PR}: alice commented on src/retry.ts: "Use a Map here."` },
      { id: 2, who: "nico-agent", at: "2026-09-30T12:01:00.000Z", type: "event", pr: PR, issue: "acme/api#7", change: "review", text: `${PR}: bob requested changes: "The retry loop never ends"` },
      { id: 3, who: "nico-agent", at: "2026-09-30T12:01:00.000Z", type: "event", pr: PR, issue: "acme/api#7", change: "check", text: `${PR}: check test failed` },
      { id: 4, who: "nico-agent", at: "2026-09-30T12:01:00.000Z", type: "event", pr: PR, issue: "acme/api#7", change: "check", text: `${PR}: check lint passed` },
    ]);
    expect(world.calls.filter((c) => c.startsWith(NUDGE))).toHaveLength(1);

    await world.tick(MINUTE);
    expect(await logged(cli)).toHaveLength(4);

    world.activity.get("acme/api#9")!.comments.push({ id: "c2", author: "alice", at: "2026-09-30T12:01:30Z", body: "Thanks!" });
    await world.tick(MINUTE);
    const third = await logged(cli);
    expect(third).toHaveLength(5);
    expect(third[4]).toMatchObject({ change: "comment", text: `${PR}: alice commented: "Thanks!"` });
    expect(log).toEqual([]);
  });

  test("a comment is quoted by its first line of text, past HTML comments and blank lines, and cut when long", async () => {
    const { cli, world } = await serving();
    world.activity.get("acme/api#9")!.comments.push(
      { id: "c1", author: "coderabbitai", at: "2026-09-30T11:00:00Z", body: "<!-- This is an auto-generated comment\nby a bot -->\n\n## Walkthrough\nMore." },
      { id: "c2", author: "alice", at: "2026-09-30T11:01:00Z", body: "x".repeat(200) },
    );
    await world.tick(MINUTE);
    expect((await logged(cli)).map((e) => e.text)).toEqual([
      `${PR}: coderabbitai commented: "## Walkthrough"`,
      `${PR}: alice commented: "${"x".repeat(119)}…"`,
    ]);
  });

  test("checks of the same name count as one: failed if any failed, else pending while any runs", async () => {
    const { cli, world } = await serving();
    const activity = world.activity.get("acme/api#9")!;
    activity.checks.push({ name: "test", result: "passed" }, { name: "test", result: "failed" });
    await world.tick(MINUTE);
    await world.tick(MINUTE);
    expect((await logged(cli)).map((e) => e.text)).toEqual([`${PR}: check test failed`]);

    activity.checks[1]!.result = "pending";
    await world.tick(MINUTE);
    activity.checks[1]!.result = "passed";
    await world.tick(MINUTE);
    expect((await logged(cli)).map((e) => e.text)).toEqual([`${PR}: check test failed`, `${PR}: check test passed`]);
  });

  test("a PR already ready for review when first seen writes no ready event", async () => {
    const { cli, world } = await serving();
    world.activity.get("acme/api#9")!.draft = false;
    await world.tick(MINUTE);
    expect(await logged(cli)).toEqual([]);
  });

  test("the Lead reads events in its Inbox, each once", async () => {
    const { cli, world } = await serving();
    world.activity.get("acme/api#9")!.checks.push({ name: "test", result: "failed" });
    await world.tick(MINUTE);

    const inbox = (await cli("lead", "inbox", "--json")).json();
    expect(inbox.entries).toEqual([{ id: 1, at: "2026-09-30T12:01:00.000Z", type: "event", pr: PR, issue: "acme/api#7", change: "check", text: `${PR}: check test failed` }]);
    expect((await cli("lead", "inbox", "--json")).json().entries).toEqual([]);
  });

  test("a check that passes after failing, ready for review, and merged are each one event, and a merged PR is no longer watched", async () => {
    const { cli, world } = await serving();
    const activity = world.activity.get("acme/api#9")!;
    activity.checks.push({ name: "test", result: "failed" });
    await world.tick(MINUTE);

    activity.checks[0]!.result = "pending";
    await world.tick(MINUTE);
    activity.checks[0]!.result = "passed";
    activity.draft = false;
    await world.tick(MINUTE);
    activity.state = "merged";
    // The issue's PR lookup may still see it open for a while.
    await world.tick(MINUTE);

    expect((await logged(cli)).map((e) => e.text)).toEqual([
      `${PR}: check test failed`,
      `${PR}: ready for review`,
      `${PR}: check test passed`,
      `${PR}: merged`,
    ]);
    world.linkedPrs.get("acme/api#7")![0]!.state = "merged";
    world.calls.length = 0;
    await world.tick(MINUTE);
    expect(world.calls.filter((c) => c.startsWith("github pr activity"))).toEqual([]);
    expect(await logged(cli)).toHaveLength(4);
  });

  test("a PR stays watched after its Dispatch is Closed, until it is closed", async () => {
    const { cli, world } = await serving();
    await world.tick(MINUTE);
    expect((await cli("close", "acme/api#7")).exitCode).toBe(0);

    world.activity.get("acme/api#9")!.state = "closed";
    await world.tick(MINUTE);
    expect(await logged(cli)).toMatchObject([{ change: "closed", text: `${PR}: closed without merging` }]);
  });

  test("a PR GitHub cannot be asked about is logged, and the next tick tries again", async () => {
    const { cli, world } = await serving();
    world.activity.get("acme/api#9")!.checks.push({ name: "test", result: "failed" });
    world.failCall("github pr activity", "GitHub rate limit exceeded; try again later");
    await world.tick(MINUTE);
    expect(log).toEqual([`PR events: ${PR}: GitHub rate limit exceeded; try again later`]);
    expect(await logged(cli)).toEqual([]);

    world.clearFailures();
    await world.tick(MINUTE);
    expect(await logged(cli)).toHaveLength(1);
  });
});
