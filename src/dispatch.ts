import { type Repo, findRepo, loadConfig } from "./config";
import { HARNESSES, type Harness } from "./harness";
import { type Dispatch, addDispatch, findDispatch } from "./state";
import type { World } from "./world";

/** A request the user can fix; `usage` marks a malformed one (CLI exit 2). */
export class DispatchError extends Error {
  constructor(
    message: string,
    readonly help: string[],
    readonly usage = false,
  ) {
    super(message);
  }
}

export interface DispatchRequest {
  issue: string;
  harness: string;
  model: string;
  effort: string;
}

export interface IssueRef {
  repo: Repo;
  number: number;
  /** `owner/repo#N` with the Repo's configured slug: the Dispatch key. */
  key: string;
}

/** Resolve `owner/repo#N` or a GitHub issue URL to a configured Repo's issue. */
export function resolveIssue(configDir: string, ref: string): IssueRef {
  const match =
    ref.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/) ??
    ref.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i);
  if (!match) {
    throw new DispatchError(`\`${ref}\` is not an issue reference`, ["Pass `owner/repo#N` or a GitHub issue URL"], true);
  }
  const [, slug, digits] = match as unknown as [string, string, string];
  const repo = findRepo(loadConfig(configDir), slug);
  if (!repo) {
    throw new DispatchError(`${slug} is not a configured Repo`, [`Run \`nico-agent repo add ${slug} --path <clone>\` first`]);
  }
  const number = Number(digits);
  return { repo, number, key: `${repo.slug}#${number}` };
}

/**
 * Dispatch an issue: fetch the clone, create a worktree workspace on the
 * default branch, start the Implementer in an `implementer` tab and prompt it.
 */
export async function dispatch(world: World, configDir: string, request: DispatchRequest): Promise<Dispatch> {
  const harness = HARNESSES.find((h) => h.name === request.harness);
  if (!harness) {
    throw new DispatchError(`unknown Harness \`${request.harness}\``, [`Valid Harnesses: ${HARNESSES.map((h) => h.name).join(", ")}`], true);
  }
  if (!harness.models.includes(request.model)) {
    throw new DispatchError(
      `unknown model \`${request.model}\` for ${harness.name}`,
      [`Valid models for ${harness.name}: ${harness.models.join(", ")}`],
      true,
    );
  }
  if (!harness.efforts.includes(request.effort)) {
    throw new DispatchError(
      `unknown Effort \`${request.effort}\` for ${harness.name}`,
      [`Valid Efforts for ${harness.name}: ${harness.efforts.join(", ")}`],
      true,
    );
  }
  const { repo, number, key } = resolveIssue(configDir, request.issue);
  if (findDispatch(configDir, key)) throw alreadyInFlight(key);

  const issue = await world.githubIssue(repo.slug, number);
  if (!issue) throw new DispatchError(`${key} was not found on GitHub`, [`Check the issue number on https://github.com/${repo.slug}/issues`]);
  if (issue.state !== "open") throw new DispatchError(`${key} is closed`, ["Run `nico-agent` to see the Ready issues"]);

  const name = repo.slug.split("/")[1]!;
  const branch = `agent/${name}-${number}`;
  const url = `https://github.com/${repo.slug}/issues/${number}`;
  const agent = agentName("impl", name, number);

  await world.gitFetch(repo.path);
  const base = `origin/${await world.gitDefaultBranch(repo.path)}`;
  const worktree = await world.herdrWorktreeCreate({ cwd: repo.path, branch, base, label: `${name}#${number}` });
  const tab = await world.herdrTabCreate({ workspace: worktree.workspace, cwd: worktree.path, label: "implementer" });
  const started = await world.herdrAgentStart({
    name: agent,
    kind: harness.kind,
    pane: tab.pane,
    args: harness.args(request.model, request.effort),
  });
  if (!started.ready) await answerTrustPrompt(world, harness, agent, worktree.path);
  await prompt(world, agent, `${harness.sigil}implement ${url} as draft PR`);

  const now = world.now().toISOString();
  const record: Dispatch = {
    issue: key,
    title: issue.title,
    url,
    repo: repo.slug,
    branch,
    base,
    worktree: worktree.path,
    workspace: worktree.workspace,
    implementer: { tab: tab.tab, pane: tab.pane, agent, harness: harness.name, model: request.model, effort: request.effort },
    createdAt: now,
    updatedAt: now,
  };
  if (!(await addDispatch(configDir, record))) throw alreadyInFlight(key);
  return record;
}

const STARTUP_TIMEOUT_MS = 30_000;

/**
 * Answer yes when an agent is blocked only on its Harness's trust question for
 * the worktree we just created: dispatching into the Repo already trusts it.
 */
async function answerTrustPrompt(world: World, harness: Harness, agent: string, worktree: string) {
  const screen = await world.herdrAgentRead(agent);
  // Long paths wrap, so compare with all whitespace removed.
  const flat = (text: string) => text.replace(/\s+/g, "");
  const trust = harness.trustPrompt;
  if (!trust || !screen.includes(trust.text) || !flat(screen).includes(flat(worktree))) {
    throw new DispatchError(`${agent} is blocked during startup`, [
      `Run \`herdr agent read ${agent}\` to see what it is asking, and answer it in herdr`,
    ]);
  }
  await world.herdrAgentSendKeys(agent, trust.keys);
  await world.herdrAgentWait(agent, ["idle", "done"], STARTUP_TIMEOUT_MS);
}

const PROMPT_ATTEMPTS = 3;

/**
 * Prompt until the agent starts working: a Harness still drawing its UI (just
 * after a trust answer, say) drops input without an error.
 */
async function prompt(world: World, agent: string, text: string) {
  for (let attempt = 0; attempt < PROMPT_ATTEMPTS; attempt++) {
    if ((await world.herdrAgentPrompt(agent, text)).started) return;
  }
  throw new DispatchError(`${agent} did not start working on its prompt`, [
    `Run \`herdr agent read ${agent}\` to see its screen, and send the prompt by hand`,
  ]);
}

function alreadyInFlight(key: string) {
  return new DispatchError(`${key} is already In flight`, [`Run \`nico-agent show ${key}\` to see the Dispatch`]);
}

const MAX_AGENT_NAME = 32;

/** `<role>-<repo>-<n>` within herdr's `[a-z][a-z0-9_-]{0,31}`, keeping the number. */
function agentName(role: string, repoName: string, number: number) {
  const suffix = `-${number}`;
  const room = MAX_AGENT_NAME - role.length - 1 - suffix.length;
  const repo = repoName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, Math.max(room, 0));
  return `${role}-${repo}${suffix}`.slice(0, MAX_AGENT_NAME);
}
