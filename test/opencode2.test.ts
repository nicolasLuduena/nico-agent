import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

/** A Repo with issue 7, and opencode2's saved-variant file in a temp dir. */
async function withRepo(settings: Record<string, unknown> = {}) {
  const ctx = setup();
  const variantFile = join(mkdtempSync(join(tmpdir(), "nico-agent-state-")), "opencode", "model.json");
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], harnesses: { opencode2: { variantFile, ...settings } } }));
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  ctx.world.calls.length = 0;
  return { ...ctx, variantFile };
}

const MODEL = "opencode-go/deepseek-v4.1-flash";
const DISPATCH = ["dispatch", "acme/api#7", "--harness", "opencode2", "--model", MODEL, "--effort", "high"];
const CONFIG = `{"model":"${MODEL}#high","agents":{"build":{"model":"${MODEL}#high"}}}`;

function herdrCalls(calls: string[]) {
  return calls.filter((c) => /^herdr (pane run|agent (detect|rename|prompt))/.test(c));
}

describe("opencode2 dispatch", () => {
  test("runs opencode2 in the pane with its model config, waits for herdr to detect it, names it and prompts with its Sigil", async () => {
    const { cli, world } = await withRepo({ extraArgs: ["--auto"] });
    const { exitCode, stdout } = await cli(...DISPATCH);
    expect(stdout).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(herdrCalls(world.calls)).toEqual([
      `herdr pane run w1:p2 env OPENCODE_CONFIG_CONTENT='${CONFIG}' opencode2 --standalone --auto`,
      "herdr agent detect w1:p2 --timeout 30000",
      "herdr agent rename w1:p2 impl-api-7",
      "herdr agent prompt impl-api-7 @implement https://github.com/acme/api/issues/7 as draft PR against main",
    ]);
    expect(world.calls.some((c) => c.startsWith("herdr agent start"))).toBe(false);
  });

  test("the configured binary is run, quoted for the shell", async () => {
    const { cli, world } = await withRepo({ command: "/opt/open code/opencode2" });
    await cli(...DISPATCH);
    expect(world.calls).toContain(`herdr pane run w1:p2 env OPENCODE_CONFIG_CONTENT='${CONFIG}' '/opt/open code/opencode2' --standalone`);
  });

  test("the chosen Effort is saved for the chosen model only, keeping the rest of the file", async () => {
    const { cli, variantFile } = await withRepo();
    mkdirSync(dirname(variantFile), { recursive: true });
    const saved = {
      recent: [{ providerID: "opencode-go", modelID: "deepseek-v4.1-flash" }],
      favorite: [{ providerID: "opencode", modelID: "fledge-alpha-free" }],
      variant: { [MODEL]: "max", "opencode/fledge-alpha-free": "low" },
      future: { kept: true },
    };
    writeFileSync(variantFile, JSON.stringify(saved));

    expect((await cli(...DISPATCH)).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(variantFile, "utf8"))).toEqual({
      ...saved,
      variant: { [MODEL]: "high", "opencode/fledge-alpha-free": "low" },
    });
  });

  test("a missing saved-variant file is created", async () => {
    const { cli, variantFile } = await withRepo();
    expect(existsSync(variantFile)).toBe(false);
    expect((await cli(...DISPATCH)).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(variantFile, "utf8"))).toEqual({ recent: [], favorite: [], variant: { [MODEL]: "high" } });
  });

  test("the default Effort of a model without variants clears its saved variant and names no variant", async () => {
    const { cli, world, variantFile } = await withRepo();
    const model = "openrouter/unbiased/pareto-26.10-preview";
    mkdirSync(dirname(variantFile), { recursive: true });
    writeFileSync(variantFile, JSON.stringify({ recent: [], favorite: [], variant: { [model]: "high", [MODEL]: "max" } }));

    const { exitCode } = await cli("dispatch", "acme/api#7", "--harness", "opencode2", "--model", model, "--effort", "default");
    expect(exitCode).toBe(0);
    expect(JSON.parse(readFileSync(variantFile, "utf8")).variant).toEqual({ [MODEL]: "max" });
    const config = `{"model":"${model}","agents":{"build":{"model":"${model}"}}}`;
    expect(world.calls).toContain(`herdr pane run w1:p2 env OPENCODE_CONFIG_CONTENT='${config}' opencode2 --standalone`);
  });

  test("an unreadable saved-variant file fails the launch without overwriting it", async () => {
    const { cli, world, variantFile } = await withRepo();
    mkdirSync(dirname(variantFile), { recursive: true });
    writeFileSync(variantFile, "{ not json");

    const { exitCode, stdout } = await cli(...DISPATCH);
    expect(exitCode).toBe(1);
    expect(stdout).toStartWith(`error: ${variantFile} is not valid JSON; fix or delete it\nstage: Failed at agent start\n`);
    expect(readFileSync(variantFile, "utf8")).toBe("{ not json");
    expect(world.calls.some((c) => c.startsWith("herdr pane run"))).toBe(false);
  });

  test("a detection timeout is a failed step that a re-run resumes without running opencode2 again", async () => {
    const { cli, world } = await withRepo();
    world.failCall("herdr agent detect", "agent_not_detected: no agent in w1:p2 after 30000ms");

    const failed = await cli(...DISPATCH);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("agent_not_detected");
    const shown = (await cli("show", "acme/api#7", "--json")).json();
    expect(shown.stage).toBe("Failed at agent ready");

    world.clearFailures();
    world.calls.length = 0;
    const resumed = await cli(...DISPATCH, "--json");
    expect(resumed.exitCode).toBe(0);
    expect(resumed.json().dispatched).toBe("acme/api#7 (resumed from agent ready)");
    expect(herdrCalls(world.calls)).toEqual([
      "herdr agent detect w1:p2 --timeout 30000",
      "herdr agent rename w1:p2 impl-api-7",
      "herdr agent prompt impl-api-7 @implement https://github.com/acme/api/issues/7 as draft PR against main",
    ]);
  });
});

