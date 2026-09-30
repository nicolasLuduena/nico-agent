import { readFileSync } from "node:fs";
import type { Address, GitHubIssue, PullRequest, RequestHandler, World } from "../src/world";
import { WorldError } from "../src/world";

export class FakeWorld implements World {
  viewer = "me";
  clones = new Map<string, string[]>();
  issues = new Map<string, GitHubIssue[]>();
  failures = new Map<string, string>();
  calls: string[] = [];
  /** What the last `serve` call would be answering, for tests to send requests to. */
  server: { address: Address; handler: RequestHandler } | null = null;
  serveFailure: string | null = null;
  /** Default branch of each clone's origin; `main` when unset. */
  defaultBranches = new Map<string, string>();
  /** Failures of outside-world calls, keyed by a prefix of the recorded call. */
  callFailures = new Map<string, string>();
  /** Assignees each `githubAssignSelf` added, as `slug#N`. */
  claimed: string[] = [];
  /** Repos the bot's GitHub App is installed on. */
  appRepos: string[] = [];
  clock = new Date("2026-09-30T12:00:00.000Z");
  /** This process's id, and whether each process id is still running. */
  pid = 4242;
  deadPids = new Set<number>();
  /** Calls that crash the process mid-step, like a bug or a kill would. */
  crashes = new Set<string>();
  /** Calls that never return, as if the process were stuck or killed in them. */
  hangs = new Set<string>();
  /** What `codex debug models` prints: the recorded catalog unless a test swaps it. */
  codexCatalog = CODEX_CATALOG;
  /** PRs linked to each issue, by `slug#N`. */
  linkedPrs = new Map<string, PullRequest[]>();
  branchPrs = new Map<string, PullRequest[]>();
  /** Agent state of each started agent, as `herdr agent list` reports it. */
  agentStates = new Map<string, string>();
  private workspaces = 0;
  private tabs = new Map<string, number>();
  /** Screen of an agent blocked on a startup question, if the next start should block. */
  private blockedScreen: string | null = null;
  private stalledPrompts = 0;

  addClone(path: string, ...remotes: string[]) {
    this.clones.set(path, remotes);
  }

  addIssue(slug: string, issue: Partial<GitHubIssue> & { number: number }) {
    const full: GitHubIssue = {
      title: `Issue ${issue.number}`,
      url: `https://github.com/${slug}/issues/${issue.number}`,
      state: "open",
      labels: ["ready-for-agent"],
      assignees: [],
      blockers: [],
      ...issue,
    };
    this.issues.set(slug, [...(this.issues.get(slug) ?? []), full]);
  }

  /** Link a PR to an issue, as a closing reference would. */
  linkPr(slug: string, issue: number, pr: Partial<PullRequest> & { number: number }) {
    const full: PullRequest = {
      repo: slug,
      url: `https://github.com/${slug}/pull/${pr.number}`,
      state: "open",
      baseBranch: "main",
      headBranch: `agent/pr-${pr.number}`,
      ...pr,
    };
    const key = `${slug}#${issue}`;
    this.linkedPrs.set(key, [...(this.linkedPrs.get(key) ?? []), full]);
  }

  /** Make the next calls to `serve` fail with `message`. */
  failServe(message: string) {
    this.serveFailure = message;
  }

  /** Make the next calls to `githubIssues(slug)` fail with `message`. */
  failGitHub(slug: string, message: string) {
    this.failures.set(slug, message);
  }

  /** Make the herdr `command` (e.g. `agent start`) fail with `message`. */
  failHerdr(command: string, message: string) {
    this.failCall(`herdr ${command}`, message);
  }

  /** Make every call recorded as starting with `prefix` fail with `message`. */
  failCall(prefix: string, message: string) {
    this.callFailures.set(prefix, message);
  }

  /** Stop injecting call failures. */
  clearFailures() {
    this.callFailures.clear();
  }

  /** The user answered the agent's startup question by hand. */
  unblockAgent() {
    this.blockedScreen = null;
  }

  /** Make the next agent start report a startup block showing `screen`. */
  blockAgentStart(screen: string) {
    this.blockedScreen = screen;
  }

  /** Make the next `count` prompts reach the agent without it starting work. */
  stallPrompts(count: number) {
    this.stalledPrompts = count;
  }

  private herdr(command: string, ...args: string[]) {
    this.call(["herdr", command, ...args].join(" "));
  }

  private call(text: string) {
    this.calls.push(text);
    for (const prefix of this.crashes) {
      if (text.startsWith(prefix)) throw new Error(`crashed during ${text}`);
    }
    for (const [prefix, failure] of this.callFailures) {
      if (text.startsWith(prefix)) throw new WorldError(failure);
    }
  }

  async gitRemotes(path: string) {
    this.calls.push(`git remotes ${path}`);
    return this.clones.get(path) ?? null;
  }

