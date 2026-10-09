import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Harness, type Launch, MCP_SERVER, type ModelChoice, launchArgs } from "./harness";
import { DEFAULT_VARIANT_FILE } from "./config";
import { WorldError } from "./world";

/**
 * The Effort of an opencode2 model without variants. Choosing it names no
 * variant and clears the saved one, so the model runs as it comes.
 */
export const DEFAULT_EFFORT = "default";

/** What opencode2 always runs with in a pane, before the Harness's args: a private server. */
export const PANE_ARGS = ["--standalone"];

/**
 * The enabled models of `opencode2 api model.list`, in its order, as
 * `provider/model` (the form its config and saved variants use), with their
 * variants as Efforts.
 */
export function parseOpencodeModels(text: string): ModelChoice[] {
  try {
    const catalog = JSON.parse(text) as {
      data: { id: string; providerID: string; enabled?: boolean; variants?: { id: string }[] }[];
    };
    return catalog.data
      .filter((m) => m.enabled !== false)
      .map((m) => {
        if (typeof m.id !== "string" || typeof m.providerID !== "string") throw new Error("model without an id");
        const efforts = (m.variants ?? []).map((v) => v.id);
        return { model: `${m.providerID}/${m.id}`, efforts: efforts.length ? efforts : [DEFAULT_EFFORT] };
      });
  } catch {
    throw new WorldError("`opencode2 api model.list` printed an unexpected catalog");
  }
}

/**
 * The shell command line that runs opencode2 in a pane: the model, with the
 * Effort as its variant, in `OPENCODE_CONFIG_CONTENT` for both the default
 * and the build agent (which otherwise keeps its own), and the Lead's MCP
 * server with it, then `--standalone` and the Harness's args. `env` keeps
 * it valid in any shell.
 */
export function paneCommand(harness: Harness, launch: Launch) {
  const model = launch.effort === DEFAULT_EFFORT ? launch.model : `${launch.model}#${launch.effort}`;
  const mcp = launch.mcp && { mcp: { [MCP_SERVER]: { type: "remote", url: launch.mcp.mcpUrl } } };
  const config = JSON.stringify({ model, agents: { build: { model } }, ...mcp });
  const args = [harness.command!, ...PANE_ARGS, ...launchArgs(harness, launch)];
  return `env OPENCODE_CONFIG_CONTENT=${shellQuote(config)} ${args.map(shellQuote).join(" ")}`;
}

/**
 * Save `effort` as opencode2's variant for `model`, since a saved variant
 * overrides the config's (ADR-0005). Every other preference in the file is
 * kept; one that can't be read is left alone and fails the launch.
 */
export function saveVariant(harness: Harness, model: string, effort: string) {
  const file = variantFile(harness);
  let saved: { recent?: unknown; favorite?: unknown; variant?: Record<string, string> } & Record<string, unknown>;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new WorldError(`${file} is not valid JSON; fix or delete it`);
    saved = { recent: [], favorite: [] };
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) {
    throw new WorldError(`${file} is not a JSON object; fix or delete it`);
  }
  const { [model]: _, ...others } = saved.variant ?? {};
  saved.variant = effort === DEFAULT_EFFORT ? others : { ...saved.variant, [model]: effort };
  mkdirSync(dirname(file), { recursive: true });
  // Per process, so concurrent dispatches don't write over each other's half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(saved));
  renameSync(tmp, file);
}

function variantFile(harness: Harness) {
  const file = harness.variantFile ?? DEFAULT_VARIANT_FILE;
  return file.startsWith("~/") ? join(homedir(), file.slice(2)) : file;
}

/** `word` as one POSIX shell word: as is when it is plain, else single-quoted. */
function shellQuote(word: string) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}
