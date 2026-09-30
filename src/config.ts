import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sameSlug } from "./slug";

export interface Repo {
  slug: string;
  path: string;
}

export interface Config {
  repos: Repo[];
  /** Prompt templates the user set; unset ones take their default from PROMPTS. */
  prompts?: Partial<Prompts>;
  /** Harness settings the user set, by Harness, over HARNESSES; a new name defines a new Harness. */
  harnesses?: Record<string, Partial<HarnessConfig>>;
}

/**
 * How a Harness is launched (ADR-0005). `modelArgs` and `effortArgs` hold the
 * `{model}` and `{effort}` placeholders; `extraArgs` follow them on every
 * launch. `models` overrides discovered models, and `efforts` sets the Effort
 * levels of every model, overriding discovered ones.
 */
export interface HarnessConfig {
  launchMode: LaunchMode;
  /** herdr's agent kind. */
  kind: string;
  sigil: string;
  modelArgs: string[];
  effortArgs: string[];
  extraArgs: string[];
  models?: string[];
  efforts?: string[];
  /** Where the models and their Effort levels are discovered from. */
  discovery?: Discovery;
  /** The question the Harness asks before working in a new folder, and the keys that answer yes. */
  trustPrompt?: { text: string; keys: string[] };
}

/** `pane-command` (opencode2) is not supported yet. */
export const LAUNCH_MODES = ["herdr-kind"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export const DISCOVERIES = ["codex"] as const;
export type Discovery = (typeof DISCOVERIES)[number];

/** The built-in Harnesses; claude's models are its aliases. */
export const HARNESSES: Record<string, HarnessConfig> = {
  claude: {
    launchMode: "herdr-kind",
    kind: "claude",
    sigil: "/",
    modelArgs: ["--model", "{model}"],
    effortArgs: ["--effort", "{effort}"],
    extraArgs: [],
    models: ["fable", "opus", "sonnet", "haiku"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    trustPrompt: { text: "Yes, I trust this folder", keys: ["down", "enter"] },
  },
  codex: {
    launchMode: "herdr-kind",
    kind: "codex",
    sigil: "$",
    modelArgs: ["-m", "{model}"],
    effortArgs: ["-c", "model_reasoning_effort={effort}"],
    extraArgs: [],
    discovery: "codex",
  },
};

const REQUIRED_HARNESS_SETTINGS = ["launchMode", "kind", "sigil", "modelArgs", "effortArgs"] as const;
const HARNESS_SETTINGS = [...REQUIRED_HARNESS_SETTINGS, "extraArgs", "models", "efforts", "discovery", "trustPrompt"];

/** Every Harness, built-in and from config, by name: the config's settings over the built-in ones. */
export function harnessConfigs(config: Config): Record<string, HarnessConfig> {
  const all = { ...HARNESSES };
  for (const [name, settings] of Object.entries(config.harnesses ?? {})) {
    all[name] = { extraArgs: [], ...all[name], ...settings } as HarnessConfig;
  }
  return all;
}

/**
 * The prompt templates a Dispatch sends. `implement` prompts the Implementer;
 * `botSuffix` is appended to it as is, with no separator, when the GitHub App
 * is installed on the Repo, so it carries its own leading punctuation.
 */
export interface Prompts {
  implement: string;
  botSuffix: string;
}

export const PROMPTS: Prompts = {
  implement: "{sigil}implement {issueUrl} as draft PR",
  botSuffix:
    ", opened with `ghbot pr create` (not `gh`); end every commit message with the trailer " +
    "`Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>`",
};

export const PLACEHOLDERS = ["sigil", "issueUrl"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const PLACEHOLDER = /\{(\w+)\}/g;

/** A template with each `{placeholder}` replaced by its value. */
export function fillTemplate(template: string, values: Record<Placeholder, string>) {
  return template.replace(PLACEHOLDER, (match, name: string) => values[name as Placeholder] ?? match);
}

export function prompts(config: Config): Prompts {
  return { ...PROMPTS, ...config.prompts };
}

export function defaultConfigDir(env: Record<string, string | undefined>) {
  if (env.NICO_AGENT_CONFIG_DIR) return env.NICO_AGENT_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "nico-agent");
}

export const CONFIG_ERROR_HELP = "Fix or delete the file and run `nico-agent repo add` again";

/** The config file exists but can't be used. */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly help = CONFIG_ERROR_HELP,
  ) {
    super(message);
  }
}

