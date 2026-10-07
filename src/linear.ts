import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defaultConfigDir } from "./config";
import { type LinearIssue, WorldError } from "./world";

/** A Linear identifier, whether supplied directly or in a Linear issue URL. */
export function linearIdentifier(ref: string): string | null {
  const match = ref.match(/^([A-Z][A-Z0-9]*-\d+)$/i) ??
    ref.match(/^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]*-\d+)(?:\/[^?#]*)?(?:[?#].*)?$/i);
  return match?.[1]?.toUpperCase() ?? null;
}

export class LinearSource {
  constructor(
    private readonly configDir = defaultConfigDir(process.env),
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly endpoint = "https://api.linear.app/graphql",
  ) {}

  private key() {
    if (this.env.LINEAR_API_KEY) return this.env.LINEAR_API_KEY;
    const file = join(this.configDir, "secrets.env");
    try {
      if ((statSync(file).mode & 0o777) !== 0o600) throw new WorldError(`${file} must have mode 600`);
      const match = readFileSync(file, "utf8").match(/^\s*(?:export\s+)?LINEAR_API_KEY\s*=\s*(.*?)\s*$/m);
      let key = match?.[1] ?? "";
      if (/^(["']).*\1$/.test(key)) key = key.slice(1, -1);
      if (key) return key;
    } catch (e) {
      if (e instanceof WorldError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new WorldError("Could not read Linear secrets.env");
    }
    throw new WorldError("Missing LINEAR_API_KEY; set it in the environment or secrets.env with mode 600");
  }

  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const data = await this.queryOrNotFound<T>(query, variables);
    if (data === null) throw new WorldError("Linear GraphQL request failed; check API key permissions and selectors");
    return data;
  }

  /** Like `query`, but null when Linear reports the entity asked for doesn't exist. */
  private async queryOrNotFound<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
    const key = this.key();
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: key },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new WorldError("Linear request failed; check your network"); }
    if ([401, 403].includes(response.status)) throw new WorldError("Not authenticated with Linear; check LINEAR_API_KEY");
    if (!response.ok) throw new WorldError(`Linear request failed (HTTP ${response.status})`);
    let payload: { data?: T; errors?: { message?: string }[] };
    try { payload = await response.json() as typeof payload; }
    catch { throw new WorldError("Linear returned an invalid response"); }
    if (payload?.errors?.some((e) => /entity not found/i.test(e?.message ?? ""))) return null;
    if (!payload || typeof payload !== "object" || payload.errors?.length || !payload.data) throw new WorldError("Linear GraphQL request failed; check API key permissions and selectors");
    return payload.data;
  }

  async viewer() {
    return (await this.query<{ viewer: { id: string } }>("query { viewer { id } }")).viewer.id;
  }

  async issue(identifier: string): Promise<LinearIssue | null> {
    const data = await this.queryOrNotFound<{ issue: IssueNode | null }>(ISSUE_QUERY, { id: identifier });
    return data?.issue ? this.toIssue(data.issue) : null;
  }

  async attachmentUrls(identifier: string): Promise<string[]> {
    const data = await this.query<{ issue: { id: string; attachments: Connection<{ url: string }> } }>(
      `query($id: String!) { issue(id: $id) { id attachments(first: 100) { nodes { url } pageInfo { hasNextPage endCursor } } } }`, { id: identifier },
    );
    return (await this.remaining(data.issue.id, "attachments", data.issue.attachments, "url")).map((a) => a.url);
  }

  async assignSelf(identifier: string) {
    const data = await this.query<{ viewer: { id: string }; issue: { id: string } }>(
      "query($id: String!) { viewer { id } issue(id: $id) { id } }", { id: identifier },
    );
    const result = await this.query<{ issueUpdate: { success: boolean } }>(
      "mutation($id: String!, $assigneeId: String!) { issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }",
      { id: data.issue.id, assigneeId: data.viewer.id },
    );
    if (!result.issueUpdate.success) throw new WorldError(`Linear did not assign ${identifier}`);
  }

  async issues(team: string): Promise<LinearIssue[]> {
    const issues: LinearIssue[] = [];
    let cursor: string | null = null;
    do {
      const data: { issues: Connection<IssueNode> } = await this.query(ISSUES_QUERY, {
        filter: { team: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(team)
          ? { id: { eq: team } } : { or: [{ key: { eq: team } }, { name: { eq: team } }] }, labels: { name: { eq: "ready-for-agent" } } }, cursor,
      });
      for (const node of data.issues.nodes) issues.push(await this.toIssue(node));
      cursor = nextCursor(data.issues);
    } while (cursor);
    return issues;
  }

  private async toIssue(node: IssueNode): Promise<LinearIssue> {
    const labels = await this.remaining(node.id, "labels", node.labels, "name");
    const relations = await this.remaining(node.id, "inverseRelations", node.inverseRelations, "type issue { identifier state { type } }");
    return {
      identifier: node.identifier, title: node.title, url: node.url, branchName: node.branchName, team: node.team, project: node.project,
      labels: labels.map((l) => l.name), state: node.state.type, assignee: node.assignee?.id ?? null,
      blockers: relations.filter((r) => r.type === "blocks").map((r) => ({ identifier: r.issue.identifier, state: r.issue.state.type })),
      parent: node.parent?.identifier ?? null, hasSubIssues: (node.children?.nodes.length ?? 0) > 0,
    };
  }

  /** Every child of an issue, in Linear's sub-issue order. */
  async subIssues(identifier: string): Promise<LinearIssue[]> {
    const nodes: (IssueNode & { subIssueSortOrder: number | null })[] = [];
    let cursor: string | null = null;
    do {
      const data: { issue: { children: Connection<IssueNode & { subIssueSortOrder: number | null }> } } = await this.query(SUB_ISSUES_QUERY, { id: identifier, cursor });
      nodes.push(...data.issue.children.nodes);
      cursor = nextCursor(data.issue.children);
    } while (cursor);
    // Linear leaves the order unset until sub-issues are reordered; fall back to creation order.
    const ordered = nodes.map((node, i) => ({ node, i }))
      .sort((a, b) => (a.node.subIssueSortOrder ?? a.i) - (b.node.subIssueSortOrder ?? b.i) || a.i - b.i);
    return Promise.all(ordered.map(({ node }) => this.toIssue(node)));
  }

  private async remaining<T>(id: string, field: string, initial: Connection<T>, fields: string): Promise<T[]> {
    const nodes = [...initial.nodes];
    let cursor = nextCursor(initial);
    while (cursor) {
      const data = await this.query<{ issue: Record<string, Connection<T>> }>(
        `query($id: String!, $cursor: String) { issue(id: $id) { ${field}(first: 100, after: $cursor) { nodes { ${fields} } pageInfo { hasNextPage endCursor } } } }`, { id, cursor },
      );
      const page = data.issue[field]!;
      nodes.push(...page.nodes);
      cursor = nextCursor(page);
    }
    return nodes;
  }
}

interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

function nextCursor(page: Connection<unknown>) {
  if (!page.pageInfo.hasNextPage) return null;
  if (!page.pageInfo.endCursor) throw new WorldError("Linear returned a page without a cursor");
  return page.pageInfo.endCursor;
}

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
  team: LinearIssue["team"];
  project: LinearIssue["project"];
  state: { type: string };
  assignee: { id: string } | null;
  labels: Connection<{ name: string }>;
  inverseRelations: Connection<{ type: string; issue: { identifier: string; state: { type: string } } }>;
  parent?: { identifier: string } | null;
  children?: { nodes: { id: string }[] };
}

const ISSUE_FIELDS = `
      id identifier title url branchName team { id key name } project { id name }
      state { type } assignee { id }
      labels(first: 100) { nodes { name } pageInfo { hasNextPage endCursor } }
      inverseRelations(first: 100) { nodes { type issue { identifier state { type } } } pageInfo { hasNextPage endCursor } }
      parent { identifier } children(first: 1) { nodes { id } }`;

const ISSUES_QUERY = `query($filter: IssueFilter!, $cursor: String) {
  issues(first: 100, after: $cursor, filter: $filter) {
    nodes {${ISSUE_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SUB_ISSUES_QUERY = `query($id: String!, $cursor: String) {
  issue(id: $id) {
    children(first: 100, after: $cursor) {
      nodes {${ISSUE_FIELDS}
        subIssueSortOrder
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const ISSUE_QUERY = `query($id: String!) {
  issue(id: $id) {${ISSUE_FIELDS}
  }
}`;