  async githubViewer() {
    this.calls.push("github viewer");
    return this.viewer;
  }

  async githubIssues(slug: string) {
    this.calls.push(`github issues ${slug}`);
    const failure = this.failures.get(slug);
    if (failure) throw new WorldError(failure);
    return this.issues.get(slug) ?? [];
  }

  async githubIssue(slug: string, number: number) {
    this.calls.push(`github issue ${slug}#${number}`);
    return this.issues.get(slug)?.find((i) => i.number === number) ?? null;
  }

  async githubLinkedPullRequests(slug: string, number: number) {
    this.call(`github linked prs ${slug}#${number}`);
    return this.linkedPrs.get(`${slug}#${number}`) ?? [];
  }

  async githubBranchPullRequests(slug: string, branch: string) {
    this.call(`github branch prs ${slug}:${branch}`);
    return this.branchPrs.get(`${slug}:${branch}`) ?? [];
  }

  async gitFetch(path: string, branch?: string) {
    this.call(`git -C ${path} fetch origin${branch ? ` +refs/heads/${branch}:refs/remotes/origin/${branch}` : ""}`);
  }

  async gitDefaultBranch(path: string) {
    this.calls.push(`git -C ${path} default-branch`);
    return this.defaultBranches.get(path) ?? "main";
  }

  async herdrWorktreeCreate({ cwd, branch, base, label }: { cwd: string; branch: string; base: string; label: string }) {
    this.herdr("worktree create", "--cwd", cwd, "--branch", branch, "--base", base, "--label", label, "--no-focus");
    return { workspace: `w${++this.workspaces}`, path: `/worktrees/${branch.split("/").pop()}` };
  }

  async herdrTabCreate({ workspace, cwd, label }: { workspace: string; cwd: string; label: string }) {
    this.herdr("tab create", "--workspace", workspace, "--cwd", cwd, "--label", label, "--no-focus");
    if (this.hangs.has("herdr tab create")) await new Promise(() => {});
    // Tab 1 is the workspace's own; created ones follow it.
    const n = (this.tabs.get(workspace) ?? 1) + 1;
    this.tabs.set(workspace, n);
    return { tab: `${workspace}:t${n}`, pane: `${workspace}:p${n}` };
  }

  async herdrAgentStart({ name, kind, pane, args }: { name: string; kind: string; pane: string; args: string[] }) {
    this.herdr("agent start", name, "--kind", kind, "--pane", pane, "--", ...args);
    this.agentStates.set(name, "idle");
    return { ready: this.blockedScreen === null };
  }

  async herdrWorktreeRemove(workspace: string) {
    this.herdr("worktree remove", "--workspace", workspace);
  }

  async herdrAgents() {
    this.herdr("agent list");
    return [...this.agentStates].map(([name, state]) => ({ name, state }));
  }

  async herdrAgentRead(name: string) {
    this.herdr("agent read", name, "--source", "visible");
    return this.blockedScreen ?? "";
  }

  async herdrAgentSendKeys(name: string, keys: string[]) {
    this.herdr("agent send-keys", name, ...keys);
    this.blockedScreen = null;
  }

  async herdrAgentWait(name: string, states: string[], timeoutMs: number) {
    this.herdr("agent wait", name, ...states.flatMap((s) => ["--until", s]), "--timeout", String(timeoutMs));
    // An agent blocked on a question never reaches idle.
    if (this.blockedScreen !== null) throw new WorldError(`agent_wait_timeout: ${name} did not reach ${states.join(" or ")}`);
  }

  async herdrAgentPrompt(name: string, text: string) {
    this.herdr("agent prompt", name, text);
    if (this.stalledPrompts === 0) {
      this.agentStates.set(name, "working");
      return { started: true };
    }
    this.stalledPrompts--;
    return { started: false };
  }

  async githubAppRepos() {
    this.call("github app repos");
    return this.appRepos;
  }

  async githubAssignSelf(slug: string, number: number) {
    this.call(`github assign ${slug}#${number} @me`);
    this.claimed.push(`${slug}#${number}`);
  }

  async codexModels() {
    this.call("codex debug models");
    return this.codexCatalog;
  }

  processId() {
    return this.pid;
  }

  processAlive(pid: number) {
    return !this.deadPids.has(pid);
  }

  now() {
    return this.clock;
  }

  async serve(address: Address, handler: RequestHandler) {
    this.calls.push(`serve ${address.hostname}:${address.port}`);
    if (this.serveFailure) throw new WorldError(this.serveFailure);
    this.server = { address, handler };
  }
}

/** `codex debug models` from codex-cli 0.159.0, trimmed to the fields nico-agent reads and their neighbours. */
export const CODEX_CATALOG = readFileSync(new URL("fixtures/codex-debug-models.json", import.meta.url), "utf8");
