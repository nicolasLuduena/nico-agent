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

  async serve(address: Address, handler: RequestHandler) {
    this.calls.push(`serve ${address.hostname}:${address.port}`);
    if (this.serveFailure) throw new WorldError(this.serveFailure);
    this.server = { address, handler };
  }
}
