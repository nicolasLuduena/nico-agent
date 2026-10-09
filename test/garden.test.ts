import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const MODEL = "opencode-go/deepseek-v4.1-flash";
const TRAILER =
  "Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>";
const BOT_SUFFIX = `, posting each comment with \`ghbot pr comment\` (not \`gh\`); end every commit message you write with the trailer \`${TRAILER}\``;
const RULES =
  "Never merge, close or approve a PR: that stays the user's decision. " +
  "Check out each PR's branch here; after the PR below it merged, rebase it onto its new base and retarget the PR there; " +
  "resolve each conflict with its base; run the Repo's checks; and push the fixed branch with `git push --force-with-lease`. " +
  "When a conflict needs a judgment you can't make from the code and the PRs, ask the user instead of guessing. " +
  "Comment on each PR you changed saying what you did";

/** A Repo acme/api, with opencode2's saved-variant file in a temp dir and `extra` in config. */
async function withRepo(extra: Record<string, unknown> = {}) {
  const ctx = setup();
  const variantFile = join(mkdtempSync(join(tmpdir(), "nico-agent-state-")), "opencode", "model.json");
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  const file = join(ctx.configDir, "config.json");
  const { harnesses, ...rest } = extra as { harnesses?: Record<string, object> };
  writeFileSync(file, JSON.stringify({
    ...JSON.parse(readFileSync(file, "utf8")),
    harnesses: { ...harnesses, opencode2: { variantFile, ...harnesses?.opencode2 } },
    ...rest,
  }));
  ctx.world.calls.length = 0;
  return { ...ctx, variantFile };
}

function herdrCalls(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr "));
}

function prompts(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr agent prompt ")).map((c) => c.slice("herdr agent prompt garden-api ".length));
}

