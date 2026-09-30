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
}

/**
 * The prompt templates a Dispatch sends. `implement` prompts the Implementer;
 * `botSuffix` is appended to it as is when the GitHub App is installed on the Repo.
 */
export interface Prompts {
  implement: string;
  botSuffix: string;
}

export const PROMPTS: Prompts = {
  implement: "{sigil}implement {url} as draft PR",
  botSuffix:
    ", opened with `ghbot pr create` (not `gh`); end every commit message with the trailer " +
    "`Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>`",
};

export const PLACEHOLDERS = ["sigil", "url", "issue", "repo", "number", "branch"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** A template with each `{placeholder}` replaced by its value. */
export function fillTemplate(template: string, values: Record<Placeholder, string>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name as Placeholder] ?? match);
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
  return config;
}

function checkPrompts(file: string, prompts: unknown): Partial<Prompts> {
  if (typeof prompts !== "object" || prompts === null || Array.isArray(prompts)) {
    throw new ConfigError(`${file}: prompts is not an object`);
  }
  for (const [key, template] of Object.entries(prompts)) {
    if (!(key in PROMPTS)) {
      throw new ConfigError(`${file}: prompts.${key} is not a prompt template`, `Prompt templates: ${Object.keys(PROMPTS).join(", ")}`);
    }
    if (typeof template !== "string") throw new ConfigError(`${file}: prompts.${key} is not a string`);
    for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
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

export function findRepo(config: Config, slug: string) {
  return config.repos.find((r) => sameSlug(r.slug, slug));
}

export function saveConfig(dir: string, config: Config) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "config.json");
  writeFileSync(`${file}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
