import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ORDERS, ORDERS_HELP, type Orders, isOrder } from "./orders";
import { sameSlug } from "./slug";

export interface Repo {
  slug: string;
  path: string;
  linear?: LinearSelector;
  /** How many Specs may run in the Repo at once; DEFAULT_MAX_RUNNING_SPECS when unset. */
  maxRunningSpecs?: number;
  /** The Base a Dispatch starts from unless stacked or given `--base`; origin's default branch when unset. */
  base?: string;
}

/** The running Specs a Repo allows unless config sets its own cap. */
export const DEFAULT_MAX_RUNNING_SPECS = 2;

export interface LinearSelector {
  team: string;
  project?: string;
  label?: string;
}

export interface Config {
  repos: Repo[];
  /** Prompt templates the user set; unset ones take their default from PROMPTS. */
  prompts?: Partial<Prompts>;
  /** Harness settings the user set, by Harness, over HARNESSES; a new name defines a new Harness. */
  harnesses?: Record<string, Partial<HarnessConfig>>;
  /** The launch `advance` dispatches with, so no one chooses it at start time (ADR-0009). */
  scheduler?: Partial<LaunchDefaults>;
  /** The launch `lead start` uses for each of `--harness`, `--model` and `--effort` it isn't given. */
  lead?: Partial<LaunchDefaults>;
  /** The Standing orders the user set; unset ones take their default from ORDERS (ADR-0010). */
  orders?: Partial<Orders>;
  /** The voice services the user set; voice is off for one left out. */
  voice?: VoiceConfig;
}

/** Transcription, speech and the Scribe: each an OpenAI-compatible endpoint nico-agent doesn't run (ADR-0001). */
export const VOICE_SERVICES = ["transcribe", "speak", "scribe"] as const;
export type VoiceService = (typeof VOICE_SERVICES)[number];
export type VoiceConfig = Partial<Record<VoiceService, VoiceEndpoint>>;

/**
 * An OpenAI-compatible service: `url` is its base, up to and including `/v1`;
 * `keyEnv` names the environment variable holding its API key, for one that
 * needs a key; `voice` is the voice `speak` reads in.
 */
export interface VoiceEndpoint {
  url: string;
  model: string;
  keyEnv?: string;
  voice?: string;
}

const VOICE_SETTINGS: Record<VoiceService, string[]> = {
  transcribe: ["url", "model", "keyEnv"],
  speak: ["url", "model", "keyEnv", "voice"],
  scribe: ["url", "model", "keyEnv"],
};
/** Where the voice services are set up and configured. */
export const VOICE_DOC = "docs/voice.md";
const VOICE_HELP = `See ${VOICE_DOC} for the voice block`;

/** Every Standing order, the config's over the defaults; read from a fresh `loadConfig`, never cached. */
export function standingOrders(config: Config): Orders {
  const defaults = Object.fromEntries(Object.entries(ORDERS).map(([name, order]) => [name, order.default])) as Orders;
  return { ...defaults, ...config.orders };
}

/** A launch chosen ahead in config: the Scheduler's for every Dispatch `advance` starts, the Lead's. */
export interface LaunchDefaults {
  harness: string;
  model: string;
  effort: string;
}

export const SCHEDULER_DEFAULTS = ["harness", "model", "effort"] as const;

/** The Lead's defaults have the same keys as the Scheduler's. */
export const LEAD_DEFAULTS = SCHEDULER_DEFAULTS;

/**
 * How a Harness is launched (ADR-0005). `modelArgs` and `effortArgs` hold the
 * `{model}` and `{effort}` placeholders; `trustArgs` trust the Repo's clone
 * at `{repoPath}` for this launch only; `mcpArgs` connect the Lead to
 * `serve`'s MCP server at `{mcpUrl}`, or through the config file at
 * `{mcpConfig}`, and are left out of a Dispatch; `extraArgs` follow them on
 * every launch. `models` overrides discovered models, and `efforts` sets the Effort
 * levels of every model, overriding discovered ones.
 */
export interface HarnessConfig {
  launchMode: LaunchMode;
  /** herdr's agent kind; required by `herdr-kind`. */
  kind?: string;
  /** The binary `pane-command` runs in the pane (opencode2), and discovers models with. */
  command?: string;
  /** opencode2's saved per-model variant file, where `pane-command` writes the Effort; `~/` is the home directory. */
  variantFile?: string;
  sigil: string;
  modelArgs: string[];
  effortArgs: string[];
  extraArgs: string[];
  trustArgs?: string[];
  mcpArgs?: string[];
  /** Where the Harness finds a project's skills, relative to its cwd; the Lead's skill goes there in its home. */
  skillsDir?: string;
  models?: string[];
  efforts?: string[];
  /** Where the models and their Effort levels are discovered from. */
  discovery?: Discovery;
  /** The question the Harness asks before working in a new folder, and the keys that answer yes. */
  trustPrompt?: { text: string; keys: string[] };
}

