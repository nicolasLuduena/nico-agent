import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

/** A Repo claiming Linear team BLE, with the Scheduler defaults set. */
async function linearRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  const file = join(ctx.configDir, "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.scheduler = { harness: "claude", model: "opus", effort: "high" };
  writeFileSync(file, JSON.stringify(config));
  const queue = (spec: string) => ctx.web("/queue", { method: "POST", body: new URLSearchParams({ repo: "bleentr/pdf-diff", spec }), headers: { "hx-request": "true" } });
  const advanceNow = () => ctx.web("/advance", { method: "POST" });
  return { ...ctx, queue, advanceNow };
}

describe("Advance now on the web Board", () => {
  test("the Board's top bar has an Advance now button", async () => {
    const { web } = await linearRepo();
    const { body } = await web("/classic");
    expect(body).toContain('<form method="post" action="/advance" class="advance"><button>Advance now</button></form>');
  });

  test("it runs advance, starting a queued Spec, and shows what it did", async () => {
    const { world, queue, advanceNow, cli } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" }, { identifier: "BLE-21", title: "Tokens" });
    await queue("BLE-20");

    const { status, body } = await advanceNow();
    expect(status).toBe(200);
    expect(body).toContain("<title>Advance · nico-agent</title>");
    expect(body).toContain('<li class="started"><b>Started</b> BLE-21 of BLE-20: BLE-20 is the head of the Queue;');
    expect(body).toContain('<p><a href="/classic">Back to the Board</a></p>');
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(true);
    expect((await cli("show", "BLE-21", "--json")).exitCode).toBe(0);
  });

  test("with nothing to do, it says so", async () => {
    const { advanceNow } = await linearRepo();
    const { body } = await advanceNow();
    expect(body).toContain('<p class="empty">Nothing to do: no running Spec needs a step and no queued Spec could start.</p>');
  });

  test("an error stopping the run is shown with its help, like other Board actions", async () => {
    const { configDir, world, queue, advanceNow } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    await queue("BLE-20");
    const file = join(configDir, "config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    delete config.scheduler;
    writeFileSync(file, JSON.stringify(config));

    const { status, body } = await advanceNow();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body).toContain("the Scheduler defaults");
  });

  test("while another advance runs, the button leaves it to finish instead of racing it", async () => {
    const { configDir, world, queue, advanceNow } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    await queue("BLE-20");
    writeFileSync(join(configDir, "advance.lock"), "777");

    const { body } = await advanceNow();
    expect(body).toContain("another advance is running (pid 777); left it to finish");
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);

    // A lock left by a process that is gone doesn't stop the next run.
    world.deadPids.add(777);
    await advanceNow();
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(true);
  });
});
