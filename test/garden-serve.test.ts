import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { PR_WATCH_INTERVAL_MS as MINUTE } from "../src/pr-events";
import { setup } from "./harness";

const LAUNCH = { harness: "claude", model: "opus", effort: "high" };
const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const PR9 = "https://github.com/acme/api/pull/9";
const PR10 = "https://github.com/acme/api/pull/10";
const PR11 = "https://github.com/acme/api/pull/11";

/**
 * `serve` up with an idle Lead and acme/api's PRs watched: #9 (acme/api#7's)
 * on main, and, when `stacked`, #10 (acme/api#8's) stacked on #9's branch and
 * #11 (acme/api#12's) on main. The Gardener runs on claude.
 */
async function serving({ stacked = false } = {}) {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], lead: LAUNCH, scheduler: LAUNCH, gardener: LAUNCH }));
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  expect((await ctx.cli("repo", "add", "acme/api", "--path", "/src/api")).exitCode).toBe(0);
  const watch = async (issue: number, pr: number, base: string) => {
    ctx.world.addIssue("acme/api", { number: issue });
    expect((await ctx.cli("dispatch", `acme/api#${issue}`, ...FLAGS)).exitCode).toBe(0);
    ctx.world.linkPr("acme/api", issue, { number: pr, baseBranch: base });
    ctx.world.activity.set(`acme/api#${pr}`, { state: "open", draft: true, baseBranch: base, mergeable: "mergeable", comments: [], checks: [] });
  };
  // The stacked PR is watched, and so asked about, before the one below it.
  if (stacked) await watch(8, 10, "agent/pr-9");
  await watch(7, 9, "main");
  if (stacked) await watch(12, 11, "main");
  expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
  ctx.world.agentStates.set("lead", "idle");
  expect((await ctx.cli("serve")).exitCode).toBe(0);
  // The first tick watches the PRs as they are.
  await ctx.world.tick(MINUTE);
  ctx.world.calls.length = 0;
  return ctx;
}

/** The prompts the Gardener of acme/api was sent. */
function gardenPrompts(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr agent prompt garden-api ")).map((c) => c.slice("herdr agent prompt garden-api ".length));
}

function gardenStarts(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr worktree create") && c.includes("--branch gardener/"));
}

describe("serve starts a Gardener", () => {
  let log: string[];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    log = [];
    spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => void log.push(args.map(String).join(" ")));
  });
  afterEach(() => spy.mockRestore());

  test("on a conflict event, naming that PR and its base", async () => {
    const { world } = await serving();
    world.activity.get("acme/api#9")!.mergeable = "conflicting";
    await world.tick(MINUTE);
    expect(gardenStarts(world.calls)).toHaveLength(1);
    const [prompt] = gardenPrompts(world.calls);
    expect(prompt).toStartWith(`Tend these open PRs of acme/api: ${PR9} (it conflicts with its base main). `);
    expect(log).toContain(`garden: started the Gardener of acme/api for ${PR9}`);
  });

  test("on a merged event of a PR with open PRs stacked on it, naming those, though GitHub already retargeted them", async () => {
    const { world } = await serving({ stacked: true });
    world.activity.get("acme/api#9")!.state = "merged";
    // GitHub retargets a PR whose base branch is deleted on merge.
    world.activity.get("acme/api#10")!.baseBranch = "main";
    await world.tick(MINUTE);
    expect(gardenStarts(world.calls)).toHaveLength(1);
    const [prompt] = gardenPrompts(world.calls);
    expect(prompt).toStartWith(`Tend these open PRs of acme/api: ${PR10} (the PR below it, ${PR9}, merged; its new base is main). `);
    expect(prompt).not.toContain(PR11);
  });

  test("on a merged event of a PR with nothing stacked on it, none", async () => {
    const { world } = await serving({ stacked: true });
    world.activity.get("acme/api#11")!.state = "merged";
    await world.tick(MINUTE);
    await world.tick(MINUTE);
    expect(gardenStarts(world.calls)).toEqual([]);
    expect(log).toEqual([]);
  });

  test("while one runs in the Repo, none other: the events that arrive meanwhile start the next one once it is done", async () => {
    const { world } = await serving({ stacked: true });
    world.activity.get("acme/api#9")!.mergeable = "conflicting";
    await world.tick(MINUTE);
    expect(gardenStarts(world.calls)).toHaveLength(1);

    world.agentStates.set("garden-api", "working");
    world.activity.get("acme/api#11")!.mergeable = "conflicting";
    await world.tick(MINUTE);
    world.activity.get("acme/api#9")!.state = "merged";
    await world.tick(MINUTE);
    world.agentStates.set("garden-api", "blocked");
    await world.tick(MINUTE);
    expect(gardenStarts(world.calls)).toHaveLength(1);

    world.agentStates.set("garden-api", "done");
    world.calls.length = 0;
    await world.tick(MINUTE);
    expect(world.calls).toContain("herdr worktree remove --workspace w5");
    expect(gardenStarts(world.calls)).toHaveLength(1);
    expect(gardenPrompts(world.calls)).toEqual([
      expect.stringContaining(`Tend these open PRs of acme/api: ${PR11} (it conflicts with its base main); ${PR10} (the PR below it, ${PR9}, merged; its new base is main). `),
    ]);

    // Handed over, they wait no more: the next Gardener done, none starts.
    world.agentStates.set("garden-api", "done");
    world.calls.length = 0;
    await world.tick(MINUTE);
    expect(gardenStarts(world.calls)).toEqual([]);
  });
});
