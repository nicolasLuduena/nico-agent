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
    let payload: { data?: T; errors?: unknown[] };
    try { payload = await response.json() as typeof payload; }
    catch { throw new WorldError("Linear returned an invalid response"); }
    if (!payload || typeof payload !== "object" || payload.errors?.length || !payload.data) throw new WorldError("Linear GraphQL request failed; check API key permissions and selectors");
    return payload.data;
  }

  async viewer() {
    return (await this.query<{ viewer: { id: string } }>("query { viewer { id } }")).viewer.id;
  }

  async issues(team: string): Promise<LinearIssue[]> {
    const issues: LinearIssue[] = [];
    let cursor: string | null = null;
    do {
      const data: { issues: Connection<IssueNode> } = await this.query(ISSUES_QUERY, {
        filter: { team: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(team)
          ? { id: { eq: team } } : { or: [{ key: { eq: team } }, { name: { eq: team } }] }, labels: { name: { eq: "ready-for-agent" } } }, cursor,
      });
      for (const node of data.issues.nodes) {
        const labels = await this.remaining(node.id, "labels", node.labels, "name");
        const relations = await this.remaining(node.id, "inverseRelations", node.inverseRelations, "type issue { state { type } }");
        issues.push({
          identifier: node.identifier, title: node.title, url: node.url, team: node.team, project: node.project,
          labels: labels.map((l) => l.name), state: node.state.type, assignee: node.assignee?.id ?? null,
          blockers: relations.filter((r) => r.type === "blocks").map((r) => ({ state: r.issue.state.type })),
        });
      }
      cursor = nextCursor(data.issues);
    } while (cursor);
    return issues;
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
  team: LinearIssue["team"];
  project: LinearIssue["project"];
  state: { type: string };
  assignee: { id: string } | null;
  labels: Connection<{ name: string }>;
  inverseRelations: Connection<{ type: string; issue: { state: { type: string } } }>;
}

const ISSUES_QUERY = `query($filter: IssueFilter!, $cursor: String) {
  issues(first: 100, after: $cursor, filter: $filter) {
    nodes {
      id identifier title url team { id key name } project { id name }
      state { type } assignee { id }
      labels(first: 100) { nodes { name } pageInfo { hasNextPage endCursor } }
      inverseRelations(first: 100) { nodes { type issue { state { type } } } pageInfo { hasNextPage endCursor } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
