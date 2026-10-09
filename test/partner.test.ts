import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

async function withRepo(slug = "acme/api", path = "/src/api") {
  const ctx = setup();
  ctx.world.addClone(path, `git@github.com:${slug}.git`);
  await ctx.cli("repo", "add", slug, "--path", path);
  ctx.world.calls.length = 0;
  return { ...ctx, home: join(ctx.configDir, "partners", "review") };
}

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** A Review partner started on acme/api, its calls forgotten. */
async function started() {
  const ctx = await withRepo();
  const { exitCode, stdout } = await ctx.cli("partner", "start", "review", "--repo", "acme/api", ...FLAGS);
  expect(stdout).not.toContain("error");
  expect(exitCode).toBe(0);
  ctx.world.calls.length = 0;
  return ctx;
}

describe("partner start", () => {
  test("a worktree of the Repo on its default branch, the agent in a partner tab, connected to its own MCP server and prompted with the Partner skill", async () => {
    const { cli, world, home } = await withRepo();
    const { stdout, exitCode } = await cli("partner", "start", "review", "--repo", "acme/api", ...FLAGS);
    expect(stdout).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(world.calls).toEqual([
      "git -C /src/api default-branch",
      "git -C /src/api fetch origin",
      "herdr worktree create --cwd /src/api --branch partner/review-api-20260930120000 --base origin/main --label api:review --no-focus",
      "herdr tab create --workspace w1 --cwd /worktrees/review-api-20260930120000 --label partner --no-focus",
      `herdr agent start partner-review --kind claude --pane w1:p2 -- --model opus --effort high --mcp-config ${home}/mcp.json`,
      `herdr agent prompt partner-review Read the Partner skill at ${home}/SKILL.md and follow it: you are the Review partner, in a worktree of acme/api.`,
    ]);
    expect(JSON.parse(readFileSync(join(home, "mcp.json"), "utf8"))).toEqual({
      mcpServers: { "nico-agent": { type: "http", url: "http://127.0.0.1:42069/mcp/partner/review" } },
    });
    expect(readFileSync(join(home, "SKILL.md"), "utf8")).toStartWith("# A Partner\n");
  });

  test("the launch is remembered, so the next form starts on it", async () => {
    const { cli } = await withRepo();
    await cli("partner", "start", "idea", "--repo", "acme/api", "--harness", "claude", "--model", "sonnet", "--effort", "low");
    expect((await cli("harness", "list", "--json")).json().remembered).toMatchObject({ last: { harness: "claude", model: "sonnet" } });
  });

  test("a second start while it runs is a no-op; another Repo is refused until it ends", async () => {
    const { cli, world } = await started();
    const again = await cli("partner", "start", "review", "--repo", "acme/api", ...FLAGS, "--json");
    expect(again.exitCode).toBe(0);
    expect(again.json().partner).toBe("already running (no-op)");
    expect(world.calls.filter((c) => c.startsWith("herdr") && c !== "herdr agent list")).toEqual([]);
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    const other = await cli("partner", "start", "review", "--repo", "acme/web", ...FLAGS, "--json");
    expect(other.exitCode).toBe(1);
    expect(other.json().error).toBe("the Review partner already runs in acme/api");
  });

  test("an unknown tab or Repo is refused before anything starts", async () => {
    const { cli, world } = await withRepo();
    expect((await cli("partner", "start", "lead", "--repo", "acme/api", ...FLAGS)).exitCode).toBe(2);
    expect((await cli("partner", "start", "idea", "--repo", "acme/nope", ...FLAGS)).exitCode).toBe(1);
    expect(world.calls.filter((c) => c.startsWith("herdr"))).toEqual([]);
  });
});

