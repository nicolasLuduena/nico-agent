import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const prompts = (calls: string[]) => calls.filter((c) => c.startsWith("herdr agent prompt lead"));

/** A started, idle Lead on claude, with the calls so far forgotten. */
async function lead() {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], lead: LAUNCH, scheduler: LAUNCH }));
  expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
  ctx.world.agentStates.set("lead", "idle");
  ctx.world.calls.length = 0;
  return ctx;
}

describe("Voice on", () => {
  test("is off until turned on, and back off; turning it to what it is is a no-op", async () => {
    const { cli } = setup();
    expect((await cli("voice", "--json")).json()).toMatchObject({ voice: "off" });

    expect((await cli("voice", "on", "--json")).json()).toMatchObject({ voice: "on" });
    expect((await cli("voice", "--json")).json()).toMatchObject({ voice: "on" });
    expect((await cli("voice", "on", "--json")).json()).toMatchObject({ voice: "already on (no-op)" });

    expect((await cli("voice", "off", "--json")).json()).toMatchObject({ voice: "off" });
    expect((await cli("voice", "--json")).json()).toMatchObject({ voice: "off" });
  });

  test("the Nudge carries it, so the Lead knows to talk for the ear", async () => {
    const { cli, world } = await lead();
    await cli("say", "What is running?");
    expect(prompts(world.calls)).toEqual(["herdr agent prompt lead Read your Inbox"]);

    await cli("voice", "on");
    world.agentStates.set("lead", "idle");
    await cli("say", "And now?");
    expect(prompts(world.calls).at(-1)).toBe("herdr agent prompt lead Read your Inbox (voice on)");
  });

  test("the app turns it on and off, and reads it", async () => {
    const { web } = setup();
    const post = (path: string) => web(path, { method: "POST", body: "{}" });

    expect((await post("/api/voice/on")).status).toBe(200);
    expect(JSON.parse((await web("/api/voice/state")).body)).toMatchObject({ voice: "on" });
    expect((await post("/api/voice/off")).status).toBe(200);
    expect(JSON.parse((await web("/api/voice/state")).body)).toMatchObject({ voice: "off" });
  });
});