/**
 * `herdr-kind` has herdr start the agent; `pane-command` runs opencode2 in
 * the pane and names the agent once herdr detects it.
 */
export const LAUNCH_MODES = ["herdr-kind", "pane-command"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export const DISCOVERIES = ["codex", "opencode2"] as const;
export type Discovery = (typeof DISCOVERIES)[number];

/** Where opencode2 saves its per-model variants, unless XDG_STATE_HOME moves it. */
export const DEFAULT_VARIANT_FILE = "~/.local/state/opencode/model.json";

/** The built-in Harnesses; claude's models are its aliases. */
export const HARNESSES: Record<string, HarnessConfig> = {
  claude: {
    launchMode: "herdr-kind",
    kind: "claude",
    sigil: "/",
    modelArgs: ["--model", "{model}"],
    effortArgs: ["--effort", "{effort}"],
    extraArgs: [],
    mcpArgs: ["--mcp-config", "{mcpConfig}"],
    skillsDir: ".claude/skills",
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
    // codex asks to trust the clone (not the worktree) even when herdr reports it ready; this
    // form of -c answers it for this session without writing ~/.codex/config.toml.
    trustArgs: ["-c", 'projects={"{repoPath}"={trust_level="trusted"}}'],
    // The Lead's home is no git repo, and codex looks for a project's skills only at its root,
    // found by `.git` unless no markers are set: then the cwd is the root.
    mcpArgs: ["-c", 'mcp_servers.nico-agent.url="{mcpUrl}"', "-c", "project_root_markers=[]"],
    skillsDir: ".agents/skills",
    discovery: "codex",
  },
  // Its TUI takes no model or Effort flag: the model goes in OPENCODE_CONFIG_CONTENT and the
  // Effort in the saved variant file, so modelArgs and effortArgs are empty (ADR-0005); the MCP
  // server goes in OPENCODE_CONFIG_CONTENT too, so mcpArgs is empty as well.
  opencode2: {
    launchMode: "pane-command",
    command: "opencode2",
    sigil: "@",
    modelArgs: [],
    effortArgs: [],
    extraArgs: [],
    mcpArgs: [],
    skillsDir: ".opencode/skills",
    discovery: "opencode2",
    variantFile: DEFAULT_VARIANT_FILE,
  },
};

const REQUIRED_HARNESS_SETTINGS = ["launchMode", "sigil", "modelArgs", "effortArgs"] as const;
/** What each Launch mode launches. */
const LAUNCH_TARGET: Record<LaunchMode, "kind" | "command"> = { "herdr-kind": "kind", "pane-command": "command" };
const HARNESS_SETTINGS = [
  "launchMode", "kind", "command", "sigil", "modelArgs", "effortArgs", "extraArgs", "trustArgs", "mcpArgs", "skillsDir",
  "models", "efforts", "discovery", "trustPrompt", "variantFile",
];
const NEW_HARNESS_HELP = `A new Harness needs ${REQUIRED_HARNESS_SETTINGS.join(", ")}, and kind (herdr-kind) or command (pane-command)`;

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
 * `research` prompts it instead for a Research issue. `botSuffix` is appended to either as is, with no separator, when the GitHub App
 * is installed on the Repo, so it carries its own leading punctuation.
 * `{baseBranch}` is the Dispatch's Base. `review` prompts the Reviewer; only it has a PR to fill `{prUrl}` and
 * `{prBaseBranch}` with. `lead` starts the Lead on its skill.
 */
export interface Prompts {
  implement: string;
  research: string;
  botSuffix: string;
  review: string;
  lead: string;
}

export const PROMPTS: Prompts = {
  implement: "{sigil}implement {issueUrl} as draft PR against {baseBranch}",
  research:
    "{sigil}research {issueUrl} yourself, not in a background agent, against primary sources; " +
    "write the findings, with their sources, to one Markdown file in docs/research/ and open it as a draft PR against {baseBranch}",
  botSuffix:
    ", opened with `ghbot pr create` (not `gh`); end every commit message with the trailer " +
    "`Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>`",
  review: "{sigil}code-review {prUrl} against {prBaseBranch} for the spec at {issueUrl}",
  lead: "{sigil}lead",
};

export const PLACEHOLDERS = ["sigil", "issueUrl", "baseBranch", "prUrl", "prBaseBranch"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const PLACEHOLDER = /\{(\w+)\}/g;

/** A template with each `{placeholder}` replaced by its value; one without a value is left as is. */
export function fillTemplate(template: string, values: Partial<Record<Placeholder, string>>) {
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
  const config: Config = { repos: checkRepos(file, parsed.repos ?? []) };
  if (parsed.prompts !== undefined) config.prompts = checkPrompts(file, parsed.prompts);
  if (parsed.harnesses !== undefined) config.harnesses = checkHarnesses(file, parsed.harnesses);
  if (parsed.scheduler !== undefined) config.scheduler = checkLaunchDefaults(file, "scheduler", "Scheduler", parsed.scheduler);
  if (parsed.lead !== undefined) config.lead = checkLaunchDefaults(file, "lead", "Lead", parsed.lead);
  if (parsed.orders !== undefined) config.orders = checkOrders(file, parsed.orders);
  if (parsed.voice !== undefined) config.voice = checkVoice(file, parsed.voice);
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

function checkRepos(file: string, repos: Repo[]): Repo[] {
  repos.forEach((repo, i) => {
    const cap = repo.maxRunningSpecs;
    if (cap !== undefined && !(Number.isInteger(cap) && cap > 0)) throw new ConfigError(`${file}: repos[${i}].maxRunningSpecs is not a positive integer`);
    if (repo.base !== undefined && (typeof repo.base !== "string" || repo.base === "")) throw new ConfigError(`${file}: repos[${i}].base is not a branch name`);
  });
  return repos;
}

/** The `scheduler` or `lead` launch defaults, each a string. */
function checkLaunchDefaults(file: string, section: "scheduler" | "lead", owner: string, defaults: unknown): Partial<LaunchDefaults> {
  if (!isObject(defaults)) throw new ConfigError(`${file}: ${section} is not an object`);
  for (const [key, value] of Object.entries(defaults)) {
    if (!(SCHEDULER_DEFAULTS as readonly string[]).includes(key)) {
      throw new ConfigError(`${file}: ${section}.${key} is not a ${owner} default`, `${owner} defaults: ${SCHEDULER_DEFAULTS.join(", ")}`);
    }
    if (typeof value !== "string") throw new ConfigError(`${file}: ${section}.${key} is not a string`);
  }
  return defaults as Partial<LaunchDefaults>;
}

function checkOrders(file: string, orders: unknown): Partial<Orders> {
  if (!isObject(orders)) throw new ConfigError(`${file}: orders is not an object`);
  for (const [key, value] of Object.entries(orders)) {
    if (!isOrder(key)) throw new ConfigError(`${file}: orders.${key} is not a Standing order`, ORDERS_HELP);
    if (typeof value !== "boolean") throw new ConfigError(`${file}: orders.${key} is not true or false`);
  }
  return orders as Partial<Orders>;
}

function checkVoice(file: string, voice: unknown): VoiceConfig {
  if (!isObject(voice)) throw new ConfigError(`${file}: voice is not an object`, VOICE_HELP);
  for (const [service, endpoint] of Object.entries(voice)) {
    const at = `${file}: voice.${service}`;
    if (!(VOICE_SERVICES as readonly string[]).includes(service)) {
      throw new ConfigError(`${at} is not a voice service`, `Voice services: ${VOICE_SERVICES.join(", ")}`);
    }
    if (!isObject(endpoint)) throw new ConfigError(`${at} is not an object`, VOICE_HELP);
    const settings = VOICE_SETTINGS[service as VoiceService];
    for (const [key, value] of Object.entries(endpoint)) {
      if (!settings.includes(key)) throw new ConfigError(`${at}.${key} is not a ${service} setting`, `${service} settings: ${settings.join(", ")}`);
      if (typeof value !== "string" || value === "") throw new ConfigError(`${at}.${key} is not a non-empty string`, VOICE_HELP);
    }
    for (const key of ["url", "model"]) {
      if (!Object.hasOwn(endpoint, key)) throw new ConfigError(`${at} is missing ${key}`, VOICE_HELP);
    }
    if (!isHttpUrl(endpoint.url as string)) throw new ConfigError(`${at}.url is not an http(s) URL`, "e.g. http://127.0.0.1:8880/v1");
  }
  return voice as VoiceConfig;
}

function isHttpUrl(text: string) {
  try {
    return ["http:", "https:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
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
      if (["kind", "command", "sigil", "variantFile", "skillsDir"].includes(key) && typeof value !== "string") throw new ConfigError(`${at}.${key} is not a string`);
      if (["modelArgs", "effortArgs", "extraArgs", "trustArgs", "mcpArgs", "models", "efforts"].includes(key) && !isStrings(value)) {
        throw new ConfigError(`${at}.${key} is not a list of strings`);
      }
      if (key === "trustPrompt" && !(isObject(value) && typeof value.text === "string" && isStrings(value.keys))) {
        throw new ConfigError(`${at}.trustPrompt is not { text, keys }`);
      }
    }
    if (!Object.hasOwn(HARNESSES, name)) {
      const missing = REQUIRED_HARNESS_SETTINGS.find((key) => !Object.hasOwn(settings, key));
      if (missing) throw new ConfigError(`${at} is missing ${missing}`, NEW_HARNESS_HELP);
    }
    const merged: Partial<HarnessConfig> = { ...HARNESSES[name], ...settings };
    const launched = LAUNCH_TARGET[merged.launchMode!];
    if (merged[launched] === undefined) {
      throw new ConfigError(`${at} is missing ${launched}`, `A ${merged.launchMode} Harness needs ${launched}`);
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
