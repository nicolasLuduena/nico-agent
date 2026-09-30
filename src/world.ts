/**
 * The outside-world port: every interaction with git, GitHub, herdr, the
 * network, the clock and (later) Linear goes through here. Tests swap in an
 * in-memory fake.
 */
export interface World {
  /** Remote URLs of the git clone at `path`, or null if it isn't one. */
  gitRemotes(path: string): Promise<string[] | null>;
  /** Login of the user's own GitHub session. */
  githubViewer(): Promise<string>;
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
  /** Assign an issue to the user's own GitHub session (the Claim, ADR-0007). */
  githubAssignSelf(slug: string, number: number): Promise<void>;
  /** `git fetch origin` in the clone at `path`. */
  gitFetch(path: string): Promise<void>;
  /** The default branch of the clone's `origin`, without the remote prefix. */
  gitDefaultBranch(path: string): Promise<string>;
  /** Create a git worktree and open it as a herdr workspace, without focusing it. */
  herdrWorktreeCreate(options: { cwd: string; branch: string; base: string; label: string }): Promise<{
    workspace: string;
    path: string;
  }>;
  /** Create a labelled tab in a herdr workspace, without focusing it. */
  herdrTabCreate(options: { workspace: string; cwd: string; label: string }): Promise<{ tab: string; pane: string }>;
  /**
   * Start an agent of a herdr kind in a shell pane. Resolves once it is ready
   * for input, or with `ready: false` when it is blocked on a startup question.
   */
  herdrAgentStart(options: { name: string; kind: string; pane: string; args: string[] }): Promise<{ ready: boolean }>;
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

export const READY_LABEL = "ready-for-agent";

/** A failure reported by an adapter, already stripped of tool noise. */
export class WorldError extends Error {}
