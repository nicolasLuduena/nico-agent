import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CODEX_CATALOG } from "./fake-world";
import { setup } from "./harness";

async function withRepo(harnesses?: Record<string, unknown>) {
  const ctx = setup();
  if (harnesses) writeConfig(ctx.configDir, { harnesses });
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  ctx.world.calls.length = 0;
  return ctx;
}

function writeConfig(configDir: string, config: Record<string, unknown>) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ repos: [], ...config }));
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CODEX_EFFORTS = [...CLAUDE_EFFORTS, "ultra"];

/** The listed codex models of the recorded catalog, in its order, without the hidden ones. */
const CODEX_MODELS = [
  { model: "gpt-6.1-sol", efforts: CODEX_EFFORTS },
  { model: "gpt-6-astra", efforts: CODEX_EFFORTS },
  { model: "gpt-6-sol", efforts: CODEX_EFFORTS },
  { model: "gpt-6-luna", efforts: CLAUDE_EFFORTS },
  { model: "gpt-5.6-sol", efforts: CODEX_EFFORTS },
  { model: "gpt-5.6-terra", efforts: CODEX_EFFORTS },
  { model: "gpt-5.6-luna", efforts: CLAUDE_EFFORTS },
  { model: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"] },
];

/** A catalog in `codex debug models`'s shape with only `models`, as `[slug, efforts]`. */
function catalog(...models: [string, string[]][]) {
  return JSON.stringify({
    models: models.map(([slug, efforts]) => ({
      slug,
      visibility: "list",
      supported_reasoning_levels: efforts.map((effort) => ({ effort, description: effort })),
    })),
  });
}

describe("codex dispatch", () => {
  test("launches codex with its model and Effort args plus extraArgs, and prompts with its Sigil", async () => {
    const { cli, world } = await withRepo({ codex: { extraArgs: ["--dangerously-bypass-approvals-and-sandbox"] } });

    const { exitCode } = await cli("dispatch", "acme/api#7", "--harness", "codex", "--model", "gpt-6-sol", "--effort", "ultra");
    expect(exitCode).toBe(0);
    expect(world.calls[0]).toBe("codex debug models");
    expect(world.calls).toContain(
      "herdr agent start impl-api-7 --kind codex --pane w1:p2 -- -m gpt-6-sol -c model_reasoning_effort=ultra --dangerously-bypass-approvals-and-sandbox",
    );
    expect(world.calls).toContain("herdr agent prompt impl-api-7 $implement https://github.com/acme/api/issues/7 as draft PR");
  });

  test("an Effort the chosen model does not support is rejected before anything is created", async () => {
    const { cli, world } = await withRepo();
    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", "--harness", "codex", "--model", "gpt-5.5", "--effort", "ultra");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: Effort `ultra` is not valid for codex gpt-5.5",
        "help[1]:",
        "  Valid Efforts for codex gpt-5.5: low, medium, high, xhigh",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual(["codex debug models"]);
  });

  test("a hidden model of the catalog is not offered", async () => {
    const { cli } = await withRepo();
    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", "--harness", "codex", "--model", "gpt-reserve", "--effort", "high");
    expect(exitCode).toBe(2);
    expect(stdout).toStartWith("error: unknown model `gpt-reserve` for codex\nhelp[1]:\n  Valid models for codex: gpt-6.1-sol, gpt-6-astra,");
  });

  test("a failed discovery fails the dispatch with a way out", async () => {
    const { cli, world } = await withRepo();
    world.failCall("codex debug models", "`codex` is not installed or not on PATH");
    const { stdout, exitCode } = await cli("dispatch", "acme/api#7", "--harness", "codex", "--model", "gpt-6-sol", "--effort", "high");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        'error: "could not discover codex models: `codex` is not installed or not on PATH"',
        "help[2]:",
        "  Run `nico-agent harness refresh` to try again",
        "  Set harnesses.codex.models and harnesses.codex.efforts in config.json to skip discovery",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual(["codex debug models"]);
  });
});

describe("harness list", () => {
  test("shows each Harness with its models and their Effort levels", async () => {
    const { cli } = setup();
    const { exitCode, json } = await cli("harness", "list", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toEqual({
      count: 2,
      harnesses: [
        {
          name: "claude",
          launch: "herdr-kind claude",
          sigil: "/",
          args: "--model {model} --effort {effort}",
          models: ["fable", "opus", "sonnet", "haiku"].map((model) => ({ model, efforts: CLAUDE_EFFORTS })),
          source: "config",
        },
        {
          name: "codex",
          launch: "herdr-kind codex",
          sigil: "$",
          args: "-m {model} -c model_reasoning_effort={effort}",
          models: CODEX_MODELS,
          source: "discovered 2026-09-30T12:00:00.000Z",
        },
      ],
      help: [
        "Run `nico-agent harness refresh` to discover models again",
        "Run `nico-agent dispatch <issue> --harness <harness> --model <model> --effort <effort>` to dispatch an issue",
      ],
    });
  });

  test("the TOON view lists models with their Effort levels", async () => {
    const { cli, world } = setup();
    world.codexCatalog = catalog(["gpt-6-sol", ["low", "high"]]);
    const { stdout } = await cli("harness", "list");
    expect(stdout).toBe(
      [
        "count: 2",
        "harnesses[2]:",
        "  - name: claude",
        "    launch: herdr-kind claude",
        '    sigil: /',
        '    args: "--model {model} --effort {effort}"',
        "    models[4]:",
        "      - model: fable",
        "        efforts[5]: low,medium,high,xhigh,max",
        "      - model: opus",
        "        efforts[5]: low,medium,high,xhigh,max",
        "      - model: sonnet",
        "        efforts[5]: low,medium,high,xhigh,max",
        "      - model: haiku",
        "        efforts[5]: low,medium,high,xhigh,max",
        "    source: config",
        "  - name: codex",
        "    launch: herdr-kind codex",
        "    sigil: $",
        '    args: "-m {model} -c model_reasoning_effort={effort}"',
        "    models[1]:",
        "      - model: gpt-6-sol",
        "        efforts[2]: low,high",
        '    source: "discovered 2026-09-30T12:00:00.000Z"',
        "help[2]:",
        "  Run `nico-agent harness refresh` to discover models again",
        "  Run `nico-agent dispatch <issue> --harness <harness> --model <model> --effort <effort>` to dispatch an issue",
        "",
      ].join("\n"),
    );
  });

  test("discovery is cached on disk: later runs don't ask codex again", async () => {
    const { cli, world, configDir } = setup();
    await cli("harness", "list");
    expect(world.calls).toEqual(["codex debug models"]);
    world.calls.length = 0;
    world.codexCatalog = catalog(["gpt-7", ["low"]]);

    const { json } = await cli("harness", "list", "--json");
    expect(world.calls).toEqual([]);
    expect(json().harnesses[1].models).toEqual(CODEX_MODELS);
    expect(JSON.parse(readFileSync(join(configDir, "harnesses.json"), "utf8"))).toEqual({
      codex: { discoveredAt: "2026-09-30T12:00:00.000Z", models: CODEX_MODELS },
    });
  });

  test("a failed discovery is shown on its Harness while the others still list", async () => {
    const { cli, world } = setup();
    world.failCall("codex debug models", "`codex` is not installed or not on PATH");
    const { exitCode, json } = await cli("harness", "list", "--json");
    expect(exitCode).toBe(0);
    const [claude, codex] = json().harnesses;
    expect(claude.models).toHaveLength(4);
    expect(codex.models).toEqual([]);
    expect(codex.error).toBe("could not discover codex models: `codex` is not installed or not on PATH");
  });

  test("an unexpected catalog is a discovery failure, not a crash", async () => {
    const { cli, world } = setup();
    world.codexCatalog = "not json";
    const { exitCode, json } = await cli("harness", "list", "--json");
    expect(exitCode).toBe(0);
    expect(json().harnesses[1].error).toBe("could not discover codex models: `codex debug models` printed an unexpected catalog");
  });
});

describe("harness refresh", () => {
  test("discovers again and replaces the cache", async () => {
    const { cli, world } = setup();
    await cli("harness", "list");
    world.codexCatalog = catalog(["gpt-7", ["low", "medium"]]);
    world.clock = new Date("2026-10-01T08:00:00.000Z");

    const refreshed = await cli("harness", "refresh");
    expect(refreshed.exitCode).toBe(0);
    expect(refreshed.stdout).toBe(
      [
        "refreshed[1]{harness,models,source}:",
        '  codex,1,"discovered 2026-10-01T08:00:00.000Z"',
        "help[1]:",
        "  Run `nico-agent harness list` to see the models and Effort levels",
        "",
      ].join("\n"),
    );
    const listed = (await cli("harness", "list", "--json")).json();
    expect(listed.harnesses[1].models).toEqual([{ model: "gpt-7", efforts: ["low", "medium"] }]);
  });

  test("a failed refresh exits 1 and keeps the previous cache", async () => {
    const { cli, world } = setup();
    await cli("harness", "list");
    world.failCall("codex debug models", "`codex debug models` failed: exit code 1");

    const { stdout, exitCode } = await cli("harness", "refresh");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "refreshed[1]{harness,models,source,error}:",
        '  codex,8,"discovered 2026-09-30T12:00:00.000Z","could not discover codex models: `codex debug models` failed: exit code 1"',
        "help[1]:",
        "  Run `nico-agent harness list` to see the models and Effort levels",
        "",
      ].join("\n"),
    );
    world.clearFailures();
    world.calls.length = 0;
    expect((await cli("harness", "list", "--json")).json().harnesses[1].models).toEqual(CODEX_MODELS);
    expect(world.calls).toEqual([]);
  });
});