describe("the Thread", () => {
  test("the user's message is kept in the Thread and typed into the Partner's pane; its reply through say lands in the Thread, not in the Lead's Conversation", async () => {
    const { cli, world, configDir } = await started();
    const said = await cli("partner", "say", "review", "--json", "--", "What does retry.ts do?");
    expect(said.exitCode).toBe(0);
    expect(world.calls).toContain("herdr agent prompt partner-review What does retry.ts do?");
    expect((await cli("partner", "reply", "review", "--", "It backs off exponentially.")).exitCode).toBe(0);
    const log = (await cli("partner", "log", "review", "--json")).json();
    expect(log.entries).toEqual([
      { id: 1, at: "2026-09-30T12:00:00.000Z", type: "user", text: "What does retry.ts do?" },
      { id: 2, at: "2026-09-30T12:00:00.000Z", type: "partner", text: "It backs off exponentially." },
    ]);
    expect(existsSync(join(configDir, "conversation.jsonl"))).toBe(false);
  });

  test("the Thread is a file in the config directory, so a restarted serve reads it again", async () => {
    const { cli, configDir } = await started();
    await cli("partner", "reply", "review", "--", "Hello");
    const partners = JSON.parse(readFileSync(join(configDir, "partners.json"), "utf8"));
    const lines = readFileSync(join(configDir, partners.review.thread), "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).text)).toEqual(["Hello"]);
  });

  test("a message to a tab without a Partner is refused", async () => {
    const { cli } = await withRepo();
    const said = await cli("partner", "say", "idea", "--json", "--", "hi");
    expect(said.exitCode).toBe(1);
    expect(said.json().error).toBe("no Idea partner runs");
  });
});

describe("hand-off", () => {
  test("the Partner drafts it; nothing reaches the Lead until the user approves it, then it is the user's message naming the Partner", async () => {
    const { cli, world, configDir } = await started();
    const drafted = await cli("partner", "draft", "review", "--json", "--", "Ask the Implementer to add a test for retries.");
    expect(drafted.json().drafted).toBe(1);
    expect(existsSync(join(configDir, "conversation.jsonl"))).toBe(false);
    world.agentStates.set("lead", "idle");
    const handed = await cli("partner", "hand-off", "review", "1", "--json");
    expect(handed.exitCode).toBe(0);
    const log = (await cli("lead", "log", "--json")).json();
    expect(log.entries).toEqual([
      { id: 1, who: "user", at: "2026-09-30T12:00:00.000Z", type: "user", text: "Hand-off from the Review partner (acme/api):\n\nAsk the Implementer to add a test for retries." },
    ]);
    const thread = (await cli("partner", "log", "review", "--json")).json().entries;
    expect(thread.at(-1)).toMatchObject({ type: "handoff", draft: 1, lead: 1, text: "Ask the Implementer to add a test for retries." });
  });

  test("the user may edit the draft before approving it", async () => {
    const { cli } = await started();
    await cli("partner", "draft", "review", "--", "First draft");
    expect((await cli("partner", "hand-off", "review", "1", "--text", "Edited by me")).exitCode).toBe(0);
    expect((await cli("lead", "log", "--json")).json().entries[0].text).toEndWith("\n\nEdited by me");
  });

  test("only the open draft can be handed, and only once", async () => {
    const { cli } = await started();
    await cli("partner", "draft", "review", "--", "Old");
    await cli("partner", "draft", "review", "--", "New");
    const stale = await cli("partner", "hand-off", "review", "1", "--json");
    expect(stale.exitCode).toBe(1);
    expect(stale.json().error).toBe("draft 1 is not the open hand-off (2 is)");
    expect((await cli("partner", "hand-off", "review", "2")).exitCode).toBe(0);
    expect((await cli("partner", "hand-off", "review", "2", "--json")).json().error).toBe("draft 2 was already handed to the Lead");
  });
});

describe("partner end", () => {
  test("removes its worktree and workspace and forgets it", async () => {
    const { cli, world } = await started();
    const ended = await cli("partner", "end", "review", "--json");
    expect(ended.exitCode).toBe(0);
    expect(world.calls).toContain("herdr worktree remove --workspace w1");
    expect((await cli("partner", "list", "--json")).json().partners).toEqual([]);
    expect((await cli("partner", "end", "review", "--json")).json().partner).toBe("not running (no-op)");
  });
});

describe("partner list", () => {
  test("each Partner with its Repo, launch, where it stands and its Agent state", async () => {
    const { cli } = await started();
    expect((await cli("partner", "list", "--json")).json().partners).toEqual([
      { tab: "review", partner: "running", state: "working", repo: "acme/api", agent: "partner-review", harness: "claude", model: "opus", effort: "high", workspace: "w1", startedAt: "2026-09-30T12:00:00.000Z" },
    ]);
  });
});

describe("a Partner's MCP server", () => {
  async function rpc(web: Awaited<ReturnType<typeof started>>["web"], tab: string, message: unknown) {
    const response = await web(`/mcp/partner/${tab}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message) });
    return { status: response.status, json: JSON.parse(response.body) };
  }

  test("offers only its Thread's tools and the hand-off: no Board action, no Board read", async () => {
    const { web } = await started();
    const { json } = await rpc(web, "review", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["say", "hand_off", "thread"]);
    // No server answers a tab that is not a Partner's.
    expect((await web("/mcp/partner/lead", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status).toBe(405);
    for (const action of ["dispatch", "review", "close", "answer", "queue", "unqueue", "advance", "propose", "board", "inbox", "intent", "notes", "peek", "ask"]) {
      expect(names).not.toContain(action);
      const called = await rpc(web, "review", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: action, arguments: {} } });
      expect(called.json.error.message).toStartWith(`Unknown tool: ${action}`);
    }
  });

  test("say writes into its own Thread, and hand_off drafts the Hand-off there; the Lead's Conversation is untouched", async () => {
    const { web, cli, configDir } = await started();
    const said = await rpc(web, "review", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "say", arguments: { text: "Looks fine to me." } } });
    expect(said.json.result.isError).toBe(false);
    await rpc(web, "review", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hand_off", arguments: { text: "Merge it." } } });
    const thread = await rpc(web, "review", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "thread", arguments: {} } });
    expect(thread.json.result.structuredContent.entries.map((e: { type: string; text: string }) => [e.type, e.text])).toEqual([["partner", "Looks fine to me."], ["draft", "Merge it."]]);
    expect((await cli("partner", "log", "review", "--json")).json().entries).toHaveLength(2);
    expect(existsSync(join(configDir, "conversation.jsonl"))).toBe(false);
  });

  test("the instructions name the Partner's tools only", async () => {
    const { web } = await started();
    const { json } = await rpc(web, "idea", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {} } });
    expect(json.result.instructions).toContain("`hand_off`");
    expect(json.result.instructions).not.toContain("dispatch");
  });
});
