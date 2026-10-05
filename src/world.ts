/**
 * The outside-world port: every interaction with git, GitHub, herdr, the
 * network, the clock and Linear goes through here. Tests swap in an
 * in-memory fake.
 */
export interface World {
  /** Remote URLs of the git clone at `path`, or null if it isn't one. */
  gitRemotes(path: string): Promise<string[] | null>;
  /** Login of the user's own GitHub session. */
  githubViewer(): Promise<string>;
  linearViewer(): Promise<string>;
  linearIssues(team: string): Promise<LinearIssue[]>;
  /** One Linear issue by identifier (`BLE-27`), or null if there is no such issue. */
  linearIssue(identifier: string): Promise<LinearIssue | null>;
  /** The URLs of a Linear issue's attachments, GitHub PRs among them. */
  linearAttachmentUrls(identifier: string): Promise<string[]>;
  /** Assign a Linear issue to the API key's owner (the Claim, ADR-0007). */
  linearAssignSelf(identifier: string): Promise<void>;
  /**
   * Candidate issues of a GitHub repo. Adapters may narrow server-side to
   * open `ready-for-agent` issues; the core still applies the Ready rule.
   */
  githubIssues(slug: string): Promise<GitHubIssue[]>;
  /** One issue of a GitHub repo, or null if there is no such issue. */
  githubIssue(slug: string, number: number): Promise<GitHubIssue | null>;
  /**
   * The repos (`owner/name`) the bot's GitHub App is installed on, as the
   * App's installation sees them through `ghbot`.
   */
  githubAppRepos(): Promise<string[]>;
  /**
   * The open or merged PRs that close an issue when merged (GitHub's
   * `closedByPullRequestsReferences`); closed unmerged ones are left out.
   */
  githubLinkedPullRequests(slug: string, number: number): Promise<PullRequest[]>;
  /** One PR of a GitHub repo, or null if there is no such PR. */
  githubPullRequest(slug: string, number: number): Promise<PullRequest | null>;
  /** All PRs on a Dispatch's head branch, including closed unmerged PRs. */
  githubBranchPullRequests(slug: string, branch: string): Promise<PullRequest[]>;
  /** Assign an issue to the user's own GitHub session (the Claim, ADR-0007). */
  githubAssignSelf(slug: string, number: number): Promise<void>;
  /** Fetch origin, or explicitly fetch a head branch into its origin tracking ref. */
  gitFetch(path: string, branch?: string): Promise<void>;
  /** The branches on the clone's `origin`, without the `refs/heads/` prefix. */
  gitRemoteBranches(path: string): Promise<string[]>;
  /** The default branch of the clone's `origin`, without the remote prefix. */
  gitDefaultBranch(path: string): Promise<string>;
  /** Create a git worktree and open it as a herdr workspace, without focusing it. */
  herdrWorktreeCreate(options: { cwd: string; branch: string; base: string; label: string }): Promise<{
    workspace: string;
    path: string;
  }>;
  /** Remove the workspace's worktree, keeping its branch; no-op if the workspace is gone. */
  herdrWorktreeRemove(workspace: string): Promise<void>;
  /** Create a labelled tab in a herdr workspace, without focusing it. */
  herdrTabCreate(options: { workspace: string; cwd: string; label: string }): Promise<{ tab: string; pane: string }>;
  /**
   * Start an agent of a herdr kind in a shell pane. Resolves once it is ready
   * for input, or with `ready: false` when it is blocked on a startup question.
   */
  herdrAgentStart(options: { name: string; kind: string; pane: string; args: string[] }): Promise<{ ready: boolean }>;
  /** Every named herdr agent with its raw Agent state (idle, working, blocked, done, unknown). */
  herdrAgents(): Promise<{ name: string; state: string }[]>;
  /** The text currently visible in a named agent's pane. */
  herdrAgentRead(name: string): Promise<string>;
  /** Press logical keys (e.g. `down`, `enter`) in a named agent's pane. */
  herdrAgentSendKeys(name: string, keys: string[]): Promise<void>;
  /** Wait until a named agent reaches one of `states`, failing after `timeoutMs`. */
  herdrAgentWait(name: string, states: string[], timeoutMs: number): Promise<void>;
  /**
   * Submit a prompt to a named agent and wait until it starts working, not
   * until it finishes. `started: false` when the agent never reacted to it.
   */
  herdrAgentPrompt(name: string, text: string): Promise<{ started: boolean }>;
  /** The raw JSON model catalog `codex debug models` prints. */
  codexModels(): Promise<string>;
  /** Id of this process, and whether a process id is still running. */
  processId(): number;
  processAlive(pid: number): boolean;
  now(): Date;
  /** Start answering HTTP requests on `hostname:port`; resolves once listening. */
  serve(address: Address, handler: RequestHandler): Promise<void>;
}

export interface Address {
  hostname: string;
  port: number;
}

export type RequestHandler = (request: Request) => Promise<Response>;

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  blockers: { slug: string; number: number; state: "open" | "closed" }[];
}

export interface PullRequest {
  /** `owner/name` of the repo the PR is in. */
  repo: string;
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  baseBranch: string;
  /** Head branch when available from GitHub; required for stacking. */
  headBranch?: string;
}

export const READY_LABEL = "ready-for-agent";

/** A failure reported by an adapter, already stripped of tool noise. */
export class WorldError extends Error {}

export interface LinearIssue {
  identifier: string;
  title: string;
  url: string;
  /** The branch Linear suggests, which its GitHub integration links PRs by. */
  branchName: string;
  team: { id: string; key: string; name: string };
  project: { id: string; name: string } | null;
  labels: string[];
  state: string;
  assignee: string | null;
  blockers: { state: string }[];
}
