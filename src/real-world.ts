import { realpathSync } from "node:fs";
import type { Address, GitHubIssue, RequestHandler, World } from "./world";
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

/** Run `gh`, translating its failures into actionable WorldErrors. */
async function gh(args: string[]): Promise<string> {
  const result = await exec(["gh", ...args], { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" });
  if (result.exitCode === 0) return result.stdout;
  const stderr = result.stderr;
  if (/auth login|authentication|HTTP 401/i.test(stderr)) {
    throw new WorldError("not authenticated with GitHub; run `gh auth login`");
  }
  if (/Could not resolve to a Repository|HTTP 404/i.test(stderr)) {
    throw new WorldError("repository not found on GitHub, or not visible to your account");
  }
  if (/rate limit/i.test(stderr)) throw new WorldError("GitHub rate limit exceeded; try again later");
  throw new WorldError("GitHub request failed; check your network and `gh auth status`");
}

const ISSUES_QUERY = `
query($owner: String!, $name: String!, $label: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor, states: OPEN, labels: [$label], orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state
        labels(first: 50) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        blockedBy(first: 50) { nodes { number state repository { nameWithOwner } } }
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