describe("opencode2 models", () => {
  test("are discovered from `opencode2 api model.list`: enabled ones, with their variants as Efforts", async () => {
    const { cli, world } = await withRepo();
    const { json } = await cli("harness", "list", "--json");
    const opencode2 = json().harnesses.find((h: { name: string }) => h.name === "opencode2");
    expect(opencode2).toEqual({
      name: "opencode2",
      launch: "pane-command opencode2",
      sigil: "@",
      args: "--standalone",
      models: [
        { model: "opencode-go/deepseek-v4.1-flash", efforts: ["low", "high", "max"] },
        { model: "opencode/fledge-alpha-free", efforts: ["low", "high", "max"] },
        { model: "openrouter/unbiased/pareto-26.10-preview", efforts: ["default"] },
      ],
      source: "discovered 2026-09-30T12:00:00.000Z",
    });
    expect(world.calls).toContain("opencode2 api model.list");
  });

  test("discovery runs the configured binary", async () => {
    const { cli, world } = await withRepo({ command: "/opt/opencode2" });
    await cli("harness", "list");
    expect(world.calls).toContain("/opt/opencode2 api model.list");
  });

  test("an unexpected catalog is a discovery failure", async () => {
    const { cli, world } = await withRepo();
    world.opencodeCatalog = "{}";
    const { json } = await cli("harness", "list", "--json");
    const opencode2 = json().harnesses.find((h: { name: string }) => h.name === "opencode2");
    expect(opencode2.error).toBe("could not discover opencode2 models: `opencode2 api model.list` printed an unexpected catalog");
  });

  test("a pane-command Harness needs a command", async () => {
    const { cli, configDir } = setup();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ repos: [], harnesses: { oc: { launchMode: "pane-command", sigil: "@", modelArgs: [], effortArgs: [] } } }),
    );
    const { stdout, exitCode } = await cli("harness", "list");
    expect(exitCode).toBe(1);
    expect(stdout).toContain("harnesses.oc is missing command");
  });
});
