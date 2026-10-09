import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import leadShaping from "./lead-shaping.md" with { type: "text" };
import leadSkill from "./lead-skill.md" with { type: "text" };
import { LEAD_DEFAULTS, type LaunchDefaults, fillTemplate, findRepo, harnessConfigs, loadConfig, prompts, writeJson } from "./config";
import { type Progress, agentSteps, chooseLaunch, prompt, runPhase } from "./dispatch";
import { DispatchError, LaunchError } from "./dispatch-error";
import { type Harness, MCP_SERVER } from "./harness";
import type { Launch } from "./state";
import { withFileLock, writeJsonAtomic } from "./state";
import { type World, WorldError } from "./world";

/** The herdr agent name of the Lead; herdr names are unique, so there is one Lead. */
export const LEAD_AGENT = "lead";

/** The steps that start the Lead, in order: the Dispatch's agent steps after its home and workspace. */
export const LEAD_STEPS = ["home", "workspace", "tab", "agent start", "agent ready", "prompt"] as const;
export type LeadStep = (typeof LEAD_STEPS)[number];

/** The skills the Lead shapes work with, linked into its home from the nico-agent checkout. */
const SHAPING_SKILLS = ["grilling", "to-spec", "to-tickets", "triage", "retro"];

/** The Repo whose clone the shaping skills come from. */
export const NICO_AGENT_SLUG = "nicolasLuduena/nico-agent";

/** Where a Harness without its own `skillsDir` finds a project's skills. */
const DEFAULT_SKILLS_DIR = ".agents/skills";

/** Where the nico-agent checkout keeps its skills. */
const CHECKOUT_SKILLS_DIR = ".agents/skills";

const STATUS_HELP = "Run `nico-agent lead status` to see the Lead";

/**
 * The local record of the running Lead (ADR-0002), like a Dispatch's: where
 * it runs, how it was launched, and how far its steps got. The conversation is
 * kept elsewhere, so forgetting this record never loses it.
 */