describe("Harness config", () => {
  test("config models override discovered ones, keeping their discovered Efforts", async () => {
    const { cli } = await withRepo({ codex: { models: ["gpt-5.5", "gpt-6-sol"] } });
    const { json } = await cli("harness", "list", "--json");
    expect(json().harnesses[1].models).toEqual([
      { model: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"] },
      { model: "gpt-6-sol", efforts: CODEX_EFFORTS },
    ]);
    expect(json().harnesses[1].source).toBe("config, Efforts discovered 2026-09-30T12:00:00.000Z");
  });

  test("config models and Efforts together skip discovery", async () => {
    const { cli, world } = await withRepo({ codex: { models: ["gpt-next"], efforts: ["high"] } });
    const { exitCode } = await cli("dispatch", "acme/api#7", "--harness", "codex", "--model", "gpt-next", "--effort", "high");
    expect(exitCode).toBe(0);
    expect(world.calls).not.toContain("codex debug models");
    expect(world.calls).toContain("herdr agent start impl-api-7 --kind codex --pane w1:p2 -- -m gpt-next -c model_reasoning_effort=high");
  });

  test("claude's args, Sigil and extraArgs come from config", async () => {
    const { cli, world } = await withRepo({
      claude: { sigil: "!", modelArgs: ["--model={model}"], extraArgs: ["--permission-mode", "acceptEdits"] },
    });
    await cli("dispatch", "acme/api#7", "--harness", "claude", "--model", "opus", "--effort", "high");
    expect(world.calls).toContain(
      "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model=opus --effort high --permission-mode acceptEdits",
    );
    expect(world.calls).toContain("herdr agent prompt impl-api-7 !implement https://github.com/acme/api/issues/7 as draft PR");
  });

  test("a new Harness can be defined in config", async () => {
    const { cli, world } = await withRepo({
      gemini: { launchMode: "herdr-kind", kind: "gemini", sigil: "/", modelArgs: ["-m", "{model}"], effortArgs: [], models: ["pro"], efforts: ["default"] },
    });
    const { exitCode } = await cli("dispatch", "acme/api#7", "--harness", "gemini", "--model", "pro", "--effort", "default");
    expect(exitCode).toBe(0);
    expect(world.calls).toContain("herdr agent start impl-api-7 --kind gemini --pane w1:p2 -- -m pro");
  });

  test("a malformed Harness config is a config error, before any outside-world call", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ codex: { extraArgs: "--yolo" } }, "harnesses.codex.extraArgs is not a list of strings", "Fix or delete the file and run `nico-agent repo add` again"],
      [{ codex: { color: "red" } }, "harnesses.codex.color is not a Harness setting", "Harness settings: launchMode, kind, sigil, modelArgs, effortArgs, extraArgs, models, efforts, discovery, trustPrompt"],
      [{ codex: { launchMode: "pane-command" } }, "harnesses.codex.launchMode `pane-command` is not supported", "Launch modes: herdr-kind"],
      [{ codex: { discovery: "opencode2" } }, "harnesses.codex.discovery `opencode2` is not supported", "Discovery: codex"],
      [{ gemini: { launchMode: "herdr-kind", kind: "gemini" } }, "harnesses.gemini is missing sigil", "A new Harness needs launchMode, kind, sigil, modelArgs, effortArgs"],
    ];
    for (const [harnesses, error, help] of cases) {
      const { cli, world, configDir } = setup();
      writeConfig(configDir, { harnesses });
      const { stdout, exitCode } = await cli("harness", "list");
      expect(exitCode).toBe(1);
      expect(stdout).toBe(`error: "${join(configDir, "config.json")}: ${error}"\nhelp[1]:\n  ${help}\n`);
      expect(world.calls).toEqual([]);
    }
  });

  test("adding a Repo keeps the Harness config", async () => {
    const { cli, configDir } = await withRepo({ codex: { extraArgs: ["--yolo"] } });
    const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    expect(config.harnesses).toEqual({ codex: { extraArgs: ["--yolo"] } });
    expect((await cli("repo", "list")).exitCode).toBe(0);
  });
});

