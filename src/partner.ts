import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ideaRole from "./partner-idea.md" with { type: "text" };
import partnerSkill from "./partner-skill.md" with { type: "text" };
import { type LaunchDefaults, type Repo, findRepo, loadConfig, writeJson } from "./config";
import { sayToLead } from "./conversation";
import { type Progress, agentSteps, chooseLaunch, prompt, repoName, runPhase } from "./dispatch";
import { DispatchError } from "./dispatch-error";
import { type DiffFile, parseDiff } from "./diff";
import { type Harness, MCP_SERVER, rememberLaunch } from "./harness";
import { nudgeLead } from "./nudge";
import { PARTNER_NAMES, PARTNER_TABS, type PartnerTab, isPartnerTab } from "./partner-tabs";
import type { Launch } from "./state";
import { withFileLock, writeJsonAtomic } from "./state";
import { type Draft, type ThreadEntry, appendAfter, appendThread, loadThread, openDraft, withThread } from "./thread";
import { type PullRequestDescription, type World, WorldError, worldErrorMessage } from "./world";

export { PARTNER_NAMES, PARTNER_TABS, type PartnerTab, isPartnerTab };

/** The steps that start a Partner, in order: a Gardener's, after writing its home. */
export const PARTNER_STEPS = ["home", "fetch", "worktree", "tab", "agent start", "agent ready", "prompt"] as const;
export type PartnerStep = (typeof PARTNER_STEPS)[number];

/**
 * The local record of a tab's Partner (ADR-0014), like a Gardener's: the Repo
 * whose worktree it runs in, how it was launched, where its Thread is kept,
 * and how far its steps got.
 */
export interface Partner extends Progress<PartnerStep> {
  tab: PartnerTab;
  repo: string;
  /** The PR a Review partner reviews; its worktree is on the PR's head branch. */
  pr?: ReviewedPr;
  branch: string;
  base: string;
  worktree?: string;
  workspace?: string;
  agent: Launch;
  /** The MCP server scoped to its Thread. */
  mcpUrl: string;
  /** Its Thread's file, relative to the config directory. */
  thread: string;
  /** Id of the process running the steps, while one is. */
  runner?: number;
  createdAt: string;
  updatedAt: string;
}

/** The PR a Review partner reviews, as it was when the Partner started. */
export interface ReviewedPr {
  number: number;
  url: string;
  title: string;
  /** The branch it merges into, which its diff is taken against. */
  base: string;
  /** Its head branch, which the Partner's worktree checks out. */
  head: string;
}

export interface PartnerRequest extends LaunchDefaults {
  tab: PartnerTab;
  /** The Repo an Idea partner works in. */
  repo?: string;
  /** The PR a Review partner reviews, by URL or `owner/name#N`; its Repo comes with it. */
  pr?: string;
  /** The MCP server scoped to this tab's Thread. */
  mcpUrl: string;
}

export interface PartnerStart {
  partner: Partner;
  /** `new`, `existing` for a no-op while it runs, or `resumed` from the step that failed or was cut short. */
  outcome: "new" | "existing" | "resumed";
  resumedFrom?: PartnerStep;
}

const FILE = "partners.json";
const MCP_CONFIG = "mcp.json";
const SKILL = "SKILL.md";
const PR_BRIEF = "PR.md";
const LIST_HELP = "Run `nico-agent partner list` to see the Partners";

/** Where `serve` answers a tab's Partner: its own MCP server, scoped to its Thread. */
export function partnerMcpPath(tab: PartnerTab) {
  return `/mcp/partner/${tab}`;
}