export interface LeadRecord extends Progress<LeadStep> {
  workspace?: string;
  /** The Lead's home: its cwd, with its skill and MCP config. */
  home: string;
  /** `serve`'s MCP server the Lead was connected to. */
  mcpUrl: string;
  agent: Launch;
  /** What went wrong without failing the launch, such as a shaping skill left out. */
  warnings?: string[];
  /** Id of the process running the steps, or stopping the Lead, while one is. */
  runner?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadRequest extends Partial<LaunchDefaults> {
  /** `serve`'s MCP server URL. */
  mcpUrl: string;
}

export interface LeadStart {
  lead: LeadRecord;
  /**
   * `new`, `existing` for a no-op while the Lead runs, `resumed` from the step
   * that failed or was cut short, or `restarted` when the old Lead was stopped
   * first: launched differently, or its agent gone from herdr.
   */
  outcome: "new" | "existing" | "resumed" | "restarted";
  resumedFrom?: LeadStep;
  /** The old Lead's launch, when restarted. */
  replaced?: Launch;
}

const FILE = "lead.json";

/** The Lead's record, if it was started and not stopped. */
function readLead(configDir: string): LeadRecord | null {
  try {
    return JSON.parse(readFileSync(join(configDir, FILE), "utf8")) as LeadRecord;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function leadHome(configDir: string) {
  return join(configDir, "lead");
}

/**
 * Start the Lead as the herdr agent `lead` in its own workspace, on the
 * request's launch or the `lead` defaults from config, connected to `serve`'s
 * MCP server and prompted with its skill. Idempotent (ADR-0006): while the
 * Lead runs a second start is a no-op, a failed start is resumed from its
 * step, and a different launch stops the old Lead first. The conversation
 * stays, so the new Lead picks it up.
 */
export async function startLead(world: World, configDir: string, request: LeadRequest): Promise<LeadStart> {
  const launch = leadLaunch(configDir, request);
  const harness = await chooseLeadHarness(world, configDir, request, launch);
  const fresh = (): LeadRecord => {
    const now = world.now().toISOString();
    return {
      home: leadHome(configDir),
      mcpUrl: request.mcpUrl,
      agent: { agent: LEAD_AGENT, ...launch },
      completed: [],
      createdAt: now,
      updatedAt: now,
    };
  };
  const leased = await leaseLead(world, configDir, fresh);
  let record = leased.record;
  let outcome: LeadStart["outcome"] = "new";
  let replaced: Launch | undefined;
  if (!leased.created) {
    // Whatever throws before the steps run must not leave the Lead leased.
    try {
      const same = sameLaunch(record, launch, request.mcpUrl);
      const done = record.completed.length === LEAD_STEPS.length && !record.failure;
      if (same && done && (await isRunning(world))) {
        await release(world, configDir, record);
        return { lead: record, outcome: "existing" };
      }
      if (same && !done) {
        const resumedFrom = record.failure?.step ?? LEAD_STEPS.find((s) => !record.completed.includes(s))!;
        return { lead: await runLead(world, configDir, harness, record), outcome: "resumed", resumedFrom };
      }
      // Launched differently, or its agent is gone: stop the old Lead and start afresh.
      if (record.workspace) await closeWorkspace(world, configDir, record);
      replaced = record.agent;
      record = { ...fresh(), runner: world.processId() };
      await saveLead(world, configDir, record);
      outcome = "restarted";
    } catch (e) {
      await release(world, configDir, record);
      throw e;
    }
  }
  return { lead: await runLead(world, configDir, harness, record), outcome, ...(replaced && { replaced }) };
}

/**
 * What `lead status` reports: the record, where the Lead stands (`running`,
 * `starting`, `Failed at <step>`, `interrupted before <step>`, or `gone from
 * herdr`), and its Agent state as herdr reports it. Null without a Lead.
 */
export async function leadStatus(world: World, configDir: string) {
  const record = readLead(configDir);
  if (!record) return null;
  const agent = (await world.herdrAgents()).find((a) => a.name === LEAD_AGENT);
  const next = LEAD_STEPS.find((s) => !record.completed.includes(s));
  const lead = record.failure
    ? `Failed at ${record.failure.step}`
    : record.runner !== undefined && world.processAlive(record.runner)
      ? "starting"
      : next
        ? `interrupted before ${next}`
        : agent
          ? "running"
          : "gone from herdr";
  return { record, lead, state: agent?.state ?? "unknown" };
}

/**
 * Stop the Lead: close its workspace and forget its record. Its home and the
 * conversation stay for the next start. A no-op without a Lead.
 */
export async function stopLead(world: World, configDir: string): Promise<{ outcome: "stopped" | "none"; workspace?: string }> {
  const leased = await leaseLead(world, configDir);
  if (!leased) return { outcome: "none" };
  const { record } = leased;
  const { workspace } = record;
  if (workspace) await closeWorkspace(world, configDir, record);
  await withFileLock(configDir, FILE, () => unlinkSync(join(configDir, FILE)));
  return { outcome: "stopped", ...(workspace && { workspace }) };
}

/** The launch of a request, each choice not given taken from the `lead` defaults in config. */
function leadLaunch(configDir: string, request: LeadRequest): LaunchDefaults {
  const { lead = {} } = loadConfig(configDir);
  const launch = Object.fromEntries(LEAD_DEFAULTS.map((key) => [key, request[key] ?? lead[key]])) as Partial<LaunchDefaults>;
  const missing = LEAD_DEFAULTS.filter((key) => launch[key] === undefined);
  if (missing.length) {
    throw new DispatchError(
      `the Lead ${missing.length > 1 ? "defaults" : "default"} ${missing.map((key) => `lead.${key}`).join(", ")} ${missing.length > 1 ? "are" : "is"} not set`,
      [
        `Set "lead": {"harness": "claude", "model": "opus", "effort": "high"} (your choice) in ${join(configDir, "config.json")}`,
        `Or pass ${missing.map((key) => `--${key}`).join(", ")} to \`nico-agent lead start\``,
      ],
    );
  }
  return launch as LaunchDefaults;
}

/** The launch's Harness, once valid; a bad default is named as the config's fault. */
async function chooseLeadHarness(world: World, configDir: string, request: LeadRequest, launch: LaunchDefaults): Promise<Harness> {
  let harness: Harness;
  try {
    harness = await chooseLaunch(world, configDir, launch);
  } catch (e) {
    if (!(e instanceof LaunchError) || request[e.key] !== undefined) throw e;
    throw new DispatchError(`lead.${e.key} in ${join(configDir, "config.json")}: ${e.message}`, e.help);
  }
  // opencode2 takes its MCP server in its config content, not in args.
  if (harness.launchMode === "herdr-kind" && !harness.mcpArgs?.length) {
    throw new DispatchError(`${harness.name} has no mcpArgs to connect the Lead to nico-agent's MCP server`, [
      `Set harnesses.${harness.name}.mcpArgs in ${join(configDir, "config.json")}, with {mcpUrl} or {mcpConfig} for the server`,
    ]);
  }
  return harness;
}

function sameLaunch(record: LeadRecord, launch: LaunchDefaults, mcpUrl: string) {
  const { harness, model, effort } = record.agent;
  return harness === launch.harness && model === launch.model && effort === launch.effort && record.mcpUrl === mcpUrl;
}

async function isRunning(world: World) {
  return (await world.herdrAgents()).some((a) => a.name === LEAD_AGENT);
}

/** Run the Lead's steps `record` has not completed, as the runner holding its lease. */
async function runLead(world: World, configDir: string, harness: Harness, record: LeadRecord) {
  const { home } = record;
  const mcp = { mcpUrl: record.mcpUrl, mcpConfig: join(home, MCP_CONFIG) };
  const steps: Record<LeadStep, () => Promise<void>> = {
    home: async () => {
      const warnings = writeHome(configDir, harness, record.mcpUrl);
      if (warnings.length) record.warnings = warnings;
      else delete record.warnings;
    },
    workspace: async () => {
      record.workspace = (await world.herdrWorkspaceCreate({ cwd: home, label: LEAD_AGENT })).workspace;
    },
    ...agentSteps(world, harness, () => ({ workspace: record.workspace!, cwd: home, repoPath: home, mcp }), record.agent, LEAD_AGENT),
    prompt: async () => {
      await prompt(world, LEAD_AGENT, fillTemplate(prompts(loadConfig(configDir)).lead, { sigil: harness.sigil }));
    },
  };
  const save = () => saveLead(world, configDir, record);
  try {
    await runPhase(record, record, LEAD_STEPS, steps, save, (step, e) =>
      new DispatchError(`the Lead failed at ${step}: ${e.message}`, [
        ...(e instanceof DispatchError ? e.help : []),
        STATUS_HELP,
        `Run \`nico-agent lead start\` again to resume from ${step}`,
      ]));
  } finally {
    await release(world, configDir, record);
  }
  return record;
}

const MCP_CONFIG = "mcp.json";

/**
 * Write the Lead's home: its skill and the skill's shaping page where the
 * Harness finds a project's skills, the MCP config naming `serve`'s server,
 * and links to the shaping skills of the nico-agent checkout when it is a
 * configured Repo. The skills an earlier start wrote for another Harness are
 * removed, so no stale copy is left. Returns a warning for each shaping skill left out.
 */
function writeHome(configDir: string, harness: Harness, mcpUrl: string): string[] {
  const home = leadHome(configDir);
  const skillsDir = harness.skillsDir ?? DEFAULT_SKILLS_DIR;
  const skills = join(home, skillsDir);
  for (const other of new Set(Object.values(harnessConfigs(loadConfig(configDir))).map((h) => h.skillsDir ?? DEFAULT_SKILLS_DIR))) {
    if (other !== skillsDir) rmSync(join(home, other), { recursive: true, force: true });
  }
  mkdirSync(join(skills, "lead"), { recursive: true });
  writeFileSync(join(skills, "lead", "SKILL.md"), leadSkill);
  writeFileSync(join(skills, "lead", "SHAPING.md"), leadShaping);
  writeJson(home, MCP_CONFIG, { mcpServers: { [MCP_SERVER]: { type: "http", url: mcpUrl } } });
  const repo = findRepo(loadConfig(configDir), NICO_AGENT_SLUG);
  if (!repo) {
    return [`the shaping skills (${SHAPING_SKILLS.join(", ")}) are left out: ${NICO_AGENT_SLUG} is not a configured Repo`];
  }
  const warnings: string[] = [];
  for (const name of SHAPING_SKILLS) {
    const source = join(repo.path, CHECKOUT_SKILLS_DIR, name);
    const link = join(skills, name);
    // Ours to replace: a link from an earlier start, maybe to a moved clone.
    rmSync(link, { recursive: true, force: true });
    if (!existsSync(source)) {
      warnings.push(`the shaping skill ${name} is left out: ${source} does not exist`);
      continue;
    }
    symlinkSync(source, link);
  }
  return warnings;
}

/** Close the Lead's workspace, forgetting it once closed so a failed close is retried. */
async function closeWorkspace(world: World, configDir: string, record: LeadRecord) {
  try {
    await world.herdrWorkspaceClose(record.workspace!);
  } catch (e) {
    if (e instanceof WorldError) await release(world, configDir, record);
    throw e;
  }
  delete record.workspace;
}

/**
 * Take over the Lead's record for this process: the existing one, or, with
 * `fresh`, a new one when there is none. Null without either; refused while
 * another live process runs it.
 */
async function leaseLead(world: World, configDir: string): Promise<{ record: LeadRecord; created: false } | null>;
async function leaseLead(world: World, configDir: string, fresh: () => LeadRecord): Promise<{ record: LeadRecord; created: boolean }>;
async function leaseLead(world: World, configDir: string, fresh?: () => LeadRecord) {
  return withFileLock(configDir, FILE, () => {
    const existing = readLead(configDir);
    if (existing?.runner !== undefined && existing.runner !== world.processId() && world.processAlive(existing.runner)) {
      throw new DispatchError("the Lead is busy with another nico-agent", ["Try again once it is done", STATUS_HELP]);
    }
    const record = existing ?? fresh?.();
    if (!record) return null;
    record.runner = world.processId();
    writeJsonAtomic(join(configDir, FILE), record);
    return { record, created: !existing };
  });
}

async function saveLead(world: World, configDir: string, record: LeadRecord) {
  record.updatedAt = world.now().toISOString();
  await withFileLock(configDir, FILE, () => writeJsonAtomic(join(configDir, FILE), record));
}

/** Give up running the Lead's steps, keeping how far they got. */
async function release(world: World, configDir: string, record: LeadRecord) {
  if (record.runner === undefined) return;
  delete record.runner;
  await saveLead(world, configDir, record);
}
