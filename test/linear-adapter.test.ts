import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinearSource } from "../src/linear";

function page<T>(nodes: T[], cursor: string | null = null) {
  return { nodes, pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } };
}

function server(handler: (body: any, request: Request) => Response) {
  const app = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { return handler(await request.json(), request); } });
  return { app, endpoint: `http://127.0.0.1:${app.port}` };
}

test("Linear adapter reads viewer, pages issues and uses incoming blocks as Blockers", async () => {
  const requests: any[] = [];
  const { app, endpoint } = server((body, request) => {
    expect(request.headers.get("authorization")).toBe("test-key");
    requests.push(body);
    if (body.query.includes("viewer")) return Response.json({ data: { viewer: { id: "user-me" } } });
    if (body.query.includes("issue(id:")) {
      if (body.query.includes("inverseRelations")) return Response.json({ data: { issue: { inverseRelations: page([{ type: "blocks", issue: { identifier: "BLE-26", state: { type: "started" } } }]) } } });
      return Response.json({ data: { issue: { labels: page([{ name: "pdf" }]) } } });
    }
    if (body.variables.cursor) return Response.json({ data: { issues: page([]) } });
    return Response.json({ data: { issues: page([{
      id: "issue-27", identifier: "BLE-27", title: "Compare PDFs", url: "https://linear.app/bleentr/issue/BLE-27", branchName: "nico/ble-27",
      team: { id: "team-ble", key: "BLE", name: "Bleentr" }, project: { id: "pdf", name: "PDF diff" },
      state: { type: "backlog" }, assignee: { id: "user-me" }, labels: page([{ name: "ready-for-agent" }], "labels-2"),
      inverseRelations: page([
        { type: "related", issue: { identifier: "BLE-24", state: { type: "started" } } },
        { type: "blocks", issue: { identifier: "BLE-25", state: { type: "completed" } } },
      ], "relations-2"),
    }], "issues-2") } });
  });
  try {
    const source = new LinearSource("/unused", { LINEAR_API_KEY: "test-key" }, endpoint);
    expect(await source.viewer()).toBe("user-me");
    expect(await source.issues("BLE")).toEqual([{
      identifier: "BLE-27", title: "Compare PDFs", url: "https://linear.app/bleentr/issue/BLE-27", branchName: "nico/ble-27",
      team: { id: "team-ble", key: "BLE", name: "Bleentr" }, project: { id: "pdf", name: "PDF diff" },
      state: "backlog", assignee: "user-me", labels: ["ready-for-agent", "pdf"],
      blockers: [{ identifier: "BLE-25", state: "completed" }, { identifier: "BLE-26", state: "started" }],
    }]);
    expect(requests.at(-1).variables.cursor).toBe("issues-2");
    expect(requests[1].variables.filter.team).toEqual({ or: [{ key: { eq: "BLE" } }, { name: { eq: "BLE" } }] });
  } finally { app.stop(true); }
});

test("Linear adapter reads a mode 600 secrets file and environment takes precedence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "linear-secrets-"));
  const file = join(dir, "secrets.env");
  writeFileSync(file, 'LINEAR_API_KEY="file-key"\n', { mode: 0o600 });
  const { app, endpoint } = server((_body, request) => Response.json({ data: { viewer: { id: request.headers.get("authorization") } } }));
  try {
    expect(await new LinearSource(dir, {}, endpoint).viewer()).toBe("file-key");
    chmodSync(file, 0o644);
    expect(new LinearSource(dir, {}, endpoint).viewer()).rejects.toThrow("mode 600");
    expect(await new LinearSource(dir, { LINEAR_API_KEY: "env-key" }, endpoint).viewer()).toBe("env-key");
    expect(new LinearSource(join(dir, "missing"), {}, endpoint).viewer()).rejects.toThrow("Missing LINEAR_API_KEY");
  } finally { app.stop(true); }
});

for (const [name, response] of [
  ["auth error", () => new Response("secret response", { status: 401 })],
  ["GraphQL error", () => Response.json({ errors: [{ message: "secret response" }], data: { viewer: null } })],
  ["invalid JSON", () => new Response("secret response")],
  ["null JSON", () => Response.json(null)],
] as const) {
  test(`Linear adapter reports ${name} as a Source error without exposing response content`, async () => {
    const { app, endpoint } = server(response);
    try {
      await new LinearSource("/unused", { LINEAR_API_KEY: "test-key" }, endpoint).viewer().then(
        () => { throw new Error("expected failure"); },
        (error) => {
          expect(error.constructor.name).toBe("WorldError");
          expect(error.message).not.toContain("secret response");
        },
      );
    } finally { app.stop(true); }
  });
}

test("Linear adapter reads one issue with its branchName, null when Linear has no such issue", async () => {
  const { app, endpoint } = server((body) => {
    if (body.variables.id === "BLE-99") return Response.json({ data: null, errors: [{ message: "Entity not found: Issue" }] });
    return Response.json({ data: { issue: {
      id: "issue-27", identifier: "BLE-27", title: "Compare PDFs", url: "https://linear.app/bleentr/issue/BLE-27", branchName: "nico/ble-27",
      team: { id: "team-ble", key: "BLE", name: "Bleentr" }, project: null, state: { type: "unstarted" }, assignee: null,
      labels: page([{ name: "ready-for-agent" }]), inverseRelations: page([]),
    } } });
  });
  try {
    const source = new LinearSource("/unused", { LINEAR_API_KEY: "test-key" }, endpoint);
    expect(await source.issue("BLE-27")).toMatchObject({ identifier: "BLE-27", branchName: "nico/ble-27", state: "unstarted", blockers: [] });
    expect(await source.issue("BLE-99")).toBeNull();
  } finally { app.stop(true); }
});

test("Linear adapter pages attachment URLs and assigns the issue to the API key's owner", async () => {
  const requests: any[] = [];
  const { app, endpoint } = server((body) => {
    requests.push(body);
    if (body.query.includes("issueUpdate")) return Response.json({ data: { issueUpdate: { success: true } } });
    if (body.query.includes("viewer")) return Response.json({ data: { viewer: { id: "user-me" }, issue: { id: "issue-27" } } });
    if (body.variables.cursor) return Response.json({ data: { issue: { attachments: page([{ url: "https://github.com/bleentr/pdf-diff/pull/12" }]) } } });
    return Response.json({ data: { issue: { id: "issue-27", attachments: page([{ url: "https://www.figma.com/file/abc" }], "attachments-2") } } });
  });
  try {
    const source = new LinearSource("/unused", { LINEAR_API_KEY: "test-key" }, endpoint);
    expect(await source.attachmentUrls("BLE-27")).toEqual(["https://www.figma.com/file/abc", "https://github.com/bleentr/pdf-diff/pull/12"]);
    await source.assignSelf("BLE-27");
    expect(requests.at(-1).variables).toEqual({ id: "issue-27", assigneeId: "user-me" });
  } finally { app.stop(true); }
});
