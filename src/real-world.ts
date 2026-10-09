import { type GitHubCall, currentCaller, recordCall, splitHeaders } from "./github-calls";
import { LinearSource } from "./linear";
import { realpathSync } from "node:fs";
import type { Address, CheckResult, GitHubIssue, IssueDescription, GitHubSubIssue, PullRequest, PullRequestActivity, PullRequestComment, Pages, RequestHandler, SocketPeer, SocketSession, Sockets, World } from "./world";
import { RateLimited, READY_LABEL, WorldError } from "./world";

interface Exec {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function exec(cmd: string[], env?: Record<string, string>): Promise<Exec> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  } catch {
    throw new WorldError(`\`${cmd[0]}\` is not installed or not on PATH`);
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const GH_ENV = { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" };

/**
 * Who a GitHub call runs as. nico-agent reads a Repo as the bot where its
 * App is installed, through `ghbot` and the installation token, whose rate
 * limit is its own, so the user's `gh` keeps working. It reads other Repos,
 * claims issues and names the viewer as the user, through their own `gh`.
 */
type GitHubAs = "gh" | "ghbot";

async function ghFailure(stderr: string, as: GitHubAs): Promise<WorldError> {
  if (/auth login|authentication|HTTP 401/i.test(stderr)) {
    return new WorldError(as === "gh" ? "not authenticated with GitHub; run `gh auth login`" : "GitHub refused the bot's token; check ~/.config/gh-bot/config.env");
  }
  if (/Could not resolve to a Repository|HTTP 404/i.test(stderr)) {
    return new WorldError("repository not found on GitHub, or not visible to your account");
  }
  if (/rate limit/i.test(stderr)) return new RateLimited(await rateLimitReset(as));
  return new WorldError(`GitHub request failed; check your network and \`${as} auth status\``);
}

/**
 * When GitHub takes calls from `as` again: the latest reset of its spent
 * limits. A secondary rate limit leaves them unspent, and GitHub asks for a
 * minute's wait then.
 */
async function rateLimitReset(as: GitHubAs): Promise<Date> {
  const inAMinute = new Date(Date.now() + 60_000);
  // `rate_limit` itself costs nothing against the limit.
  const result = await exec([as, "api", "rate_limit"], GH_ENV);
  if (result.exitCode !== 0) return inAMinute;
  try {
    const limits = Object.values(JSON.parse(result.stdout).resources) as { remaining: number; reset: number }[];
    const spent = limits.filter((l) => l.remaining === 0).map((l) => l.reset * 1000);
    return spent.length ? new Date(Math.max(...spent)) : inAMinute;
  } catch {
    return inAMinute;
  }
}

/** Run a git command in `path`, failing with its first stderr line. */
async function git(path: string, args: string[]): Promise<string> {
  const result = await exec(["git", "-C", path, ...args], { GIT_TERMINAL_PROMPT: "0" });
  if (result.exitCode === 0) return result.stdout.trim();
  const reason = result.stderr.trim().split("\n")[0] || `exit code ${result.exitCode}`;
  throw new WorldError(`\`git ${args.join(" ")}\` failed in ${path}: ${reason}`);
}

/** How long a prompted agent may take to start working; herdr reports a stall after 5s. */
const PROMPT_TIMEOUT_MS = 30_000;

/** How often to look for an agent herdr has not detected yet. */
const DETECT_POLL_MS = 250;

/** A failed herdr command; `code` is herdr's error code when it reported one. */
class HerdrError extends WorldError {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/** Run a herdr command and return its stdout. */
async function herdrText(args: string[]): Promise<string> {
  const result = await exec(["herdr", ...args]);
  if (result.exitCode === 0) return result.stdout;
  let message = result.stderr.trim() || `exit code ${result.exitCode}`;
  let code: string | null = null;
  try {
    const error = JSON.parse(message).error;
    code = error.code;
    message = `${error.code}: ${error.message}`;
  } catch {}
  throw new HerdrError(`\`herdr ${args.slice(0, 2).join(" ")}\` failed: ${message}`, code);
}

/** Run a herdr control command and return its JSON `result`. */
async function herdr(args: string[]): Promise<any> {
  return JSON.parse(await herdrText(args)).result;
}

const LINKED_PR_FIELDS = "number url state baseRefName headRefName headRepository { nameWithOwner } repository { nameWithOwner }";

// Closing PRs come along, so a Board asks GitHub once per page of issues, not once per issue.
const ISSUE_FIELDS = `
        number title url state
        labels(first: 50) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        blockedBy(first: 50) { nodes { number state repository { nameWithOwner } } }
        parent { number repository { nameWithOwner } }
        subIssuesSummary { total }
        closedByPullRequestsReferences(first: 20) { nodes { ${LINKED_PR_FIELDS} } }`;

// Native sub-issues come in sub-issue order, the order of work of a Spec.
const SUB_ISSUES_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      subIssues(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {${ISSUE_FIELDS}
          repository { nameWithOwner }
        }
      }
    }
  }
}`;

const ISSUE_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {${ISSUE_FIELDS}
    }
  }
}`;

