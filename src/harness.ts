import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Discovery, type HarnessConfig, harnessConfigs, loadConfig, writeJson } from "./config";
import { parseOpencodeModels } from "./opencode";
import { type World, WorldError } from "./world";

/** A coding-agent CLI nico-agent can launch, as configured. */
export interface Harness extends HarnessConfig {
  name: string;
}

/** A model a Harness can run, with the Effort levels valid for it. */
export interface ModelChoice {
  model: string;
  efforts: string[];
}

/** What a Harness can be launched with right now, and where that came from. */
export interface Catalog {
  harness: Harness;
  models: ModelChoice[];
  /** `config`, or when the models (or only their Efforts) were discovered. */
  source: string;
  /** Why discovery failed; `models` is then empty, unless config names them all. */
  error?: string;
}

interface Discovered {
  discoveredAt: string;
  models: ModelChoice[];
}

type Cache = Record<string, Discovered>;

const CACHE_FILE = "harnesses.json";

/** Every configured Harness, in config order. */
export function harnesses(configDir: string): Harness[] {
  return Object.entries(harnessConfigs(loadConfig(configDir))).map(([name, config]) => ({ name, ...config }));
}

/** The catalog of every Harness, discovering those not yet in the cache. */
export async function harnessCatalogs(world: World, configDir: string): Promise<Catalog[]> {
  const all = harnesses(configDir);
  const cache = readCache(configDir);
  const catalogs: Catalog[] = [];
  for (const harness of all) catalogs.push(await catalogOf(world, configDir, cache, harness, false));
  return catalogs;
}

/** The catalog of one Harness, or null if there is no Harness by that name. */
export async function harnessCatalog(world: World, configDir: string, name: string): Promise<Catalog | null> {
  const harness = harnesses(configDir).find((h) => h.name === name);
  return harness ? catalogOf(world, configDir, readCache(configDir), harness, false) : null;
}

/**
 * Discover the models of every Harness that has discovery again, replacing
 * the cache; a Harness whose discovery fails keeps its cached models, and
 * entries of Harnesses that no longer discover are dropped.
 */
export async function refreshHarnesses(world: World, configDir: string): Promise<Catalog[]> {
  const discovering = harnesses(configDir).filter((h) => h.discovery);
  const old = readCache(configDir);
  const cache: Cache = {};
  for (const { name } of discovering) if (old[name]) cache[name] = old[name];
  writeJson(configDir, CACHE_FILE, cache);
  const refreshed: Catalog[] = [];
  for (const harness of discovering) refreshed.push(await catalogOf(world, configDir, cache, harness, true));
  return refreshed;
}

/** The values a launch fills its args' placeholders with. */
export interface Launch {
  model: string;
  effort: string;
  /** Path of the Repo's clone. */
  repoPath: string;
}

/** `modelArgs`, `effortArgs`, `trustArgs` and `extraArgs`, with the placeholders filled. */
export function launchArgs(harness: Harness, launch: Launch): string[] {
  const fill = (args: string[]) =>
    args.map((a) => a.replace(/\{(model|effort|repoPath)\}/g, (_, name: keyof Launch) => launch[name]));
  const { modelArgs, effortArgs, trustArgs = [], extraArgs } = harness;
  return [...fill(modelArgs), ...fill(effortArgs), ...fill(trustArgs), ...fill(extraArgs)];
}

/** The Harness and model last dispatched with, the Effort last used with each model, and the Base last used in each Repo. */
export interface Remembered {
  last?: { harness: string; model: string };
  /** By `<harness> <model>`. */
  efforts: Record<string, string>;
  /** By Repo slug; Stacked dispatches leave it alone. */
  bases: Record<string, string>;
}

const REMEMBERED_FILE = "launches.json";

