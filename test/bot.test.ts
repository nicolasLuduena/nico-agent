import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./harness";

async function withRepo(slug = "acme/api", path = "/src/api") {
  const ctx = setup();
  ctx.world.addClone(path, `git@github.com:${slug}.git`);
  await ctx.cli("repo", "add", slug, "--path", path);
  ctx.world.addIssue(slug, { number: 7 });
  ctx.world.calls.length = 0;
  return ctx;
}

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const TRAILER =
  "Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>";
const PLAIN = "/implement https://github.com/acme/api/issues/7 as draft PR";
const WITH_BOT = `${PLAIN}, opened with \`ghbot pr create\` (not \`gh\`); end every commit message with the trailer \`${TRAILER}\``;

function prompts(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr agent prompt ")).map((c) => c.slice("herdr agent prompt impl-api-7 ".length));
}

/** Write `config.json` with the Repos `repo add` recorded plus `extra`. */
function editConfig(configDir: string, extra: object) {
  const file = join(configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...extra }));
}

describe("bot-aware implement prompt", () => {
  test("the GitHub App installed on the Repo adds the bot suffix to the prompt", async () => {
    const { cli, world } = await withRepo();
    world.appRepos = ["other/thing", "Acme/API"];

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(prompts(world.calls)).toEqual([WITH_BOT]);
    expect(world.calls.indexOf("github app repos")).toBe(world.calls.findIndex((c) => c.startsWith("herdr agent prompt")) - 1);
    expect(stdout).not.toContain("warning");
    expect((await cli("show", "acme/api#7", "--json")).json().bot).toBe(true);
  });

  test("the App not installed on the Repo leaves the prompt plain, without a warning", async () => {
    const { cli, world } = await withRepo();
    world.appRepos = ["other/thing"];

    const { stdout } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(prompts(world.calls)).toEqual([PLAIN]);
    expect(stdout).not.toContain("warning");
    expect((await cli("show", "acme/api#7", "--json")).json().bot).toBe(false);
  });

  test("a failed check leaves the prompt plain and warns", async () => {
    const { cli, world } = await withRepo();
    world.failCall("github app repos", "`ghbot` is not installed or not on PATH");

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(0);
    expect(prompts(world.calls)).toEqual([PLAIN]);
    expect(stdout).toBe(
      [
        "dispatched: acme/api#7",
        "stage: Implementing",
        "workspace: w1",
        "agent: impl-api-7",
        "warnings[1]: \"could not check the GitHub App on acme/api, so the prompt has no bot suffix: `ghbot` is not installed or not on PATH\"",
        "help[2]:",
        "  Run `nico-agent show acme/api#7` to see the Dispatch",
        "  Run `nico-agent` to see the Board",
        "",
      ].join("\n"),
    );
    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.bot).toBe(false);
    expect(shown.warnings).toHaveLength(1);
  });

  test("the check runs on every dispatch, never cached", async () => {
    const { cli, world } = await withRepo();
    world.addIssue("acme/api", { number: 8 });
    world.appRepos = [];
    await cli("dispatch", "acme/api#7", ...FLAGS);
    world.appRepos = ["acme/api"];
    world.calls.length = 0;

    await cli("dispatch", "acme/api#8", ...FLAGS);
    expect(world.calls.filter((c) => c === "github app repos")).toHaveLength(1);
    expect(world.calls.find((c) => c.startsWith("herdr agent prompt"))).toContain("ghbot pr create");
  });

  test("a resumed prompt checks again, and a failed prompt keeps no stale warning", async () => {
    const { cli, world } = await withRepo();
    world.failCall("github app repos", "GitHub request failed");
    world.stallPrompts(3);
    await cli("dispatch", "acme/api#7", ...FLAGS);
    expect((await cli("show", "acme/api#7", "--json")).json().warnings).toBeUndefined();

    world.clearFailures();
    world.appRepos = ["acme/api"];
    world.calls.length = 0;
    const again = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(again.exitCode).toBe(0);
    expect(world.calls.slice(0, 2)).toEqual(["github app repos", `herdr agent prompt impl-api-7 ${WITH_BOT}`]);
    expect(again.stdout).not.toContain("warning");
  });

  test("a failed check and a failed Claim are both warnings", async () => {
    const { cli, world } = await withRepo();
    world.failCall("github app repos", "GitHub request failed");
    world.failCall("github assign", "GitHub request failed");

    const { json } = await cli("dispatch", "acme/api#7", ...FLAGS, "--json");
    expect(json().warnings).toEqual([
      "could not check the GitHub App on acme/api, so the prompt has no bot suffix: GitHub request failed",
      "could not Claim acme/api#7: GitHub request failed",
    ]);
    expect(json().help[0]).toBe("Assign https://github.com/acme/api/issues/7 to yourself on GitHub to Claim it by hand");
  });
});

describe("prompt templates from config", () => {
  test("implement and bot suffix templates fill their placeholders", async () => {
    const { cli, world, configDir } = await withRepo();
    world.appRepos = ["acme/api"];
    editConfig(configDir, {
      prompts: {
        implement: "{sigil}implement {url} ({issue}, {repo} #{number}) on {branch}",
        botSuffix: " via ghbot for {repo}",
      },
    });

    await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(prompts(world.calls)).toEqual([
      "/implement https://github.com/acme/api/issues/7 (acme/api#7, acme/api #7) on agent/api-7 via ghbot for acme/api",
    ]);
  });

  test("an unset template keeps its default", async () => {
    const { cli, world, configDir } = await withRepo();
    world.appRepos = ["acme/api"];
    editConfig(configDir, { prompts: { implement: "{sigil}implement {url}" } });

    await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(prompts(world.calls)).toEqual([`/implement https://github.com/acme/api/issues/7${WITH_BOT.slice(PLAIN.length)}`]);
  });

  test("an unknown placeholder is a config error, before anything is created", async () => {
    const { cli, world, configDir } = await withRepo();
    editConfig(configDir, { prompts: { botSuffix: " by {bot}" } });

    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        `error: "${join(configDir, "config.json")}: prompts.botSuffix has an unknown placeholder {bot}"`,
        "help[1]:",
        "  Placeholders: {sigil}, {url}, {issue}, {repo}, {number}, {branch}",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });

  test("adding a Repo keeps the prompt templates", async () => {
    const { cli, world, configDir } = await withRepo();
    editConfig(configDir, { prompts: { implement: "{sigil}implement {url}" } });
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");

    const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    expect(saved.prompts).toEqual({ implement: "{sigil}implement {url}" });
    expect(saved.repos).toHaveLength(2);
  });
});
