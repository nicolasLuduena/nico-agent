import { readFileSync } from "node:fs";
import type { Address, IssueDescription, LinearIssue, GitHubIssue, GitHubSubIssue, PullRequest, RequestHandler, World } from "../src/world";
import { WorldError } from "../src/world";

export class FakeWorld implements World {
  viewer = "me";
  linearUser = "linear-me";
  linear = new Map<string, LinearIssue[]>();
  linearFailure: string | null = null;

  addLinearIssue(issue: Partial<LinearIssue> & { identifier: string }) {
    const full: LinearIssue = {
      title: issue.identifier, url: `https://linear.app/bleentr/issue/${issue.identifier}/title`,
      branchName: `nico/${issue.identifier.toLowerCase()}`,
      team: { id: "team-ble", key: "BLE", name: "Bleentr" }, project: null,
      labels: ["ready-for-agent"], state: "unstarted", assignee: null, blockers: [], parent: null, hasSubIssues: false, ...issue,
    };
    this.linear.set(full.team.key, [...(this.linear.get(full.team.key) ?? []), full]);
  }

  /** Sub-issue identifiers of each Linear parent issue, in sub-issue order. */
  linearChildren = new Map<string, string[]>();

  /** Add a Linear Spec: a parent issue and its sub-issues, in sub-issue order. */
  addLinearSpec(parent: Partial<LinearIssue> & { identifier: string }, ...subIssues: (Partial<LinearIssue> & { identifier: string })[]) {
    this.addLinearIssue({ ...parent, hasSubIssues: true });
    for (const sub of subIssues) this.addLinearIssue({ ...(parent.team && { team: parent.team }), ...sub, parent: parent.identifier });
    this.linearChildren.set(parent.identifier, [...(this.linearChildren.get(parent.identifier) ?? []), ...subIssues.map((s) => s.identifier)]);
  }

  /** The Linear issue `identifier`, to change it as a test goes on. */
  linearIssueNamed(identifier: string) {
    const issue = [...this.linear.values()].flat().find((i) => i.identifier === identifier);
    if (!issue) throw new Error(`no Linear issue ${identifier}`);
    return issue;
  }

  async linearSubIssues(identifier: string) {
    this.call(`linear sub-issues ${identifier}`);
    if (this.linearFailure) throw new WorldError(this.linearFailure);
    return (this.linearChildren.get(identifier) ?? []).map((id) => this.linearIssueNamed(id));
  }

  async linearViewer() {
    if (this.linearFailure) throw new WorldError(this.linearFailure);
    return this.linearUser;
  }

  /** Like the adapter, only `ready-for-agent` issues: a Spec is found through its sub-issues. */
  async linearIssues(team: string) {
    if (this.linearFailure) throw new WorldError(this.linearFailure);
    return [...this.linear.values()].flat().filter((i) => [i.team.key, i.team.id, i.team.name].includes(team) && i.labels.includes("ready-for-agent"));
  }

  /** Attachment URLs of each Linear issue, by identifier. */
  linearAttachments = new Map<string, string[]>();
  /** Identifiers each `linearAssignSelf` assigned. */
  linearClaimed: string[] = [];
  /** Each issue's description, by `slug#N` or Linear identifier; empty when unset. */
  descriptions = new Map<string, string>();
  /** PRs `githubPullRequest` finds, by `slug#N`, besides linked ones. */
  prs = new Map<string, PullRequest>();

  async linearIssue(identifier: string) {
    this.call(`linear issue ${identifier}`);
    if (this.linearFailure) throw new WorldError(this.linearFailure);
    return [...this.linear.values()].flat().find((i) => i.identifier === identifier) ?? null;
  }

  async linearIssueDescription(identifier: string): Promise<IssueDescription | null> {
    this.call(`linear issue description ${identifier}`);
    if (this.linearFailure) throw new WorldError(this.linearFailure);
    const issue = [...this.linear.values()].flat().find((i) => i.identifier === identifier);
    return issue ? { title: issue.title, labels: issue.labels, body: this.descriptions.get(identifier) ?? "" } : null;
  }

  async linearAttachmentUrls(identifier: string) {
    this.call(`linear attachments ${identifier}`);
    if (this.linearFailure) throw new WorldError(this.linearFailure);
    return this.linearAttachments.get(identifier) ?? [];
  }