/** Every Partner's record, by tab. */
export function loadPartners(configDir: string): Partial<Record<PartnerTab, Partner>> {
  try {
    return JSON.parse(readFileSync(join(configDir, FILE), "utf8")) as Partial<Record<PartnerTab, Partner>>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

/** The tab's running Partner; refused when it has none. */
export function partnerOf(configDir: string, tab: PartnerTab): Partner {
  const partner = loadPartners(configDir)[tab];
  if (!partner) throw new DispatchError(`no ${PARTNER_NAMES[tab]} runs`, [`Run \`nico-agent partner start ${tab} --repo <owner/name>\` to start one`, LIST_HELP]);
  return partner;
}

/** Each tab's role, after the skill every Partner shares. */
const ROLES: Partial<Record<PartnerTab, string>> = { idea: ideaRole };

/** A Partner's home: its skill and MCP config, outside the worktree so the worktree stays as the Repo has it. */
function partnerHome(configDir: string, tab: PartnerTab) {
  return join(configDir, "partners", tab);
}

/**
 * Start the tab's Partner (ADR-0014): fetch the Repo's clone, create a
 * worktree workspace on its default branch, start the agent in a `partner`
 * tab connected to the MCP server scoped to its Thread, and prompt it with the
 * Partner skill. One per tab, idempotent (ADR-0006): while it runs a second
 * start returns it, a failed start is resumed from its step, and a start in
 * another Repo or launch is refused until it ends.
 */
export async function startPartner(world: World, configDir: string, request: PartnerRequest): Promise<PartnerStart> {
  const { tab } = request;
  const { repo, pr } = await partnerTarget(world, configDir, request);
  const harness = await chooseLaunch(world, configDir, request);
  // opencode2 takes its MCP server in its config content, not in args.
  if (harness.launchMode === "herdr-kind" && !harness.mcpArgs?.length) {
    throw new DispatchError(`${harness.name} has no mcpArgs to connect a Partner to nico-agent's MCP server`, [
      `Set harnesses.${harness.name}.mcpArgs in ${join(configDir, "config.json")}, with {mcpUrl} or {mcpConfig} for the server`,
    ]);
  }
  const existing = loadPartners(configDir)[tab];
  const reviewed: ReviewedPr | undefined = pr && { number: pr.number, url: pr.url, title: pr.title, base: pr.baseBranch, head: pr.headBranch! };
  const refuse = (record: Partner) => refuseOther(record, request, repo.slug, reviewed);
  if (existing) refuse(existing);
  const fresh = async (): Promise<Partner> => {
    const now = world.now();
    const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
    const name = repoName(repo);
    return {
      tab,
      repo: repo.slug,
      ...(reviewed && { pr: reviewed }),
      // The PR's head branch is likely checked out in its Implementer's worktree already, and git checks a branch out once.
      branch: `partner/${tab}-${name}${reviewed ? `-${reviewed.number}` : ""}-${stamp}`,
      base: `origin/${reviewed?.head ?? await world.gitDefaultBranch(repo.path)}`,
      agent: { agent: `partner-${tab}`, harness: request.harness, model: request.model, effort: request.effort },
      mcpUrl: request.mcpUrl,
      thread: `threads/${tab}-${stamp}.jsonl`,
      completed: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  };
  // Checked again under the lease: another start may have made the tab's Partner since.
  const leased = await lease(world, configDir, tab, existing ? undefined : await fresh(), refuse);
  const record = leased.record;
  if (leased.created) {
    rememberLaunch(configDir, request.harness, request.model, request.effort);
    return { partner: await runPartner(world, configDir, repo, harness, record, pr), outcome: "new" };
  }
  const done = record.completed.length === PARTNER_STEPS.length && !record.failure;
  if (done) {
    await release(world, configDir, record);
    return { partner: record, outcome: "existing" };
  }
  const resumedFrom = record.failure?.step ?? PARTNER_STEPS.find((s) => !record.completed.includes(s))!;
  return { partner: await runPartner(world, configDir, repo, harness, record, pr), outcome: "resumed", resumedFrom };
}

/** Where the tab's Partner works: the PR a Review partner reviews, with its Repo, or the Repo an Idea partner works in. */
async function partnerTarget(world: World, configDir: string, request: PartnerRequest): Promise<{ repo: Repo; pr?: PullRequestDescription }> {
  const config = loadConfig(configDir);
  const configured = (slug: string) => {
    const repo = findRepo(config, slug);
    if (!repo) throw new DispatchError(`${slug} is not a configured Repo`, ["Run `nico-agent repo list` to see the Repos"]);
    return repo;
  };
  if (request.tab !== "review") return { repo: configured(request.repo ?? "") };
  const ref = parsePrRef(request.pr ?? "");
  if (!ref) throw new DispatchError(`\`${request.pr}\` is not a PR`, ["Pass --pr a PR URL, such as https://github.com/acme/api/pull/12, or acme/api#12"]);
  const repo = configured(ref.slug);
  const pr = await world.githubPullRequestDescription(repo.slug, ref.number);
  if (!pr) throw new DispatchError(`${repo.slug}#${ref.number} is not a PR on GitHub`, [`Check the PR number on https://github.com/${repo.slug}/pulls`]);
  const pick = "Run `nico-agent partner prs` to see the open PRs you can review";
  if (pr.state !== "open") throw new DispatchError(`${pr.url} is ${pr.state}; a Review partner reviews open PRs only`, [pick]);
  if (!pr.headBranch) throw new DispatchError(`${pr.url} comes from a fork, so its head branch can't be checked out from ${repo.slug}'s origin`, [pick]);
  return { repo, pr };
}

/** A PR named by its URL or as `owner/name#N`. */
export function parsePrRef(ref: string): { slug: string; number: number } | null {
  const match = ref.trim().match(/^(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?|([\w.-]+\/[\w.-]+)#(\d+))$/i);
  if (!match) return null;
  return { slug: (match[1] ?? match[3])!, number: Number(match[2] ?? match[4]) };
}

/** A PR the user may open in the Review tab. */
export interface PrToReview {
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  draft: boolean;
  base: string;
  head: string;
}

/**
 * Every Repo's open PRs a Review partner can check out, Repo by Repo and
 * newest first: a fork's head is not on the Repo's origin, so its PRs are
 * left out. A Repo GitHub can't list is a warning.
 */
export async function prsToReview(world: World, configDir: string): Promise<{ prs: PrToReview[]; warnings: string[] }> {
  const warnings: string[] = [];
  const listed = await Promise.all(loadConfig(configDir).repos.map(async (repo) => {
    try {
      return await world.githubOpenPullRequests(repo.slug);
    } catch (e) {
      warnings.push(`could not list ${repo.slug}'s open PRs: ${worldErrorMessage(e)}`);
      return [];
    }
  }));
  const prs = listed.flat().flatMap((pr) => pr.headBranch
    ? [{ repo: pr.repo, number: pr.number, url: pr.url, title: pr.title, author: pr.author, draft: pr.draft, base: pr.baseBranch, head: pr.headBranch }]
    : []);
  return { prs, warnings };
}

/** Refuse a start that is not the running Partner's own: another Repo or PR, launch, or `serve`. */
function refuseOther(existing: Partner, request: PartnerRequest, repo: string, pr: ReviewedPr | undefined) {
  const { tab } = request;
  const { harness, model, effort } = existing.agent;
  const where = existing.pr && existing.pr.number !== pr?.number || existing.repo !== repo
    ? existing.pr ? `on ${existing.repo}#${existing.pr.number}` : `in ${existing.repo}`
    : harness !== request.harness || model !== request.model || effort !== request.effort
      ? `on ${harness} ${model} ${effort}`
      : existing.mcpUrl !== request.mcpUrl ? `connected to ${existing.mcpUrl}` : null;
  if (where) throw new DispatchError(`the ${PARTNER_NAMES[tab]} already runs ${where}`, [`Run \`nico-agent partner end ${tab}\` to end it first`, LIST_HELP]);
}

/** What `partner list` reports of each Partner: where it stands, as the Lead's status does, and its Agent state. */
export async function partnerRows(world: World, configDir: string) {
  const partners = PARTNER_TABS.flatMap((tab) => loadPartners(configDir)[tab] ?? []);
  if (!partners.length) return [];
  const agents = await world.herdrAgents();
  return partners.map((p) => {
    const agent = agents.find((a) => a.name === p.agent.agent);
    const next = PARTNER_STEPS.find((s) => !p.completed.includes(s));
    const partner = p.failure
      ? `Failed at ${p.failure.step}`
      : p.runner !== undefined && world.processAlive(p.runner)
        ? "starting"
        : next
          ? `interrupted before ${next}`
          : agent
            ? "running"
            : "gone from herdr";
    const { agent: name, harness, model, effort } = p.agent;
    return {
      tab: p.tab, partner, state: agent?.state ?? "unknown", repo: p.repo, ...(p.pr && { pr: p.pr }), agent: name, harness, model, effort,
      ...(p.workspace && { workspace: p.workspace }),
      ...(p.failure && { failure: p.failure }),
      startedAt: p.createdAt,
    };
  });
}

/** End the tab's Partner: remove its worktree and workspace, which stops its agent, and forget it. Its Thread's file stays. */
export async function endPartner(world: World, configDir: string, tab: PartnerTab): Promise<{ outcome: "ended" | "none"; workspace?: string }> {
  if (!loadPartners(configDir)[tab]) return { outcome: "none" };
  const { record } = await lease(world, configDir, tab);
  const { workspace } = record;
  try {
    if (workspace) await world.herdrWorktreeRemove(workspace);
  } catch (e) {
    await release(world, configDir, record);
    throw e;
  }
  await withFileLock(configDir, FILE, () => {
    const all = loadPartners(configDir);
    delete all[tab];
    writeJsonAtomic(join(configDir, FILE), all);
  });
  return { outcome: "ended", ...(workspace && { workspace }) };
}

/** The tab's Partner's Thread, oldest first, with the Partner. */
export function partnerThread(configDir: string, tab: PartnerTab): { partner: Partner; entries: ThreadEntry[] } {
  const partner = partnerOf(configDir, tab);
  return { partner, entries: loadThread(configDir, partner.thread) };
}

/**
 * The diff of the PR the tab's Partner reviews, read from its checkout
 * against the PR's base (`git diff origin/<base>...HEAD`), so it costs GitHub nothing.
 */
export async function partnerDiff(world: World, configDir: string, tab: PartnerTab): Promise<{ partner: Partner; pr: ReviewedPr; files: DiffFile[] }> {
  const partner = partnerOf(configDir, tab);
  const { pr, worktree } = partner;
  if (!pr) throw new DispatchError(`the ${PARTNER_NAMES[tab]} reviews no PR, so it has no diff`, [`Run \`nico-agent partner log ${tab}\` to read its Thread`]);
  if (!worktree) throw new DispatchError(`the ${PARTNER_NAMES[tab]} has no worktree yet`, [LIST_HELP, `Run the same \`nico-agent partner start ${tab}\` again to resume it`]);
  return { partner, pr, files: parseDiff(await world.gitDiff(worktree, `origin/${pr.base}`)) };
}

/**
 * The user's message to the tab's Partner: kept in its Thread, then typed
 * into its pane. A Partner that could not take it leaves the message in the
 * Thread, with a warning.
 */
export async function sayToPartner(world: World, configDir: string, tab: PartnerTab, text: string) {
  const partner = partnerOf(configDir, tab);
  const entry = await appendThread(configDir, partner.thread, { type: "user", text }, world.now());
  const warnings: string[] = [];
  const screen = `run \`herdr agent read ${partner.agent.agent}\` to see its screen`;
  try {
    const { started } = await world.herdrAgentPrompt(partner.agent.agent, text);
    if (!started) warnings.push(`the ${PARTNER_NAMES[tab]} has not started working on it; ${screen}`);
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    warnings.push(`could not type it into the ${PARTNER_NAMES[tab]}'s pane: ${e.message}; ${screen}`);
  }
  return { entry, warnings };
}

/** The Partner's own entry in its Thread: a reply (its `say`) or a Hand-off draft (its `hand_off`). */
export async function partnerWrites(world: World, configDir: string, tab: PartnerTab, type: "partner" | "draft", text: string) {
  return appendThread(configDir, partnerOf(configDir, tab).thread, { type, text }, world.now());
}

/**
 * Hand the open draft `draft` to the Lead, as the user approved it or with
 * the user's `edited` text. The Thread records the Hand-off first, under its
 * lock, so a draft is handed once however many approvals race; then it is
 * appended to the Lead's Conversation as the user's message naming the
 * Partner, which Nudges the Lead.
 */
export async function handOff(world: World, configDir: string, tab: PartnerTab, draft: number, edited?: string) {
  const partner = partnerOf(configDir, tab);
  const handoff = await withThread(configDir, partner.thread, (entries) => {
    const open = openToHand(entries, tab, draft);
    return appendAfter(configDir, partner.thread, entries, { type: "handoff", draft, text: edited ?? open.text }, world.now());
  });
  const lead = await sayToLead(configDir, { text: `Hand-off from the ${PARTNER_NAMES[tab]} (${partner.repo}):\n\n${handoff.text}` }, world.now());
  return { lead, handoff, warnings: await nudgeLead(world, configDir) };
}

/** The open draft when it is `draft`; refused when it was handed already, replaced since, or is no draft. */
function openToHand(entries: ThreadEntry[], tab: PartnerTab, draft: number): Draft {
  const open = openDraft(entries);
  if (open?.id === draft) return open;
  const handed = entries.some((e) => e.type === "handoff" && e.draft === draft);
  const wasDraft = entries.some((e) => e.type === "draft" && e.id === draft);
  const why = handed
    ? `draft ${draft} was already handed to the Lead`
    : wasDraft
      ? `draft ${draft} is not the open hand-off (${open ? `${open.id} is` : "none is"})`
      : `no draft has id ${draft}`;
  throw new DispatchError(why, [`Run \`nico-agent partner log ${tab}\` to see the Thread`]);
}

/** Run the steps `record` has not completed, as the runner holding its lease; `pr` is a Review partner's, as GitHub has it now. */
async function runPartner(world: World, configDir: string, repo: Repo, harness: Harness, record: Partner, pr?: PullRequestDescription) {
  const home = partnerHome(configDir, record.tab);
  const reviewed = record.pr;
  const steps: Record<PartnerStep, () => Promise<void>> = {
    home: async () => {
      writeJson(home, MCP_CONFIG, { mcpServers: { [MCP_SERVER]: { type: "http", url: record.mcpUrl } } });
      writeFileSync(join(home, SKILL), partnerSkill + (ROLES[record.tab] ?? ""));
      if (reviewed) writeFileSync(join(home, PR_BRIEF), prBrief(record.repo, reviewed, pr?.body ?? ""));
    },
    fetch: async () => {
      if (!reviewed) return await world.gitFetch(repo.path);
      // Both by name: the head for the worktree, the base for its diff.
      await world.gitFetch(repo.path, reviewed.head);
      await world.gitFetch(repo.path, reviewed.base);
    },
    worktree: async () => {
      const label = `${repoName(repo)}${reviewed ? `#${reviewed.number}` : ""}:${record.tab}`;
      const worktree = await world.herdrWorktreeCreate({ cwd: repo.path, branch: record.branch, base: record.base, label });
      record.worktree = worktree.path;
      record.workspace = worktree.workspace;
    },
    ...agentSteps(world, harness, () => ({
      workspace: record.workspace!, cwd: record.worktree!, repoPath: repo.path,
      mcp: { mcpUrl: record.mcpUrl, mcpConfig: join(home, MCP_CONFIG) },
    }), record.agent, "partner"),
    prompt: async () => {
      const skill = `Read the Partner skill at ${join(home, SKILL)} and follow it: you are the ${PARTNER_NAMES[record.tab]}`;
      const text = reviewed
        ? `${skill} for ${record.repo}#${reviewed.number}, in a worktree of its head branch ${reviewed.head}. Its title, description and base are in ${join(home, PR_BRIEF)}.`
        : `${skill}, in a worktree of ${record.repo}.`;
      await prompt(world, record.agent.agent, text);
    },
  };
  const save = () => savePartner(world, configDir, record);
  try {
    await runPhase(record, record, PARTNER_STEPS, steps, save, (step, e) =>
      new DispatchError(`the ${PARTNER_NAMES[record.tab]} failed at ${step}: ${e.message}`, [
        ...(e instanceof DispatchError ? e.help : []),
        LIST_HELP,
        `Run the same \`nico-agent partner start ${record.tab}\` again to resume from ${step}`,
      ]));
  } finally {
    await release(world, configDir, record);
  }
  return record;
}

/** What a Review partner is told of its PR: its title, branches, how to see its diff, and its description. */
function prBrief(repo: string, pr: ReviewedPr, body: string) {
  return [
    `# ${repo}#${pr.number}: ${pr.title}`,
    "",
    pr.url,
    "",
    `- Head: \`${pr.head}\`, checked out in your worktree`,
    `- Base: \`${pr.base}\`; its diff is \`git diff origin/${pr.base}...HEAD\``,
    "",
    "## Description",
    "",
    body.trim() || "(none)",
    "",
  ].join("\n");
}

/**
 * Take over the tab's Partner record for this process: the existing one, once
 * `check` lets it, or `fresh` when there is none. Refused while another live process runs it.
 */
async function lease(world: World, configDir: string, tab: PartnerTab, fresh?: Partner, check?: (existing: Partner) => void): Promise<{ record: Partner; created: boolean }> {
  return withFileLock(configDir, FILE, () => {
    const all = loadPartners(configDir);
    const existing = all[tab];
    if (existing) check?.(existing);
    if (existing?.runner !== undefined && existing.runner !== world.processId() && world.processAlive(existing.runner)) {
      throw new DispatchError(`the ${PARTNER_NAMES[tab]} is busy with another nico-agent`, ["Try again once it is done", LIST_HELP]);
    }
    const record = existing ?? fresh;
    if (!record) throw new DispatchError(`no ${PARTNER_NAMES[tab]} runs`, [LIST_HELP]);
    record.runner = world.processId();
    all[tab] = record;
    writeJsonAtomic(join(configDir, FILE), all);
    return { record, created: !existing };
  });
}

async function savePartner(world: World, configDir: string, record: Partner) {
  record.updatedAt = world.now().toISOString();
  await withFileLock(configDir, FILE, () => {
    const all = loadPartners(configDir);
    all[record.tab] = record;
    writeJsonAtomic(join(configDir, FILE), all);
  });
}

/** Give up running the Partner's steps, keeping how far they got. */
async function release(world: World, configDir: string, record: Partner) {
  if (record.runner === undefined) return;
  delete record.runner;
  await savePartner(world, configDir, record);
}