export function loadConfig(dir: string): Config {
  const file = join(dir, "config.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { repos: [] };
    throw e;
  }
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError(`${file} is not valid JSON`);
  }
  const config: Config = { repos: parsed.repos ?? [] };
  if (parsed.prompts !== undefined) config.prompts = checkPrompts(file, parsed.prompts);
  if (parsed.harnesses !== undefined) config.harnesses = checkHarnesses(file, parsed.harnesses);
  return config;
}

function checkPrompts(file: string, prompts: unknown): Partial<Prompts> {
  if (!isObject(prompts)) {
    throw new ConfigError(`${file}: prompts is not an object`);
  }
  for (const [key, template] of Object.entries(prompts)) {
    if (!Object.hasOwn(PROMPTS, key)) {
      throw new ConfigError(`${file}: prompts.${key} is not a prompt template`, `Prompt templates: ${Object.keys(PROMPTS).join(", ")}`);
    }
    if (typeof template !== "string") throw new ConfigError(`${file}: prompts.${key} is not a string`);
    for (const [, name] of template.matchAll(PLACEHOLDER)) {
      if (!PLACEHOLDERS.includes(name as Placeholder)) {
        throw new ConfigError(
          `${file}: prompts.${key} has an unknown placeholder {${name}}`,
          `Placeholders: ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}`,
        );
      }
    }
  }
  return prompts;
}

function checkHarnesses(file: string, harnesses: unknown): Record<string, Partial<HarnessConfig>> {
  if (!isObject(harnesses)) throw new ConfigError(`${file}: harnesses is not an object`);
  for (const [name, settings] of Object.entries(harnesses)) {
    const at = `${file}: harnesses.${name}`;
    if (!isObject(settings)) throw new ConfigError(`${at} is not an object`);
    for (const [key, value] of Object.entries(settings)) {
      if (!HARNESS_SETTINGS.includes(key)) {
        throw new ConfigError(`${at}.${key} is not a Harness setting`, `Harness settings: ${HARNESS_SETTINGS.join(", ")}`);
      }
      if (key === "launchMode" && !LAUNCH_MODES.includes(value as LaunchMode)) {
        throw new ConfigError(`${at}.launchMode \`${value}\` is not supported`, `Launch modes: ${LAUNCH_MODES.join(", ")}`);
      }
      if (key === "discovery" && !DISCOVERIES.includes(value as Discovery)) {
        throw new ConfigError(`${at}.discovery \`${value}\` is not supported`, `Discovery: ${DISCOVERIES.join(", ")}`);
      }
      if (["kind", "sigil"].includes(key) && typeof value !== "string") throw new ConfigError(`${at}.${key} is not a string`);
      if (["modelArgs", "effortArgs", "extraArgs", "models", "efforts"].includes(key) && !isStrings(value)) {
        throw new ConfigError(`${at}.${key} is not a list of strings`);
      }
      if (key === "trustPrompt" && !(isObject(value) && typeof value.text === "string" && isStrings(value.keys))) {
        throw new ConfigError(`${at}.trustPrompt is not { text, keys }`);
      }
    }
    if (!Object.hasOwn(HARNESSES, name)) {
      const missing = REQUIRED_HARNESS_SETTINGS.find((key) => !Object.hasOwn(settings, key));
      if (missing) {
        throw new ConfigError(`${at} is missing ${missing}`, `A new Harness needs ${REQUIRED_HARNESS_SETTINGS.join(", ")}`);
      }
    }
  }
  return harnesses as Record<string, Partial<HarnessConfig>>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function findRepo(config: Config, slug: string) {
  return config.repos.find((r) => sameSlug(r.slug, slug));
}

export function saveConfig(dir: string, config: Config) {
  writeJson(dir, "config.json", config);
}

/** Replace `dir/name` with `value` as JSON, atomically. */
export function writeJson(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
