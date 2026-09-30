import type { Address, GitHubIssue, RequestHandler, World } from "../src/world";
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
  herdrFailures = new Map<string, string>();
  clock = new Date("2026-09-30T12:00:00.000Z");
  private workspaces = 0;
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
    this.herdrFailures.set(command, message);
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
    this.calls.push(["herdr", command, ...args].join(" "));
    const failure = this.herdrFailures.get(command);
    if (failure) throw new WorldError(failure);
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

  async gitFetch(path: string) {
    this.calls.push(`git -C ${path} fetch origin`);
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
    return { tab: `${workspace}:t2`, pane: `${workspace}:p2` };
  }

  async herdrAgentStart({ name, kind, pane, args }: { name: string; kind: string; pane: string; args: string[] }) {
    this.herdr("agent start", name, "--kind", kind, "--pane", pane, "--", ...args);
    return { ready: this.blockedScreen === null };
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
  }

  async herdrAgentPrompt(name: string, text: string) {
    this.herdr("agent prompt", name, text);
    if (this.stalledPrompts === 0) return { started: true };
    this.stalledPrompts--;
    return { started: false };
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
