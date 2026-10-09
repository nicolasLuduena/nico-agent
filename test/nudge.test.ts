import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { setup } from "./harness";

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const NUDGE = "herdr agent prompt lead Read your Inbox";
const TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = TZ;
});

/** A started Lead on claude, in the Agent state `state`, with the calls so far forgotten. */
async function lead(state = "idle") {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], lead: LAUNCH, scheduler: LAUNCH }));
  expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
  ctx.world.agentStates.set("lead", state);
  ctx.world.calls.length = 0;
  return ctx;
}

function nudges(calls: string[]) {
  return calls.filter((c) => c.startsWith(NUDGE)).map(() => NUDGE);
}

describe("say Nudges the Lead", () => {
  test("an idle Lead is prompted once to read its Inbox", async () => {
    const { cli, world } = await lead("idle");
    const { stdout, exitCode } = await cli("say", "Finish acme/api#12 first");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("warning");
    expect(nudges(world.calls)).toEqual([NUDGE]);
  });

  test("a working Lead gets one pending Nudge, which serve sends once it is idle, however many messages arrived", async () => {
    const { cli, world } = await lead("working");
    expect((await cli("serve")).exitCode).toBe(0);
    for (const text of ["one", "two", "three"]) expect((await cli("say", text)).exitCode).toBe(0);
    await world.tick();
    expect(nudges(world.calls)).toEqual([]);

    world.agentStates.set("lead", "idle");
    await world.tick();
    expect(nudges(world.calls)).toEqual([NUDGE]);
    world.agentStates.set("lead", "idle");
    await world.tick();
    expect(nudges(world.calls)).toEqual([NUDGE]);
  });

  test("a Lead herdr reports done with its turn is prompted too; a blocked one waits", async () => {
    const { cli, world } = await lead("blocked");
    await cli("say", "one");
    expect(nudges(world.calls)).toEqual([]);
    world.agentStates.set("lead", "done");
    await cli("say", "two");
    expect(nudges(world.calls)).toEqual([NUDGE]);
  });

  test("an answer to the Lead's question Nudges it too", async () => {
    const { cli, world } = await lead("working");
    expect((await cli("lead", "ask", "Close acme/api#7?", "yes", "no")).exitCode).toBe(0);
    world.agentStates.set("lead", "idle");
    expect((await cli("say", "--answer", "1", "yes")).exitCode).toBe(0);
    expect(nudges(world.calls)).toEqual([NUDGE]);
  });

  test("no Lead running: no prompt and no error, and the Inbox holds the message for its start", async () => {
    const ctx = setup();
    const { stdout, exitCode } = await ctx.cli("say", "Start the billing Spec");
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("warning");
    expect(ctx.world.calls.filter((c) => c.startsWith("herdr agent prompt"))).toEqual([]);
    expect((await ctx.cli("lead", "inbox", "--json")).json().entries).toMatchObject([{ type: "user", text: "Start the billing Spec" }]);
  });

  test("a stopped Lead gets no Nudge, and nothing is left pending for its next start", async () => {
    const { cli, world } = await lead("working");
    await cli("serve");
    await cli("say", "one");
    expect((await cli("lead", "stop")).exitCode).toBe(0);
    await world.tick();
    expect((await cli("lead", "start")).exitCode).toBe(0);
    world.agentStates.set("lead", "idle");
    await world.tick();
    expect(nudges(world.calls)).toEqual([]);
  });

  test("a Nudge that fails to send is a warning, not a failure, and serve retries it", async () => {
    const { cli, world } = await lead("idle");
    world.failHerdr("agent prompt", "herdr is not running");
    const { stdout, exitCode } = await cli("say", "--json", "--", "hello");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ said: 1, warnings: ["could not Nudge the Lead: herdr is not running"] });

    await cli("serve");
    world.clearFailures();
    world.calls.length = 0;
    await world.tick();
    expect(nudges(world.calls)).toEqual([NUDGE]);
  });
});

describe("the Nudge's text", () => {
  test("carries the local date and time, so the Lead can tell a new day began", async () => {
    process.env.TZ = "America/Argentina/Buenos_Aires";
    const { cli, world } = await lead("idle");
    world.clock = new Date("2026-10-01T02:30:00.000Z");
    await cli("say", "hello");
    expect(world.calls.filter((c) => c.startsWith(NUDGE))).toEqual([`${NUDGE} (local time: Wed 2026-09-30 23:30)`]);
  });
});

describe("a decision on a Proposal Nudges the Lead", () => {
  test("declining, approving, and an approval that fails each Nudge it once", async () => {
    const { cli, world } = await lead("idle");
    const propose = async () => (await cli("lead", "propose", "--reason", "It is done", "--json", "--", "close", "--", "acme/api#7")).json().proposed;
    const [declined, failed] = [await propose(), await propose()];
    world.calls.length = 0;

    expect((await cli("proposals", "decline", String(declined))).exitCode).toBe(0);
    expect(nudges(world.calls)).toEqual([NUDGE]);
    world.agentStates.set("lead", "idle");
    expect((await cli("proposals", "approve", String(failed))).exitCode).toBe(1);
    expect(nudges(world.calls)).toEqual([NUDGE, NUDGE]);
  });
});

describe("advance Nudges the Lead", () => {
  test("once at the end of each run, whatever it did", async () => {
    const { cli, world } = await lead("idle");
    expect((await cli("advance")).exitCode).toBe(0);
    expect(nudges(world.calls)).toEqual([NUDGE]);
    world.agentStates.set("lead", "idle");
    expect((await cli("advance")).exitCode).toBe(0);
    expect(nudges(world.calls)).toEqual([NUDGE, NUDGE]);
  });

  test("even when the run fails", async () => {
    const { cli, world, configDir } = await lead("idle");
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ repos: [], lead: LAUNCH }));
    const { stdout, exitCode } = await cli("advance");
    expect(exitCode).toBe(1);
    expect(stdout).toContain("the Scheduler defaults");
    expect(nudges(world.calls)).toEqual([NUDGE]);
  });

  test("a Nudge that fails to send is a warning in its report, not a failure", async () => {
    const { cli, world } = await lead("idle");
    world.failHerdr("agent prompt", "herdr is not running");
    const { stdout, exitCode } = await cli("advance", "--json");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).warnings).toEqual(["could not Nudge the Lead: herdr is not running"]);
  });
});
