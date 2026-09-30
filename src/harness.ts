import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Discovery, type HarnessConfig, harnessConfigs, loadConfig } from "./config";
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
 * the cache; a Harness whose discovery fails keeps its cached models.
 */
export async function refreshHarnesses(world: World, configDir: string): Promise<Catalog[]> {
  const cache = readCache(configDir);
  const refreshed: Catalog[] = [];
  for (const harness of harnesses(configDir)) {
    if (harness.discovery) refreshed.push(await catalogOf(world, configDir, cache, harness, true));
  }
  return refreshed;
}

/** `modelArgs`, `effortArgs` and `extraArgs`, with the placeholders filled. */
export function launchArgs(harness: Harness, model: string, effort: string): string[] {
  const fill = (args: string[]) => args.map((a) => a.replaceAll("{model}", model).replaceAll("{effort}", effort));
  return [...fill(harness.modelArgs), ...fill(harness.effortArgs), ...harness.extraArgs];
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
      discovered = { discoveredAt: world.now().toISOString(), models: await discover(world, discovery) };
      cache[harness.name] = discovered;
      writeCache(configDir, cache);
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

async function discover(world: World, discovery: Discovery): Promise<ModelChoice[]> {
  switch (discovery) {
    case "codex":
      return parseCodexModels(await world.codexModels());
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

function readCache(configDir: string): Cache {
  try {
    return JSON.parse(readFileSync(join(configDir, CACHE_FILE), "utf8")) as Cache;
  } catch {
    // Missing or unreadable, the cache is only a cache: discovery fills it again.
    return {};
  }
}

function writeCache(configDir: string, cache: Cache) {
  mkdirSync(configDir, { recursive: true });
  const file = join(configDir, CACHE_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
