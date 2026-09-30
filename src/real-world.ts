import { realpathSync } from "node:fs";
import type { Address, GitHubIssue, PullRequest, RequestHandler, World } from "./world";
import { READY_LABEL, WorldError } from "./world";

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

/** Run `gh`, translating its failures into actionable WorldErrors. */
async function gh(args: string[]): Promise<string> {
  const result = await exec(["gh", ...args], GH_ENV);
  if (result.exitCode === 0) return result.stdout;
  throw ghFailure(result.stderr);
}

function ghFailure(stderr: string): WorldError {
  if (/auth login|authentication|HTTP 401/i.test(stderr)) {
    return new WorldError("not authenticated with GitHub; run `gh auth login`");
  }
  if (/Could not resolve to a Repository|HTTP 404/i.test(stderr)) {
    return new WorldError("repository not found on GitHub, or not visible to your account");
  }
  if (/rate limit/i.test(stderr)) return new WorldError("GitHub rate limit exceeded; try again later");
  return new WorldError("GitHub request failed; check your network and `gh auth status`");
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

const ISSUE_FIELDS = `
        number title url state
        labels(first: 50) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        blockedBy(first: 50) { nodes { number state repository { nameWithOwner } } }`;

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
        nodes { number url state baseRefName headRefName headRepository { nameWithOwner } repository { nameWithOwner } }
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
}

export class RealWorld implements World {
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
    return (await gh(["api", "user", "--jq", ".login"])).trim();
  }

  async githubIssues(slug: string) {
    const [owner, name] = slug.split("/") as [string, string];
    const issues: GitHubIssue[] = [];
    let cursor: string | null = null;
    do {
      const args = ["api", "graphql", "-f", `query=${ISSUES_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
      args.push("-f", `label=${READY_LABEL}`);
      if (cursor) args.push("-f", `cursor=${cursor}`);
      const response = JSON.parse(await gh(args));
      const page = response.data?.repository?.issues;
      if (!page) throw new WorldError("repository not found on GitHub, or not visible to your account");
      issues.push(...(page.nodes as IssueNode[]).map(toIssue));
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    return issues;
  }

  async githubIssue(slug: string, number: number) {
    const [owner, name] = slug.split("/") as [string, string];
    const args = ["api", "graphql", "-f", `query=${ISSUE_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
    args.push("-F", `number=${number}`);
    const result = await exec(["gh", ...args], GH_ENV);
    // A missing issue is a GraphQL error on an otherwise found repository.
    if (result.exitCode !== 0 && !/Could not resolve to an issue/i.test(result.stderr + result.stdout)) {
      throw ghFailure(result.stderr);
    }
    const repository = JSON.parse(result.stdout || "{}").data?.repository;
    if (repository === undefined || repository === null) {
      throw new WorldError("repository not found on GitHub, or not visible to your account");
    }
    return repository.issue ? toIssue(repository.issue) : null;
  }

  // A read, but through `ghbot`: only the App's installation token can list its repositories.
  async githubAppRepos() {
    const args = ["api", "/installation/repositories", "--paginate", "--jq", ".repositories[].full_name"];
    const result = await exec(["ghbot", ...args], GH_ENV);
    if (result.exitCode !== 0) {
      const reason = result.stderr.trim().split("\n")[0] || `exit code ${result.exitCode}`;
      throw new WorldError(`\`ghbot api /installation/repositories\` failed: ${reason}`);
    }
    return result.stdout.split("\n").filter(Boolean);
  }

  async githubLinkedPullRequests(slug: string, number: number) {
    const [owner, name] = slug.split("/") as [string, string];
    const args = ["api", "graphql", "-f", `query=${LINKED_PRS_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`];
    args.push("-F", `number=${number}`);
    const issue = JSON.parse(await gh(args)).data?.repository?.issue;
    if (!issue) throw new WorldError(`${slug}#${number} was not found on GitHub`);
    const nodes = issue.closedByPullRequestsReferences.nodes as {
      number: number;
      url: string;
      state: string;
      baseRefName: string;
      headRefName: string;
      headRepository: { nameWithOwner: string } | null;
      repository: { nameWithOwner: string };
    }[];
    return nodes.map((pr) => ({
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      url: pr.url,
      state: pr.state.toLowerCase() as PullRequest["state"],
      baseBranch: pr.baseRefName,
      // A fork head is not fetchable as origin/<head branch> in this clone.
      headBranch: pr.headRepository?.nameWithOwner.toLowerCase() === pr.repository.nameWithOwner.toLowerCase() ? pr.headRefName : undefined,
    }));
  }

  async githubAssignSelf(slug: string, number: number) {
    await gh(["issue", "edit", String(number), "--repo", slug, "--add-assignee", "@me"]);
  }

  async githubBranchPullRequests(slug: string, branch: string): Promise<PullRequest[]> {
    const result = await gh(["pr", "list", "--repo", slug, "--head", branch, "--state", "all", "--limit", "100", "--json", "number,url,state,baseRefName"]);
    const prs = JSON.parse(result) as { number: number; url: string; state: string; baseRefName: string }[];
    // gh lists newest first; linkedPr expects the latest at the end.
    return prs.reverse().map((pr) => ({ repo: slug, number: pr.number, url: pr.url,
      state: pr.state.toLowerCase() as PullRequest["state"], baseBranch: pr.baseRefName }));
  }

  async gitFetch(path: string, branch?: string) {
    await git(path, ["fetch", "origin", ...(branch ? [`+refs/heads/${branch}:refs/remotes/origin/${branch}`] : [])]);
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

  async serve(address: Address, handler: RequestHandler) {
    try {
      Bun.serve({ ...address, fetch: handler });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
        throw new WorldError(`port ${address.port} is already in use`);
      }
      throw e;
    }
  }
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
  };
}
