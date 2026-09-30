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
}

export function defaultConfigDir(env: Record<string, string | undefined>) {
  if (env.NICO_AGENT_CONFIG_DIR) return env.NICO_AGENT_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "nico-agent");
}

/** The config file exists but can't be used. */
export class ConfigError extends Error {}

export const CONFIG_ERROR_HELP = "Fix or delete the file and run `nico-agent repo add` again";

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
  return { repos: parsed.repos ?? [] };
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
