import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./harness";

async function withRepo() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7, labels: ["ready-for-agent", "research"] });
  ctx.world.addIssue("acme/api", { number: 8 });
  ctx.world.calls.length = 0;
  return ctx;
}

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const RESEARCH =
  "/research https://github.com/acme/api/issues/7 yourself, not in a background agent, against primary sources; " +
  "write the findings, with their sources, to one Markdown file in docs/research/ and open it as a draft PR against main";
const TRAILER =
  "Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>";
const BOT = `, opened with \`ghbot pr create\` (not \`gh\`); end every commit message with the trailer \`${TRAILER}\``;

function prompts(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr agent prompt ")).map((c) => c.replace(/^herdr agent prompt \S+ /, ""));
}

function editConfig(configDir: string, extra: object) {
  const file = join(configDir, "config.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...extra }));
}

describe("Research issues", () => {
  test("a Research issue is sent the research prompt, an unlabelled one the implement prompt", async () => {
    const { cli, world } = await withRepo();

    expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
    expect((await cli("dispatch", "acme/api#8", ...FLAGS)).exitCode).toBe(0);
    expect(prompts(world.calls)).toEqual([RESEARCH, "/implement https://github.com/acme/api/issues/8 as draft PR against main"]);
  });

  test("the Bot suffix follows the research prompt where the App is installed", async () => {
    const { cli, world } = await withRepo();
    world.appRepos = ["acme/api"];

    await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(prompts(world.calls)).toEqual([RESEARCH + BOT]);
  });

  test("a Research issue makes the same GitHub calls as any other, so no new GitHub request", async () => {
    const { cli, world } = await withRepo();
    const callsOf = async (issue: number) => {
      world.calls.length = 0;
      await cli("dispatch", `acme/api#${issue}`, ...FLAGS);
      return world.calls.filter((c) => c.startsWith("github ")).map((c) => c.replaceAll(String(issue), "N"));
    };
    expect(await callsOf(7)).toEqual(await callsOf(8));
  });

  test("a resumed Research issue's Dispatch is sent the research prompt again", async () => {
    const { cli, world } = await withRepo();
    world.stallPrompts(3);
    expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(1);
    world.calls.length = 0;

    expect((await cli("dispatch", "acme/api#7", ...FLAGS)).exitCode).toBe(0);
    expect(world.calls.filter((c) => c.startsWith("github issue"))).toEqual([]);
    expect(prompts(world.calls)).toEqual([RESEARCH]);
  });

  test("a Linear issue labelled research is sent the research prompt", async () => {
    const { cli, world } = setup();
    world.addClone("/src/pdf-diff", "git@github.com:bleentr/pdf-diff.git");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf-diff", "--linear-team", "BLE");
    world.addLinearIssue({ identifier: "BLE-27", labels: ["ready-for-agent", "research"] });

    await cli("dispatch", "BLE-27", ...FLAGS);
    expect(prompts(world.calls)).toEqual([RESEARCH.replace("https://github.com/acme/api/issues/7", "https://linear.app/bleentr/issue/BLE-27/title")]);
  });

  test("the research template is set in config, and its placeholders are checked", async () => {
    const { cli, world, configDir } = await withRepo();
    editConfig(configDir, { prompts: { research: "{sigil}research {issueUrl} onto {baseBranch}" } });
    await cli("dispatch", "acme/api#7", ...FLAGS);
    expect(prompts(world.calls)).toEqual(["/research https://github.com/acme/api/issues/7 onto main"]);

    editConfig(configDir, { prompts: { research: "{sigil}research {prUrl} in {topic}" } });
    const { json, exitCode } = await cli("dispatch", "acme/api#8", ...FLAGS, "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe(`${join(configDir, "config.json")}: prompts.research has an unknown placeholder {topic}`);
  });

  test("advance sends the research prompt to a Research issue of a running Spec", async () => {
    const { cli, world, configDir } = setup();
    world.addClone("/src/pdf-diff", "git@github.com:bleentr/pdf-diff.git");
    await cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf-diff", "--linear-team", "BLE");
    editConfig(configDir, { scheduler: { harness: "claude", model: "opus", effort: "high" } });
    world.addLinearSpec({ identifier: "BLE-10" },
      { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12", labels: ["ready-for-agent", "research"], blockers: [{ identifier: "BLE-11", state: "started" }] });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/16"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 16, headBranch: "nico/ble-11" });

    expect((await cli("advance")).exitCode).toBe(0);
    expect(prompts(world.calls)).toEqual([
      "/research https://linear.app/bleentr/issue/BLE-12/title yourself, not in a background agent, against primary sources; " +
      "write the findings, with their sources, to one Markdown file in docs/research/ and open it as a draft PR against nico/ble-11" +
      " as the top of the stacked PRs on top of https://github.com/bleentr/pdf-diff/pull/16 - check gh-stack if you are not aware of github's stacked PRs",
    ]);
  });

  test("board --json marks Research issues and their Dispatches, and only those", async () => {
    const { cli, world } = await withRepo();
    const research = ["ready-for-agent", "research"];
    world.addIssue("acme/api", { number: 2, title: "Blocker", labels: [] });
    world.linkPr("acme/api", 2, { number: 40, headBranch: "agent/api-2" });
    world.addIssue("acme/api", { number: 3, labels: research, blockers: [{ slug: "acme/api", number: 2, state: "open" }] });
    world.addIssue("acme/api", { number: 4, labels: research });
    world.linkPr("acme/api", 4, { number: 41, headBranch: "fix-4" });
    world.addIssue("acme/api", { number: 5, labels: research });
    await cli("dispatch", "acme/api#7", ...FLAGS);
    await cli("dispatch", "acme/api#8", ...FLAGS);

    const json = (await cli("board", "--json")).json();
    const marked = (rows: { issue: string; research?: boolean }[]) => rows.map((r) => [r.issue, r.research ?? false]);
    expect(marked(json.issues)).toEqual([["acme/api#5", true]]);
    expect(marked(json.stackable)).toEqual([["acme/api#3", true]]);
    expect(marked(json.prOpen)).toEqual([["acme/api#4", true]]);
    expect(marked(json.dispatches)).toEqual([["acme/api#7", true], ["acme/api#8", false]]);
  });
});