export function rememberedLaunches(configDir: string): Remembered {
  try {
    const parsed = JSON.parse(readFileSync(join(configDir, REMEMBERED_FILE), "utf8")) as Remembered;
    return { ...parsed, efforts: parsed.efforts ?? {}, bases: parsed.bases ?? {} };
  } catch {
    // Only a convenience for the web form: forget whatever can't be read.
    return { efforts: {}, bases: {} };
  }
}

/** Remember a dispatch's choices, and its Base in `repo` unless it is Stacked, for the web form and CLI to start from. */
export function rememberLaunch(configDir: string, harness: string, model: string, effort: string, base?: { repo: string; branch: string }) {
  const remembered = rememberedLaunches(configDir);
  writeJson(configDir, REMEMBERED_FILE, {
    last: { harness, model },
    efforts: { ...remembered.efforts, [`${harness} ${model}`]: effort },
    bases: base ? { ...remembered.bases, [base.repo]: base.branch } : remembered.bases,
  });
}

/**
 * A Harness's models and Efforts: config's `models` and `efforts` over the
 * discovered ones. Discovery runs only when config leaves either unset and
 * the cache has nothing (or `refresh` is asked); a failure is kept in the
 * catalog rather than thrown, so the other Harnesses still load.
 */
async function catalogOf(world: World, configDir: string, cache: Cache, harness: Harness, refresh: boolean): Promise<Catalog> {
  const { models, efforts, discovery } = harness;
  let discovered = discovery && harness.name in cache ? cache[harness.name] : undefined;
  let error: string | undefined;
  if (discovery && (refresh || (!discovered && !(models && efforts)))) {
    try {
      discovered = { discoveredAt: world.now().toISOString(), models: await discover(world, harness, discovery) };
      cache[harness.name] = discovered;
      writeJson(configDir, CACHE_FILE, cache);
    } catch (e) {
      if (!(e instanceof WorldError)) throw e;
      error = `could not discover ${harness.name} models: ${e.message}`;
    }
  }
  const effortsOf = (model: string) => efforts ?? discovered?.models.find((m) => m.model === model)?.efforts ?? [];
  const choices = models ? models.map((model) => ({ model, efforts: effortsOf(model) })) : (discovered?.models ?? []);
  const when = discovered && `discovered ${discovered.discoveredAt}`;
  const source = !when ? "config" : !models ? when : !efforts ? `config, Efforts ${when}` : "config";
  return { harness, models: choices, source, ...(error && { error }) };
}

async function discover(world: World, harness: Harness, discovery: Discovery): Promise<ModelChoice[]> {
  switch (discovery) {
    case "codex":
      return parseCodexModels(await world.codexModels());
    case "opencode2":
      return parseOpencodeModels(await world.opencodeModels(harness.command ?? "opencode2"));
  }
}

/** The listed models of `codex debug models`, in its order, with their reasoning levels as Efforts. */
function parseCodexModels(text: string): ModelChoice[] {
  try {
    const catalog = JSON.parse(text) as {
      models: { slug: string; visibility?: string; supported_reasoning_levels: { effort: string }[] }[];
    };
    return catalog.models
      .filter((m) => m.visibility !== "hide")
      .map((m) => {
        if (typeof m.slug !== "string") throw new Error("model without a slug");
        return { model: m.slug, efforts: m.supported_reasoning_levels.map((l) => l.effort) };
      });
  } catch {
    throw new WorldError("`codex debug models` printed an unexpected catalog");
  }
}

/** The cached discoveries; a missing, unreadable or malformed entry is just rediscovered. */
function readCache(configDir: string): Cache {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(configDir, CACHE_FILE), "utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => isDiscovered(entry)));
}

function isDiscovered(entry: unknown): entry is Discovered {
  const { discoveredAt, models } = (entry ?? {}) as Partial<Discovered>;
  return (
    typeof discoveredAt === "string" &&
    Array.isArray(models) &&
    models.every((m) => typeof m?.model === "string" && Array.isArray(m.efforts) && m.efforts.every((e) => typeof e === "string"))
  );
}