const ISSUES_QUERY = `
query($owner: String!, $name: String!, $label: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor, states: OPEN, labels: [$label], orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {${ISSUE_FIELDS}
      }
    }
  }
}`;

const LINKED_PRS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 20) {
        nodes { ${LINKED_PR_FIELDS} }
      }
    }
  }
}`;

interface IssueNode {
  number: number;
  title: string;
  url: string;
  state: string;
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string }[] };
  blockedBy: { nodes: { number: number; state: string; repository: { nameWithOwner: string } }[] };
  parent: { number: number; repository: { nameWithOwner: string } } | null;
  subIssuesSummary: { total: number };
  closedByPullRequestsReferences?: { nodes: LinkedPrNode[] };
}

interface LinkedPrNode {
  number: number;
  url: string;
  state: string;
  baseRefName: string;
  headRefName: string;
  headRepository: { nameWithOwner: string } | null;
  repository: { nameWithOwner: string };
}

/** How long an issue's closing PRs, as its issue query brought them, are reused: within one Board. */
const PR_SNAPSHOT_MS = 20_000;

const PR_ACTIVITY_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft baseRefName mergeable
      comments(last: 100) { nodes { id author { login } createdAt body } }
      reviews(last: 100) {
        nodes {
          id author { login } submittedAt state body
          comments(first: 100) { nodes { id author { login } publishedAt body path } }
        }
      }
      commits(last: 1) {
        nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion }
          ... on StatusContext { context state }
        } } } } }
      }
    }
  }
}`;

interface PrActivityNode {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  comments: { nodes: { id: string; author: { login: string } | null; createdAt: string; body: string }[] };
  reviews: {
    nodes: {
      id: string; author: { login: string } | null; submittedAt: string | null; state: string; body: string;
      comments: { nodes: { id: string; author: { login: string } | null; publishedAt: string | null; body: string; path: string }[] };
    }[];
  };
  commits: {
    nodes: { commit: { statusCheckRollup: { contexts: { nodes: (
      | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null }
      | { __typename: "StatusContext"; context: string; state: string }
    )[] } } | null } }[];
  };
}

/** The names GitHub calls are logged under, by query text. */
const QUERY_NAMES = new Map([
  [SUB_ISSUES_QUERY, "SUB_ISSUES_QUERY"],
  [ISSUE_QUERY, "ISSUE_QUERY"],
  [ISSUES_QUERY, "ISSUES_QUERY"],
  [LINKED_PRS_QUERY, "LINKED_PRS_QUERY"],
  [PR_ACTIVITY_QUERY, "PR_ACTIVITY_QUERY"],
]);

/**
 * What a `gh` call asks for, for the log: the named GraphQL query, the REST
 * endpoint with its Repo and numbers left out, or the gh command; and its Repo.
 */