describe("garden", () => {
  test("on the default launch: a worktree workspace of the Repo, opencode2 at max Effort, prompted with the garden prompt and the Bot suffix", async () => {
    const { cli, world, variantFile } = await withRepo();
    world.appRepos = ["acme/api"];
    const { json, exitCode } = await cli("garden", "acme/api", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toMatchObject({ gardener: "started", repo: "acme/api", workspace: "w1", agent: "garden-api", harness: "opencode2", model: MODEL, effort: "max" });
    const config = JSON.stringify({ model: `${MODEL}#max`, agents: { build: { model: `${MODEL}#max` } } });
    expect(herdrCalls(world.calls)).toEqual([
      "herdr worktree create --cwd /src/api --branch gardener/api-20260930120000 --base origin/main --label api:gardener --no-focus",
      "herdr tab create --workspace w1 --cwd /worktrees/api-20260930120000 --label gardener --no-focus",
      `herdr pane run w1:p2 env OPENCODE_CONFIG_CONTENT='${config}' opencode2 --standalone`,
      "herdr agent detect w1:p2 --timeout 30000",
      "herdr agent rename w1:p2 garden-api",
      "herdr agent read garden-api --source visible",
      "herdr agent wait garden-api --until idle --until done --timeout 5000",
      `herdr agent prompt garden-api Tend these open PRs of acme/api: every open PR of acme/api that conflicts with its base, or whose PR below it merged. ${RULES}${BOT_SUFFIX}`,
    ]);
    expect(JSON.parse(readFileSync(variantFile, "utf8")).variant).toEqual({ [MODEL]: "max" });
  });
});

describe("garden again", () => {
  test("while the Gardener runs: returns it, with no herdr changes", async () => {
    const { cli, world } = await withRepo();
    await cli("garden", "acme/api");
    world.calls.length = 0;
    const { json, exitCode } = await cli("garden", "acme/api", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toMatchObject({ gardener: "already running (no-op)", repo: "acme/api", workspace: "w1", agent: "garden-api" });
    expect(herdrCalls(world.calls)).toEqual(["herdr agent list"]);
  });

  test("while it runs, other PRs are no GitHub call and no refusal: the running one is returned", async () => {
    const { cli, world } = await withRepo();
    await cli("garden", "acme/api");
    world.calls.length = 0;
    const { json, exitCode } = await cli("garden", "acme/api", "--pr", "https://github.com/acme/api/pull/99", "--json");
    expect(exitCode).toBe(0);
    expect(json().gardener).toBe("already running (no-op)");
    expect(world.calls.filter((c) => c.startsWith("github "))).toEqual([]);
  });

  test("while it asks the user: still the running one", async () => {
    const { cli, world } = await withRepo();
    await cli("garden", "acme/api");
    world.agentStates.set("garden-api", "blocked");
    expect((await cli("garden", "acme/api", "--json")).json().gardener).toBe("already running (no-op)");
  });

  test("once it is done: its workspace is removed and a new one started", async () => {
    const { cli, world } = await withRepo();
    await cli("garden", "acme/api");
    world.agentStates.set("garden-api", "done");
    world.calls.length = 0;
    const { json } = await cli("garden", "acme/api", "--json");
    expect(json()).toMatchObject({ gardener: "started", workspace: "w2" });
    expect(herdrCalls(world.calls).slice(0, 3)).toEqual([
      "herdr agent list",
      "herdr worktree remove --workspace w1",
      "herdr worktree create --cwd /src/api --branch gardener/api-20260930120000 --base origin/main --label api:gardener --no-focus",
    ]);
  });

  test("after a failed step: refused with how to resume, and the next run resumes from that step", async () => {
    const { cli, world } = await withRepo();
    world.failHerdr("tab create", "no such workspace");
    const failed = await cli("garden", "acme/api", "--json");
    expect(failed.exitCode).toBe(1);
    expect(failed.json()).toEqual({
      error: "the Gardener of acme/api failed at tab: no such workspace",
      help: ["Run `nico-agent --json` to see the Gardeners", "Run `nico-agent garden acme/api` again to resume from tab"],
    });
    world.clearFailures();
    world.calls.length = 0;
    const { json, exitCode } = await cli("garden", "acme/api", "--json");
    expect(exitCode).toBe(0);
    expect(json().gardener).toBe("resumed from tab");
    expect(herdrCalls(world.calls)[0]).toBe("herdr tab create --workspace w1 --cwd /worktrees/api-20260930120000 --label gardener --no-focus");
  });
});

describe("garden --pr", () => {
  test("names each PR and what happened: the PR below it merged, or it conflicts", async () => {
    const { cli, world } = await withRepo();
    world.addPr({ repo: "acme/api", number: 11, state: "merged", baseBranch: "main", headBranch: "agent/api-1" });
    world.addPr({ repo: "acme/api", number: 12, baseBranch: "agent/api-1", headBranch: "agent/api-2" });
    world.addPr({ repo: "acme/api", number: 13, baseBranch: "main", headBranch: "agent/api-3" });
    const { exitCode } = await cli("garden", "acme/api", "--pr", "https://github.com/acme/api/pull/12", "--pr", "https://github.com/acme/api/pull/13");
    expect(exitCode).toBe(0);
    expect(prompts(world.calls)).toEqual([
      "Tend these open PRs of acme/api: https://github.com/acme/api/pull/12 (the PR below it, https://github.com/acme/api/pull/11, merged; its new base is main); " +
        `https://github.com/acme/api/pull/13 (it conflicts with its base main). ${RULES}`,
    ]);
  });

  test("a PR of another Repo, or one not open, is refused before any herdr call", async () => {
    const { cli, world } = await withRepo();
    const other = await cli("garden", "acme/api", "--pr", "https://github.com/acme/web/pull/3", "--json");
    expect(other.exitCode).toBe(2);
    expect(other.json().error).toBe("`https://github.com/acme/web/pull/3` is not a PR of acme/api");
    world.addPr({ repo: "acme/api", number: 11, state: "merged" });
    const merged = await cli("garden", "acme/api", "--pr", "https://github.com/acme/api/pull/11", "--json");
    expect(merged.exitCode).toBe(1);
    expect(merged.json().error).toBe("https://github.com/acme/api/pull/11 is merged; the Gardener tends open PRs only");
    expect(herdrCalls(world.calls)).toEqual([]);
  });

  test("a Repo that is not configured is refused", async () => {
    const { cli } = await withRepo();
    const { json, exitCode } = await cli("garden", "acme/web", "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe("acme/web is not a configured Repo");
  });
});

describe("the gardener launch and garden template", () => {
  test("the gardener launch in config replaces the defaults one by one", async () => {
    const { cli, world } = await withRepo({ gardener: { harness: "claude", model: "sonnet" }, harnesses: { claude: { efforts: ["low", "max"] } } });
    expect((await cli("garden", "acme/api")).exitCode).toBe(0);
    expect(world.calls).toContain("herdr agent start garden-api --kind claude --pane w1:p2 -- --model sonnet --effort max");
  });

  test("a bad gardener launch is named as the config's fault, before any herdr call", async () => {
    const { cli, world, configDir } = await withRepo({ gardener: { model: "gpt" } });
    const { json, exitCode } = await cli("garden", "acme/api", "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe(`gardener.model in ${join(configDir, "config.json")}: unknown model \`gpt\` for opencode2`);
    expect(herdrCalls(world.calls)).toEqual([]);
  });

  test("an unknown gardener key is a config error", async () => {
    const { cli, configDir } = await withRepo({ gardener: { repo: "acme/api" } });
    const { json, exitCode } = await cli("garden", "acme/api", "--json");
    expect(exitCode).toBe(1);
    expect(json()).toEqual({ error: `${join(configDir, "config.json")}: gardener.repo is not a Gardener default`, help: ["Gardener defaults: harness, model, effort"] });
  });

  test("the garden template from config, with its {repo} and {prs}", async () => {
    const { cli, world } = await withRepo({ prompts: { garden: "{sigil}garden {repo}: {prs}" } });
    expect((await cli("garden", "acme/api")).exitCode).toBe(0);
    expect(prompts(world.calls)).toEqual(["@garden acme/api: every open PR of acme/api that conflicts with its base, or whose PR below it merged"]);
  });

  test("an unknown placeholder in the garden template is a config error", async () => {
    const { cli, configDir } = await withRepo({ prompts: { garden: "garden {issueUrls}" } });
    const { json, exitCode } = await cli("garden", "acme/api", "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe(`${join(configDir, "config.json")}: prompts.garden has an unknown placeholder {issueUrls}`);
  });
});

describe("Gardeners on the Board", () => {
  test("board --json lists each Gardener with its Agent state and PRs", async () => {
    const { cli, world } = await withRepo();
    world.addPr({ repo: "acme/api", number: 13 });
    await cli("garden", "acme/api", "--pr", "https://github.com/acme/api/pull/13");
    const { json } = await cli("board", "--json");
    expect(json().gardeners).toEqual([{
      repo: "acme/api",
      agent: "garden-api",
      state: "working",
      prs: ["https://github.com/acme/api/pull/13"],
      workspace: "w1",
      harness: "opencode2",
      model: MODEL,
      effort: "max",
    }]);
  });

  test("advance removes a finished Gardener's workspace and forgets it; a working one stays", async () => {
    const { cli, world } = await withRepo({ scheduler: { harness: "claude", model: "opus", effort: "high" } });
    await cli("garden", "acme/api");
    expect((await cli("advance", "--json")).json().gardeners).toBeUndefined();
    expect(world.calls).not.toContain("herdr worktree remove --workspace w1");
    world.agentStates.set("garden-api", "idle");
    const { json } = await cli("advance", "--json");
    expect(json().gardeners).toEqual(["acme/api"]);
    expect(world.calls).toContain("herdr worktree remove --workspace w1");
    expect((await cli("board", "--json")).json().gardeners).toBeUndefined();
  });
});
