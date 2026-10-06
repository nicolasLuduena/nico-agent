import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("nico-agent --skill", () => {
  test("prints the Scheduler skill as a SKILL.md and exits 0 without touching the world", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("--skill");
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith("---\nname: nico-agent\ndescription: ");
    expect(stdout).toContain("\n---\n\n# ");
    expect(world.calls).toEqual([]);
  });

  test("top-level --help points agents at it", async () => {
    const { stdout } = await setup().cli("--help", "--json");
    expect(JSON.parse(stdout).help).toContain("Run `nico-agent --skill` to print the Scheduler skill");
  });

  describe("teaches the Scheduler's routine", () => {
    // Whitespace-normalized, so rewrapping the prose doesn't break the checks.
    const skill = async () => (await setup().cli("--skill")).stdout.replace(/\s+/g, " ");

    test("acts only through the two MCP tools, advancing every 10 minutes", async () => {
      const text = await skill();
      expect(text).toContain("`board`");
      expect(text).toContain("`advance`");
      expect(text).toMatch(/only through .*`board`.*`advance`/);
      expect(text).toContain("10 minutes");
    });

    test("works whether a monitor script already ran advance or the Scheduler runs it itself", async () => {
      const text = await skill();
      expect(text).toMatch(/monitor script/i);
      expect(text).toContain("`nico-agent advance`");
    });

    test("messages the user only when something changed", async () => {
      expect(await skill()).toMatch(/only when something changed/);
    });

    test("describes Present, Postponed and Away with their timings", async () => {
      const text = await skill();
      for (const word of ["**Present**", "**Postponed**", "**Away**"]) expect(text).toContain(word);
      expect(text).toContain("later");
      expect(text).toContain("1 hour");
      expect(text).toContain("30 minutes");
      expect(text).toMatch(/recommend/i);
      expect(text).toMatch(/candidates/);
    });

    test("starts a chosen Spec with advance's start argument", async () => {
      expect(await skill()).toMatch(/`advance` with `start`/);
    });

    test("reports Specs started while Away and Specs that become Held, with reasons", async () => {
      const text = await skill();
      expect(text).toMatch(/started while .*Away.*reason/is);
      expect(text).toMatch(/Held.*reason/s);
    });
  });
});