function describeGh(args: string[]): Pick<GitHubCall, "query" | "repo" | "resource"> {
  const field = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  if (args[0] !== "api") {
    const repo = args[args.indexOf("--repo") + 1];
    return { query: args.slice(0, 2).join(" "), ...(args.includes("--repo") && repo && { repo }), resource: "graphql" };
  }
  if (args[1] === "graphql") {
    const query = field("query") ?? "";
    const owner = field("owner");
    const name = field("name");
    return { query: QUERY_NAMES.get(query) ?? "graphql", ...(owner && name && { repo: `${owner}/${name}` }), resource: "graphql" };
  }
  const endpoint = (args[1] ?? "").replace(/^\//, "");
  const repo = endpoint.match(/^repos\/([^/]+\/[^/]+)/)?.[1];
  const query = endpoint.replace(/^repos\/[^/]+\/[^/]+/, "repos/<slug>").replace(/\/\d+(?=\/|$)/g, "/<n>");
  return { query, ...(repo && { repo }), resource: "core" };
}

/** A submitted review's verdict; pending and dismissed reviews are left out. */
const REVIEW_VERDICTS: Record<string, PullRequestComment["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
};

/** Check run conclusions that count as passed; every other completed one failed. */
const PASSED = ["SUCCESS", "NEUTRAL", "SKIPPED"];

/** How long the list of Repos the bot reads is reused; installing the App on another shows within it. */
const BOT_REPOS_MS = 10 * 60_000;

export class RealWorld implements World {
  /** Where every GitHub call is logged; nowhere without one. */
  private readonly githubCalls?: string;

  constructor(options: { githubCalls?: string } = {}) {
    if (options.githubCalls) this.githubCalls = options.githubCalls;
  }

  private readonly linear = new LinearSource();
  /** The Repos (lowercase `owner/name`) the bot reads: its App's installation, none without a bot token. */
  private botRepos: { at: number; repos: Promise<Set<string>> } | null = null;

  /** Who reads `slug`: the bot where its App is installed, else the user. */
  private async readerOf(slug: string): Promise<GitHubAs> {
    if (!this.botRepos || Date.now() - this.botRepos.at >= BOT_REPOS_MS) {
      // A failed listing (the bot rate-limited, say) keeps the Repos it knew, so their reads don't move onto the user's budget.
      const known = this.botRepos?.repos ?? Promise.resolve(new Set<string>());
      const repos = this.githubAppRepos().then((r) => new Set(r.map((s) => s.toLowerCase())), () => known);
      this.botRepos = { at: Date.now(), repos };
    }
    return (await this.botRepos.repos).has(slug.toLowerCase()) ? "ghbot" : "gh";
  }

  /** A GitHub read in `slug`, as its reader. */
  private async readExec(slug: string, args: string[]): Promise<Exec & { as: GitHubAs }> {
    const as = await this.readerOf(slug);
    return { ...(await this.ghCall(args, { bin: as })), as };
  }

  private async read(slug: string, args: string[]): Promise<string> {
    const result = await this.readExec(slug, args);
    if (result.exitCode === 0) return result.stdout;
    throw await ghFailure(result.stderr, result.as);
  }
  /** Closing PRs of each issue (`owner/name#n`), as the issue queries brought them. */
  private readonly linkedPrs = new Map<string, { at: number; prs: PullRequest[] }>();

  /**
   * Run `gh` (or `ghbot`) and log the call. `gh api` is asked for its response
   * headers, which carry the budget left; `stdout` is the body alone.
   */
  private async ghCall(args: string[], { bin = "gh", ...described }: Partial<GitHubCall> & { bin?: string } = {}): Promise<Exec> {
    const at = new Date();
    const start = performance.now();
    const withHeaders = bin === "gh" && args[0] === "api" ? ["api", "-i", ...args.slice(1)] : args;
    const result = await exec([bin, ...withHeaders], GH_ENV);
    const { body, budget } = splitHeaders(result.stdout);
    if (this.githubCalls) {
      const error = result.stderr.trim().split("\n")[0];
      const outcome = result.exitCode === 0 ? "ok" : /rate limit/i.test(result.stderr) ? "rate limited" : "failed";
      recordCall(this.githubCalls, {
        at: at.toISOString(),
        caller: currentCaller(),
        ...describeGh(args),
        ...described,
        ms: Math.round(performance.now() - start),
        outcome,
        ...(outcome !== "ok" && { error: error || `exit code ${result.exitCode}` }),
        ...(budget && { budget }),
      });
    }
    return { ...result, stdout: body };
  }

  /** Run `gh`, translating its failures into actionable WorldErrors. */
  private async gh(args: string[]): Promise<string> {
    const result = await this.ghCall(args);
    if (result.exitCode === 0) return result.stdout;
    throw await ghFailure(result.stderr, "gh");
  }

  private rememberLinked(slug: string, node: IssueNode) {
    const linked = node.closedByPullRequestsReferences;
    if (linked) this.linkedPrs.set(`${slug.toLowerCase()}#${node.number}`, { at: Date.now(), prs: linked.nodes.map(toPullRequest) });
  }

  linearViewer() { return this.linear.viewer(); }
  linearIssues(team: string) { return this.linear.issues(team); }
  linearIssue(identifier: string) { return this.linear.issue(identifier); }
  linearIssueDescription(identifier: string) { return this.linear.description(identifier); }
  linearSubIssues(identifier: string) { return this.linear.subIssues(identifier); }
  linearAttachmentUrls(identifier: string) { return this.linear.attachmentUrls(identifier); }
  linearAssignSelf(identifier: string) { return this.linear.assignSelf(identifier); }

  async gitRemotes(path: string) {
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      return null;
    }
    const top = await exec(["git", "-C", real, "rev-parse", "--show-toplevel"]);
    if (top.exitCode !== 0 || realpathSync(top.stdout.trim()) !== real) return null;
    const remotes = await exec(["git", "-C", real, "config", "--get-regexp", "^remote\\..*\\.url$"]);
    return remotes.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(line.indexOf(" ") + 1));
  }

  async githubViewer() {
    return (await this.gh(["api", "user", "--jq", ".login"])).trim();
  }

  async githubIssues(slug: string) {
    const [owner, name] = slug.split("/") as [string, string];
    const issues: GitHubIssue[] = [];
    let cursor: string | null = null;
    do {
      const args = ["api", "graphql", "-f", `query=${ISSUES_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
      args.push("-f", `label=${READY_LABEL}`);
      if (cursor) args.push("-f", `cursor=${cursor}`);
      const response = JSON.parse(await this.read(slug, args));
      const page = response.data?.repository?.issues;
      if (!page) throw new WorldError("repository not found on GitHub, or not visible to your account");
      for (const node of page.nodes as IssueNode[]) this.rememberLinked(slug, node);
      issues.push(...(page.nodes as IssueNode[]).map(toIssue));
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    return issues;
  }

  async githubIssue(slug: string, number: number) {
    const [owner, name] = slug.split("/") as [string, string];
    const args = ["api", "graphql", "-f", `query=${ISSUE_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
    args.push("-F", `number=${number}`);
    const result = await this.readExec(slug, args);
    // A missing issue is a GraphQL error on an otherwise found repository.
    if (result.exitCode !== 0 && !/Could not resolve to an issue/i.test(result.stderr + result.stdout)) {
      throw await ghFailure(result.stderr, result.as);
    }
    const repository = JSON.parse(result.stdout || "{}").data?.repository;
    if (repository === undefined || repository === null) {
      throw new WorldError("repository not found on GitHub, or not visible to your account");
    }
    if (repository.issue) this.rememberLinked(slug, repository.issue);
    return repository.issue ? toIssue(repository.issue) : null;
  }

  async githubIssueDescription(slug: string, number: number): Promise<IssueDescription | null> {
    const result = await this.readExec(slug, ["api", `repos/${slug}/issues/${number}`]);
    if (result.exitCode !== 0) {
      if (/HTTP 404/i.test(result.stderr)) return null;
      throw await ghFailure(result.stderr, result.as);
    }
    const issue: { title: string; body: string | null; labels: { name: string }[] } = JSON.parse(result.stdout);
    return { title: issue.title, labels: issue.labels.map((l) => l.name), body: issue.body ?? "" };
  }

  async githubSubIssues(slug: string, number: number) {
    const [owner, name] = slug.split("/") as [string, string];
    const subIssues: GitHubSubIssue[] = [];
    let cursor: string | null = null;
    do {
      const args = ["api", "graphql", "-f", `query=${SUB_ISSUES_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
      if (cursor) args.push("-f", `cursor=${cursor}`);
      const page = JSON.parse(await this.read(slug, args)).data?.repository?.issue?.subIssues;
      if (!page) throw new WorldError(`${slug}#${number} was not found on GitHub`);
      const nodes = page.nodes as (IssueNode & { repository: { nameWithOwner: string } })[];
      for (const node of nodes) this.rememberLinked(node.repository.nameWithOwner, node);
      subIssues.push(...nodes.map((node) => ({ ...toIssue(node), slug: node.repository.nameWithOwner })));
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    return subIssues;
  }

  // A read, but through `ghbot`: only the App's installation token can list its repositories.
  async githubAppRepos() {
    const args = ["api", "/installation/repositories", "--paginate", "--jq", ".repositories[].full_name"];
    const result = await this.ghCall(args, { bin: "ghbot", query: "ghbot installation/repositories", resource: "app" });
    if (result.exitCode !== 0) {
      const reason = result.stderr.trim().split("\n")[0] || `exit code ${result.exitCode}`;
      throw new WorldError(`\`ghbot api /installation/repositories\` failed: ${reason}`);
    }
    return result.stdout.split("\n").filter(Boolean);
  }

  async githubLinkedPullRequests(slug: string, number: number) {
    const known = this.linkedPrs.get(`${slug.toLowerCase()}#${number}`);
    if (known && Date.now() - known.at < PR_SNAPSHOT_MS) return known.prs;
    const [owner, name] = slug.split("/") as [string, string];
    const args = ["api", "graphql", "-f", `query=${LINKED_PRS_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
    args.push("-F", `number=${number}`);
    const issue = JSON.parse(await this.read(slug, args)).data?.repository?.issue;
    if (!issue) throw new WorldError(`${slug}#${number} was not found on GitHub`);
    return (issue.closedByPullRequestsReferences.nodes as LinkedPrNode[]).map(toPullRequest);
  }

  async githubPullRequest(slug: string, number: number): Promise<PullRequest | null> {
    const args = ["pr", "view", String(number), "--repo", slug, "--json", LISTED_PR_FIELDS];
    const result = await this.readExec(slug, args);
    if (result.exitCode !== 0) {
      if (/Could not resolve to a PullRequest|no pull requests found/i.test(result.stderr)) return null;
      throw await ghFailure(result.stderr, result.as);
    }
    return toListedPr(slug, JSON.parse(result.stdout));
  }

  async githubPullRequestActivity(slug: string, number: number, since?: Date): Promise<PullRequestActivity> {
    const [owner, name] = slug.split("/") as [string, string];
    const args = ["api", "graphql", "-f", `query=${PR_ACTIVITY_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
    // As the user: the App can't read check results.
    const pr = JSON.parse(await this.gh(args)).data?.repository?.pullRequest as PrActivityNode | null | undefined;
    if (!pr) throw new WorldError(`${slug}#${number} was not found on GitHub`);
    const login = (author: { login: string } | null) => author?.login ?? "ghost";
    const comments: PullRequestComment[] = [
      ...pr.comments.nodes.map((c) => ({ id: c.id, author: login(c.author), at: c.createdAt, body: c.body })),
      ...pr.reviews.nodes.flatMap((r) => {
        const review = REVIEW_VERDICTS[r.state];
        if (!review || !r.submittedAt) return [];
        // An inline comment shows once its review is submitted, whenever it was drafted.
        const inline = r.comments.nodes.map((c) => ({ id: c.id, author: login(c.author), at: c.publishedAt ?? r.submittedAt!, body: c.body, path: c.path }));
        return [{ id: r.id, author: login(r.author), at: r.submittedAt, body: r.body, review }, ...inline];
      }),
    ];
    const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
    const result = (passed: boolean, pending: boolean): CheckResult => (pending ? "pending" : passed ? "passed" : "failed");
    return {
      state: pr.state.toLowerCase() as PullRequest["state"],
      draft: pr.isDraft,
      baseBranch: pr.baseRefName,
      mergeable: pr.mergeable.toLowerCase() as PullRequestActivity["mergeable"],
      comments: comments.filter((c) => !since || new Date(c.at) >= since).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      checks: contexts.map((c) => c.__typename === "CheckRun"
        ? { name: c.name, result: result(PASSED.includes(c.conclusion ?? ""), c.status !== "COMPLETED") }
        : { name: c.context, result: result(c.state === "SUCCESS", ["PENDING", "EXPECTED"].includes(c.state)) }),
    };
  }

  async githubRateLimit() {
    const { resources } = JSON.parse(await this.gh(["api", "rate_limit"]));
    const budget = (b: { limit: number; remaining: number; used: number; reset: number }) =>
      ({ limit: b.limit, remaining: b.remaining, used: b.used, reset: new Date(b.reset * 1000).toISOString() });
    return { core: budget(resources.core), graphql: budget(resources.graphql) };
  }

  async githubAssignSelf(slug: string, number: number) {
    await this.gh(["issue", "edit", String(number), "--repo", slug, "--add-assignee", "@me"]);
  }

  // Only the branch's own PRs: a Repo's whole PR history grows with it, and the Board needs none of the rest.
  async githubBranchPullRequests(slug: string, branch: string): Promise<PullRequest[]> {
    const listed: ListedPr[] = JSON.parse(await this.read(slug, ["pr", "list", "--repo", slug, "--head", branch, "--state", "all", "--limit", "100", "--json", LISTED_PR_FIELDS]));
    // gh lists newest first; linkedPr expects the latest at the end.
    return listed.reverse().filter((pr) => pr.headRefName === branch).map((pr) => toListedPr(slug, pr));
  }

  async gitFetch(path: string, branch?: string) {
    await git(path, ["fetch", "origin", ...(branch ? [`+refs/heads/${branch}:refs/remotes/origin/${branch}`] : [])]);
  }

  async gitRemoteBranches(path: string) {
    const listing = await git(path, ["ls-remote", "--heads", "origin"]);
    return listing.split("\n").flatMap((line) => line.match(/\trefs\/heads\/(.+)$/)?.[1] ?? []);
  }

  async gitDefaultBranch(path: string) {
    try {
      const ref = await git(path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      return ref.replace(/^origin\//, "");
    } catch {
      // Some clones lack origin/HEAD; ask the remote rather than write it into the clone.
      const listing = await git(path, ["ls-remote", "--symref", "origin", "HEAD"]);
      const branch = listing.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1];
      if (!branch) throw new WorldError(`could not find the default branch of origin in ${path}`);
      return branch;
    }
  }

  async herdrWorktreeCreate({ cwd, branch, base, label }: { cwd: string; branch: string; base: string; label: string }) {
    const result = await herdr(["worktree", "create", "--cwd", cwd, "--branch", branch, "--base", base, "--label", label, "--no-focus"]);
    return { workspace: result.workspace.workspace_id as string, path: result.worktree.path as string };
  }

  async herdrWorkspaceCreate({ cwd, label }: { cwd: string; label: string }) {
    const result = await herdr(["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"]);
    return { workspace: result.workspace.workspace_id as string };
  }

  async herdrWorkspaceClose(workspace: string) {
    try {
      await herdr(["workspace", "close", workspace]);
    } catch (e) {
      if (!(e instanceof HerdrError && e.code === "workspace_not_found")) throw e;
    }
  }

  async herdrTabCreate({ workspace, cwd, label }: { workspace: string; cwd: string; label: string }) {
    const result = await herdr(["tab", "create", "--workspace", workspace, "--cwd", cwd, "--label", label, "--no-focus"]);
    return { tab: result.tab.tab_id as string, pane: result.root_pane.pane_id as string };
  }

  async herdrWorktreeRemove(workspace: string) {
    try {
      await herdr(["worktree", "remove", "--workspace", workspace]);
    } catch (e) {
      if (!(e instanceof HerdrError && e.code === "workspace_not_found")) throw e;
    }
  }

  async herdrAgentStart({ name, kind, pane, args }: { name: string; kind: string; pane: string; args: string[] }) {
    try {
      await herdr(["agent", "start", name, "--kind", kind, "--pane", pane, "--", ...args]);
    } catch (e) {
      // Both leave the agent running, waiting on a startup question.
      if (e instanceof HerdrError && (e.code === "agent_not_ready" || e.code === "agent_blocked")) return { ready: false };
      throw e;
    }
    return { ready: true };
  }

  async herdrPaneRun(pane: string, command: string) {
    // Prints nothing on success.
    await herdrText(["pane", "run", pane, command]);
  }

  // `agent wait` fails at once on a pane with no agent yet, so poll until herdr detects one.
  async herdrAgentDetect(pane: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const agent = await herdr(["agent", "get", pane]);
        if (agent.agent?.agent && agent.agent.interactive_ready !== false) return;
      } catch (e) {
        if (!(e instanceof HerdrError && e.code === "agent_not_found")) throw e;
      }
      if (Date.now() >= deadline) {
        throw new WorldError(`agent_not_detected: herdr detected no agent ready in pane ${pane} within ${timeoutMs}ms`);
      }
      await Bun.sleep(DETECT_POLL_MS);
    }
  }

  async herdrAgentRename(pane: string, name: string) {
    await herdr(["agent", "rename", pane, name]);
  }

  async herdrAgents() {
    const result = await herdr(["agent", "list"]);
    const agents = result.agents as { name?: string; agent_status?: string }[];
    return agents.flatMap((a) => (a.name ? [{ name: a.name, state: a.agent_status ?? "unknown" }] : []));
  }

  async herdrAgentRead(name: string) {
    return herdrText(["agent", "read", name, "--source", "visible"]);
  }

  async herdrAgentSendKeys(name: string, keys: string[]) {
    await herdr(["agent", "send-keys", name, ...keys]);
  }

  async herdrAgentWait(name: string, states: string[], timeoutMs: number) {
    const until = states.flatMap((s) => ["--until", s]);
    await herdr(["agent", "wait", name, ...until, "--timeout", String(timeoutMs)]);
  }

  async herdrAgentPrompt(name: string, text: string) {
    const wait = ["--wait", "--until", "working", "--timeout", String(PROMPT_TIMEOUT_MS)];
    try {
      await herdr(["agent", "prompt", name, text, ...wait]);
    } catch (e) {
      if (e instanceof HerdrError && e.code === "agent_prompt_stalled") return { started: false };
      throw e;
    }
    return { started: true };
  }

  async codexModels() {
    const result = await exec(["codex", "debug", "models"]);
    if (result.exitCode === 0) return result.stdout;
    const reason = result.stderr.trim().split("\n")[0] || `exit code ${result.exitCode}`;
    throw new WorldError(`\`codex debug models\` failed: ${reason}`);
  }

  async opencodeModels(command: string) {
    const result = await exec([command, "api", "model.list"]);
    if (result.exitCode === 0) return result.stdout;
    const reason = result.stderr.trim().split("\n")[0] || `exit code ${result.exitCode}`;
    throw new WorldError(`\`${command} api model.list\` failed: ${reason}`);
  }

  processId() {
    return process.pid;
  }

  processAlive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // EPERM: alive, but someone else's.
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  now() {
    return new Date();
  }

  async notify(title: string, body: string) {
    const result = await exec(["notify-send", "--app-name", "nico-agent", "--", title, body]);
    if (result.exitCode !== 0) throw new WorldError(`\`notify-send\` failed: ${result.stderr.trim().split("\n")[0] || `exit code ${result.exitCode}`}`);
  }

  async serve(address: Address, handler: RequestHandler, pages: Pages, sockets: Sockets) {
    try {
      // A Board asks GitHub per issue and can take longer than Bun's 10s default; 255s is Bun's maximum.
      // Not `development`: the pages are served as bundled, with no hot reloading, from source as from the binary.
      Bun.serve({
        ...address,
        routes: pages,
        async fetch(request, server) {
          const socket = sockets[new URL(request.url).pathname];
          if (!socket) return handler(request);
          const answer = socket(request);
          if (answer instanceof Response) return answer;
          if (server.upgrade(request, { data: { open: answer } })) return undefined;
          return new Response("Expected a WebSocket\n", { status: 426 });
        },
        websocket: {
          data: {} as { open: (peer: SocketPeer) => SocketSession; session?: SocketSession },
          open(ws) {
            ws.data.session = ws.data.open({ send: (message) => ws.send(message), close: () => ws.close() });
          },
          message(ws, message) {
            ws.data.session?.message(typeof message === "string" ? message : new Uint8Array(message));
          },
          close(ws) {
            ws.data.session?.close();
          },
        },
        idleTimeout: 255,
        development: false,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
        throw new WorldError(`port ${address.port} is already in use`);
      }
      throw e;
    }
  }

  every(ms: number, task: () => Promise<void>) {
    const run = () => {
      task().catch((e) => console.error(e)).finally(() => setTimeout(run, ms));
    };
    setTimeout(run, ms);
  }

  env(name: string) {
    return process.env[name] || undefined;
  }

  async http(request: Request) {
    try {
      return await fetch(request, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (e) {
      const reason = (e as Error).name === "TimeoutError" ? `no answer in ${HTTP_TIMEOUT_MS / 1000}s` : (e as Error).message;
      throw new WorldError(`could not reach ${request.url}: ${reason}`);
    }
  }
}

/** How long a voice service may take to answer; a local one loads its model on the first request. */
const HTTP_TIMEOUT_MS = 120_000;

/** The fields `gh pr view` and `gh pr list` give a PR by. */
const LISTED_PR_FIELDS = "number,url,state,baseRefName,headRefName,isCrossRepository";

interface ListedPr {
  number: number;
  url: string;
  state: string;
  baseRefName: string;
  headRefName: string;
  isCrossRepository: boolean;
}

function toListedPr(repo: string, pr: ListedPr): PullRequest {
  return {
    repo,
    number: pr.number,
    url: pr.url,
    state: pr.state.toLowerCase() as PullRequest["state"],
    baseBranch: pr.baseRefName,
    // A fork head is not fetchable as origin/<head branch> in this clone.
    ...(!pr.isCrossRepository && { headBranch: pr.headRefName }),
  };
}

function toPullRequest(pr: LinkedPrNode): PullRequest {
  return {
    repo: pr.repository.nameWithOwner,
    number: pr.number,
    url: pr.url,
    state: pr.state.toLowerCase() as PullRequest["state"],
    baseBranch: pr.baseRefName,
    // A fork head is not fetchable as origin/<head branch> in this clone.
    headBranch: pr.headRepository?.nameWithOwner.toLowerCase() === pr.repository.nameWithOwner.toLowerCase() ? pr.headRefName : undefined,
  };
}

function toIssue(node: IssueNode): GitHubIssue {
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state === "OPEN" ? "open" : "closed",
    labels: node.labels.nodes.map((l) => l.name),
    assignees: node.assignees.nodes.map((a) => a.login),
    blockers: node.blockedBy.nodes.map((b) => ({
      slug: b.repository.nameWithOwner,
      number: b.number,
      state: b.state === "OPEN" ? "open" : "closed",
    })),
    parent: node.parent ? { slug: node.parent.repository.nameWithOwner, number: node.parent.number } : null,
    hasSubIssues: node.subIssuesSummary.total > 0,
  };
}