  async linearAssignSelf(identifier: string) {
    this.call(`linear assign ${identifier}`);
    this.linearClaimed.push(identifier);
  }

  /** Add a PR `githubPullRequest` can find. */
  addPr(pr: Partial<PullRequest> & { repo: string; number: number }) {
    this.prs.set(`${pr.repo}#${pr.number}`, {
      url: `https://github.com/${pr.repo}/pull/${pr.number}`, state: "open", baseBranch: "main", ...pr,
    });
  }

  async githubPullRequest(slug: string, number: number) {
    this.call(`github pr ${slug}#${number}`);
    return this.prs.get(`${slug}#${number}`) ?? this.knownPrs().find((pr) => pr.repo === slug && pr.number === number) ?? null;
  }

  /** Every PR added or linked to an issue, without repeats. */
  private knownPrs() {
    const all = [...this.prs.values(), ...[...this.linkedPrs.values()].flat()];
    return all.filter((pr, i) => all.findIndex((other) => other.url === pr.url) === i);
  }
  clones = new Map<string, string[]>();
  issues = new Map<string, GitHubIssue[]>();
  failures = new Map<string, string>();
  calls: string[] = [];
  /** What the last `serve` call would be answering, for tests to send requests to. */
  server: { address: Address; handler: RequestHandler } | null = null;
  serveFailure: string | null = null;
  /** Default branch of each clone's origin; `main` when unset. */
  defaultBranches = new Map<string, string>();
  /** Branches on each clone's origin; just its default branch when unset. */
  remoteBranches = new Map<string, string[]>();
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
  /** What `opencode2 api model.list` prints: the recorded catalog unless a test swaps it. */
  opencodeCatalog = OPENCODE_CATALOG;
  /** PRs linked to each issue, by `slug#N`. */
  linkedPrs = new Map<string, PullRequest[]>();
  /** PRs on each `slug:branch`, overriding those found among added and linked PRs. */
  branchPrs = new Map<string, PullRequest[]>();
  /** Agent state of each started agent, as `herdr agent list` reports it. */
  agentStates = new Map<string, string>();
  /** The pane each named agent runs in. */
  private agentPanes = new Map<string, string>();
  /** What `herdr agent read` shows of each named agent, besides a startup question. */
  screens = new Map<string, string>();
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
      parent: null,
      hasSubIssues: false,
      ...issue,
    };
    this.issues.set(slug, [...(this.issues.get(slug) ?? []), full]);
  }

  /** Sub-issues of each GitHub parent issue, by `slug#N`, in sub-issue order. */
  githubChildren = new Map<string, { slug: string; number: number }[]>();

  /** Add a GitHub Spec: a parent issue of `slug` and its native sub-issues, in sub-issue order, in `slug` unless they name another. */
  addGitHubSpec(slug: string, parent: Partial<GitHubIssue> & { number: number }, ...subIssues: (Partial<GitHubIssue> & { number: number; slug?: string })[]) {
    this.addIssue(slug, { ...parent, hasSubIssues: true });
    for (const { slug: subSlug = slug, ...sub } of subIssues) this.addIssue(subSlug, { ...sub, parent: { slug, number: parent.number } });
    const key = `${slug}#${parent.number}`;
    this.githubChildren.set(key, [...(this.githubChildren.get(key) ?? []), ...subIssues.map((s) => ({ slug: s.slug ?? slug, number: s.number }))]);
  }

  /** The GitHub issue `slug#number`, to change it as a test goes on. */
  githubIssueNamed(slug: string, number: number) {
    const issue = this.issues.get(slug)?.find((i) => i.number === number);
    if (!issue) throw new Error(`no GitHub issue ${slug}#${number}`);
    return issue;
  }

  async githubSubIssues(slug: string, number: number): Promise<GitHubSubIssue[]> {
    this.call(`github sub-issues ${slug}#${number}`);
    return (this.githubChildren.get(`${slug}#${number}`) ?? []).map((c) => ({ ...this.githubIssueNamed(c.slug, c.number), slug: c.slug }));
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
    // Like the adapter, only open `ready-for-agent` issues: a Spec is found through its sub-issues.
    return (this.issues.get(slug) ?? []).filter((i) => i.state === "open" && i.labels.includes("ready-for-agent"));
  }

  async githubIssue(slug: string, number: number) {
    this.calls.push(`github issue ${slug}#${number}`);
    return this.issues.get(slug)?.find((i) => i.number === number) ?? null;
  }

  async githubIssueDescription(slug: string, number: number): Promise<IssueDescription | null> {
    this.call(`github issue description ${slug}#${number}`);
    const issue = this.issues.get(slug)?.find((i) => i.number === number);
    return issue ? { title: issue.title, labels: issue.labels, body: this.descriptions.get(`${slug}#${number}`) ?? "" } : null;
  }

  async githubLinkedPullRequests(slug: string, number: number) {
    this.call(`github linked prs ${slug}#${number}`);
    return this.linkedPrs.get(`${slug}#${number}`) ?? [];
  }

  async githubBranchPullRequests(slug: string, branch: string) {
    this.call(`github branch prs ${slug}:${branch}`);
    return this.branchPrs.get(`${slug}:${branch}`) ?? this.knownPrs().filter((pr) => pr.repo === slug && pr.headBranch === branch);
  }

  async gitFetch(path: string, branch?: string) {
    this.call(`git -C ${path} fetch origin${branch ? ` +refs/heads/${branch}:refs/remotes/origin/${branch}` : ""}`);
  }

  async gitRemoteBranches(path: string) {
    this.call(`git -C ${path} ls-remote --heads origin`);
    return this.remoteBranches.get(path) ?? [this.defaultBranches.get(path) ?? "main"];
  }

  async gitDefaultBranch(path: string) {
    this.calls.push(`git -C ${path} default-branch`);
    return this.defaultBranches.get(path) ?? "main";
  }

  async herdrWorktreeCreate({ cwd, branch, base, label }: { cwd: string; branch: string; base: string; label: string }) {
    this.herdr("worktree create", "--cwd", cwd, "--branch", branch, "--base", base, "--label", label, "--no-focus");
    return { workspace: `w${++this.workspaces}`, path: `/worktrees/${branch.split("/").pop()}` };
  }

  async herdrWorkspaceCreate({ cwd, label }: { cwd: string; label: string }) {
    this.herdr("workspace create", "--cwd", cwd, "--label", label, "--no-focus");
    return { workspace: `w${++this.workspaces}` };
  }

  async herdrWorkspaceClose(workspace: string) {
    this.herdr("workspace close", workspace);
    for (const [name, pane] of this.agentPanes) {
      if (pane.startsWith(`${workspace}:`)) this.agentStates.delete(name);
    }
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
    this.agentPanes.set(name, pane);
    return { ready: this.blockedScreen === null };
  }

  async herdrPaneRun(pane: string, command: string) {
    this.herdr("pane run", pane, command);
  }

  async herdrAgentDetect(pane: string, timeoutMs: number) {
    this.herdr("agent detect", pane, "--timeout", String(timeoutMs));
  }

  async herdrAgentRename(pane: string, name: string) {
    this.herdr("agent rename", pane, name);
    this.agentStates.set(name, "idle");
    this.agentPanes.set(name, pane);
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
    return this.blockedScreen ?? this.screens.get(name) ?? "";
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

  async opencodeModels(command: string) {
    this.call(`${command} api model.list`);
    return this.opencodeCatalog;
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

  /** Desktop notifications shown, in order. */
  notifications: { title: string; body: string }[] = [];

  async notify(title: string, body: string) {
    this.call(`notify ${title}`);
    this.notifications.push({ title, body });
  }

  async serve(address: Address, handler: RequestHandler) {
    this.calls.push(`serve ${address.hostname}:${address.port}`);
    if (this.serveFailure) throw new WorldError(this.serveFailure);
    this.server = { address, handler };
  }
}

/** `codex debug models` from codex-cli 0.159.0, trimmed to the fields nico-agent reads and their neighbours. */
export const CODEX_CATALOG = readFileSync(new URL("fixtures/codex-debug-models.json", import.meta.url), "utf8");

/** `opencode2 api model.list` from opencode 2.0.23, trimmed to four models, the last one disabled. */
export const OPENCODE_CATALOG = readFileSync(new URL("fixtures/opencode2-model-list.json", import.meta.url), "utf8");
