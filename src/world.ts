/**
 * The outside-world port: every interaction with git, GitHub, the network
 * and (later) herdr and Linear goes through here. Tests swap in an in-memory fake.
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
  /** Start answering HTTP requests on `hostname:port`; resolves once listening. */
  serve(address: { hostname: string; port: number }, fetch: Fetch): Promise<void>;
}

export type Fetch = (request: Request) => Promise<Response>;

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
