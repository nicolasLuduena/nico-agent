import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

async function dispatched() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  await ctx.cli("dispatch", "acme/api#7", ...FLAGS);
  ctx.world.calls.length = 0;
  return ctx;
}

test("a merged PR allows closing, forgetting the Dispatch, and an idempotent re-run", async () => {
  const { cli, world } = await dispatched();
  world.linkPr("acme/api", 7, { number: 9, state: "merged" });
  const result = await cli("close", "acme/api#7");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toStartWith("closed: acme/api#7\n");
  expect(world.calls).toContain("herdr worktree remove --workspace w1");
  expect(world.calls.some((c) => c.includes("branch -"))).toBe(false);
  expect((await cli("show", "acme/api#7")).exitCode).toBe(1);
  world.calls.length = 0;
  const again = await cli("close", "acme/api#7");
  expect(again.exitCode).toBe(0);
  expect(again.stdout).toContain("already Closed (no-op)");
  expect(world.calls).toEqual([]);
});

test("a closed unmerged PR on the Dispatch branch permits closing", async () => {
  const { cli, world } = await dispatched();
  world.branchPrs.set("acme/api:agent/api-7", [{ repo: "acme/api", number: 9, url: "https://github.com/acme/api/pull/9", state: "closed", baseBranch: "main" }]);
  const result = await cli("close", "acme/api#7");
  expect(result.exitCode).toBe(0);
  expect(world.calls).toContain("herdr worktree remove --workspace w1");
});

test("an open PR allows closing without --confirm", async () => {
  const { cli, world } = await dispatched();
  world.linkPr("acme/api", 7, { number: 9 });
  expect((await cli("close", "acme/api#7")).exitCode).toBe(0);
  expect(world.calls).toContain("herdr worktree remove --workspace w1");
});

test("no PR yet requires --confirm, then closes without deleting branches", async () => {
  const { cli, world } = await dispatched();
  const refused = await cli("close", "acme/api#7", "--json");
  expect(refused.exitCode).toBe(1);
  expect(refused.json().error).toBe("acme/api#7 has no PR yet; closing requires confirmation");
  expect(refused.json().help).toContain("Run `nico-agent close acme/api#7 --confirm` to remove its workspace and forget the Dispatch");
  expect(world.calls.some((c) => c.startsWith("herdr worktree remove"))).toBe(false);
  world.calls.length = 0;
  expect((await cli("close", "acme/api#7", "--confirm")).exitCode).toBe(0);
  expect(world.calls).toEqual(["herdr worktree remove --workspace w1"]);
});

test("a Dispatch that Failed before opening a PR requires --confirm", async () => {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  ctx.world.failHerdr("tab create", "no such workspace");
  expect((await ctx.cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(1);
  expect((await ctx.cli("close", "acme/api#7")).exitCode).toBe(1);
  expect((await ctx.cli("close", "acme/api#7", "--confirm")).exitCode).toBe(0);
});

test("failed removal keeps the Dispatch and allows retry", async () => {
  const { cli, world } = await dispatched();
  world.failHerdr("worktree remove", "worktree has uncommitted changes");
  expect((await cli("close", "acme/api#7", "--confirm")).exitCode).toBe(1);
  expect((await cli("show", "acme/api#7")).exitCode).toBe(0);
  world.clearFailures();
  expect((await cli("close", "acme/api#7", "--confirm")).exitCode).toBe(0);
});

test("the web offers Close and a separate confirmation form for an unfinished Dispatch", async () => {
  const { web, world, cli } = await dispatched();
  expect((await web("/in-flight")).body).toContain('<form method="post" action="/close">');
  const form = new URLSearchParams({ issue: "acme/api#7" });
  const first = await web("/close", { method: "POST", body: form });
  expect(first.status).toBe(200);
  expect(first.body).toContain("Confirm close");
  expect(first.body).toContain('<input type="hidden" name="confirm" value="yes">');
  expect(first.body).not.toContain("window.confirm");
  expect(world.calls.some((c) => c.startsWith("herdr worktree remove"))).toBe(false);
  form.set("confirm", "yes");
  expect((await web("/close", { method: "POST", body: form })).status).toBe(303);
  expect((await cli("show", "acme/api#7")).exitCode).toBe(1);
});

test("the web closes a merged PR directly and checks current PR state instead of the Board cache", async () => {
  const { web, world } = await dispatched();
  await web("/in-flight");
  world.linkPr("acme/api", 7, { number: 9, state: "merged" });
  const result = await web("/close", { method: "POST", body: new URLSearchParams({ issue: "acme/api#7" }) });
  expect(result.status).toBe(303);
  expect((await web("/in-flight")).body).toContain("Nothing in flight.");
});

test("GitHub failures keep the Dispatch, but explicit confirmation permits closing offline", async () => {
  const { cli, world } = await dispatched();
  world.failCall("github linked prs", "GitHub request failed");
  expect((await cli("close", "acme/api#7")).exitCode).toBe(1);
  expect((await cli("show", "acme/api#7")).exitCode).toBe(0);
  expect((await cli("close", "acme/api#7", "--confirm")).exitCode).toBe(0);
});

test("closing refuses a Dispatch whose launch is still running", async () => {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  ctx.world.hangs.add("herdr tab create");
  void ctx.cli("dispatch", "acme/api#7", ...FLAGS);
  for (let i = 0; i < 100 && !ctx.world.calls.some((c) => c.startsWith("herdr tab create")); i++) await Bun.sleep(1);
  ctx.world.calls.length = 0;
  const result = await ctx.cli("close", "acme/api#7", "--confirm");
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("busy with another nico-agent");
  expect(ctx.world.calls).toEqual([]);
});

test("the real CLI forgets a Dispatch when herdr reports its workspace is already gone", async () => {
  const { cli, configDir } = await dispatched();
  const binDir = join(configDir, "fake-bin");
  mkdirSync(binDir);
  const log = join(configDir, "herdr-args");
  const herdr = join(binDir, "herdr");
  writeFileSync(herdr, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\nprintf '%s\\n' '{"error":{"code":"workspace_not_found","message":"Workspace not found."}}' >&2\nexit 1\n`);
  chmodSync(herdr, 0o755);
  const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;
  const worldPath = new URL("../src/real-world.ts", import.meta.url).pathname;
  const script = `import { run } from ${JSON.stringify(cliPath)}; import { RealWorld } from ${JSON.stringify(worldPath)};
    const result = await run(["close", "acme/api#7", "--confirm"], { world: new RealWorld(), configDir: ${JSON.stringify(configDir)}, bin: "nico-agent" });
    process.stdout.write(result.stdout); process.exitCode = result.exitCode;`;
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(output).toStartWith("closed: acme/api#7\n");
  expect(readFileSync(log, "utf8")).toBe("worktree\nremove\n--workspace\nw1\n");
  expect((await cli("show", "acme/api#7")).exitCode).toBe(1);
});