describe("web Harness choices", () => {
  test("the dispatch form offers every Harness, and the default model's Efforts", async () => {
    const { web, world } = await withRepo();
    world.codexCatalog = CODEX_CATALOG;
    const { body } = await web("/");
    expect(body).toContain('<select name="harness" hx-get="/dispatch-form" hx-include="closest form" hx-target="closest form" hx-swap="outerHTML"><option selected>claude</option><option>codex</option></select>');
    expect(body).toContain(
      '<select name="effort"><option selected>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select>',
    );
    expect(body).toContain('<form method="post" action="/harnesses/refresh" class="refresh">\n<button>Refresh harnesses</button>\n</form>');
  });

  test("choosing a Harness and model re-renders the form with only that model's Efforts", async () => {
    const { web } = await withRepo();
    const { status, body } = await web("/dispatch-form?issue=acme%2Fapi%237&harness=codex&model=gpt-5.5&effort=ultra");
    expect(status).toBe(200);
    expect(body).toStartWith('<form method="post" action="/dispatch" class="dispatch">');
    expect(body).not.toContain("<html");
    expect(body).toContain('<input type="hidden" name="issue" value="acme/api#7">');
    expect(body).toContain('<option selected>codex</option>');
    expect(body).toContain("<option selected>gpt-5.5</option>");
    expect(body).toContain(
      '<select name="effort"><option selected>low</option><option>medium</option><option>high</option><option>xhigh</option></select>',
    );
  });

  test("switching Harness falls back to its first model, keeping the Effort when still valid", async () => {
    const { web } = await withRepo();
    const { body } = await web("/dispatch-form?issue=acme%2Fapi%237&harness=claude&model=gpt-5.5&effort=high");
    expect(body).toContain('<select name="model" hx-get="/dispatch-form" hx-include="closest form" hx-target="closest form" hx-swap="outerHTML"><option selected>fable</option>');
    expect(body).toContain("<option selected>high</option>");
  });

  test("a Harness whose discovery failed is left out of the form, with its error shown", async () => {
    const { web, world } = await withRepo();
    world.failCall("codex debug models", "`codex` is not installed or not on PATH");
    const { body } = await web("/");
    expect(body).toContain('<option selected>claude</option></select>');
    expect(body).not.toContain("<option>codex</option>");
    expect(body).toContain('<p class="warning">could not discover codex models: `codex` is not installed or not on PATH</p>');
  });

  test("Refresh harnesses discovers again and goes back to the Board", async () => {
    const { web, world } = await withRepo();
    await web("/");
    world.codexCatalog = catalog(["gpt-7", ["low"]]);
    world.calls.length = 0;

    const response = await web("/harnesses/refresh", { method: "POST" });
    expect(response.status).toBe(303);
    expect(world.calls).toEqual(["codex debug models"]);
    expect((await web("/dispatch-form?issue=acme%2Fapi%237&harness=codex")).body).toContain("<option selected>gpt-7</option>");
  });

  test("a failed refresh is an error page", async () => {
    const { web, world } = await withRepo();
    world.failCall("codex debug models", "`codex debug models` failed: exit code 1");
    const { status, body } = await web("/harnesses/refresh", { method: "POST" });
    expect(status).toBe(502);
    expect(body).toContain('<p class="error">could not discover codex models: `codex debug models` failed: exit code 1</p>');
  });
});
