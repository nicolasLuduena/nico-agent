import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { events, setup } from "./harness";

const CLAUDE = { lead: { harness: "claude", model: "opus", effort: "high" } };

function withLead() {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  const configure = (config = {}) => writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], ...CLAUDE, ...config }));
  configure();
  const post = (path: string, args: string[]) => ctx.web(path, { method: "POST", body: JSON.stringify({ args }) });
  return { ...ctx, post, configure };
}

describe("the Lead panel's reads", () => {
  test("/api/lead/log is the conversation in the `lead log --json` shape", async () => {
    const { cli, web } = withLead();
    await cli("say", "Finish billing first");
    await cli("lead", "ask", "Close acme/api#7?", "yes", "no");

    const { status, body } = await web("/api/lead/log");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual((await cli("lead", "log", "--json")).json());
    expect(JSON.parse(body).entries).toMatchObject([
      { id: 1, who: "user", type: "user", text: "Finish billing first" },
      { id: 2, who: "lead", type: "ask", text: "Close acme/api#7?", choices: ["yes", "no"] },
    ]);
  });

  test("/api/proposals lists decided Proposals too, as `proposals --all --json`", async () => {
    const { cli, web } = withLead();
    await cli("lead", "propose", "--reason", "It is next in the Queue", "advance");
    await cli("lead", "propose", "--reason", "Not now", "advance");
    await cli("proposals", "decline", "2", "Wait");

    const { status, body } = await web("/api/proposals");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual((await cli("proposals", "--all", "--json")).json());
    expect(JSON.parse(body).proposals).toMatchObject([
      { id: 1, action: "nico-agent advance", status: "open" },
      { id: 2, status: "declined", declineReason: "Wait" },
    ]);
  });

  test("/api/lead/status is the Lead as `lead status --json`, running or not", async () => {
    const { cli, web } = withLead();
    expect(JSON.parse((await web("/api/lead/status")).body)).toMatchObject({ lead: "not running" });
    expect((await cli("lead", "start")).exitCode).toBe(0);

    const { status, body } = await web("/api/lead/status");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ lead: "running", harness: "claude", model: "opus", effort: "high", state: "working" });
  });
});

describe("the Lead panel's actions", () => {
  test("/api/say writes to the Lead, and answers its question with --answer", async () => {
    const { cli, post } = withLead();
    await cli("lead", "ask", "Which first?", "billing", "search");

    const said = await post("/api/say", ["--", "--force is fine"]);
    expect(said.status).toBe(200);
    expect(JSON.parse(said.body)).toMatchObject({ said: 2 });
    const answered = await post("/api/say", ["--answer", "1", "--", "billing"]);
    expect(JSON.parse(answered.body)).toMatchObject({ answered: 1, id: 3 });

    expect((await cli("lead", "log", "--json")).json().entries).toMatchObject([
      { type: "ask" },
      { type: "user", text: "--force is fine" },
      { type: "answer", question: 1, text: "billing" },
    ]);
  });

  test("/api/say refuses an answer to a question already answered, with the CLI's help", async () => {
    const { cli, post } = withLead();
    await cli("lead", "ask", "Which first?");
    await post("/api/say", ["--answer", "1", "--", "billing"]);

    const { status, body } = await post("/api/say", ["--answer", "1", "--", "search"]);
    expect(status).toBe(422);
    expect(JSON.parse(body)).toMatchObject({ error: "question 1 was already answered", help: ["Run `nico-agent lead log` to see the Lead's questions (none is open)"] });
  });

  test("/api/proposals/approve runs the action and answers its outcome; decline takes a reason", async () => {
    const { cli, post, configure } = withLead();
    for (const reason of ["Next in the Queue", "Again", "Not now"]) await cli("lead", "propose", "--reason", reason, "advance");

    // No Scheduler defaults yet: the action cannot run, and the Proposal is closed as failed.
    const failed = await post("/api/proposals/approve", ["1"]);
    expect(failed.status).toBe(422);
    expect(JSON.parse(failed.body)).toMatchObject({ proposal: 1, outcome: { error: expect.stringContaining("scheduler.harness") } });
    configure({ scheduler: CLAUDE.lead });
    const approved = await post("/api/proposals/approve", ["2"]);
    expect(approved.status).toBe(200);
    expect(JSON.parse(approved.body)).toMatchObject({ approved: 2, action: "nico-agent advance" });
    const declined = await post("/api/proposals/decline", ["3", "--", "Finish billing first"]);
    expect(JSON.parse(declined.body)).toMatchObject({ declined: 3 });

    expect((await cli("proposals", "--all", "--json")).json().proposals).toMatchObject([
      { id: 1, status: "failed" },
      { id: 2, status: "approved" },
      { id: 3, status: "declined", declineReason: "Finish billing first" },
    ]);
  });

  test("/api/lead/start starts the Lead on the posted Harness, and /api/lead/stop stops it", async () => {
    const { cli, post } = withLead();
    const started = await post("/api/lead/start", ["--harness", "claude", "--model", "sonnet", "--effort", "low", "--port", "8080"]);
    expect(started.status).toBe(200);
    expect(JSON.parse(started.body)).toMatchObject({ lead: "started", model: "sonnet", effort: "low", mcp: "http://127.0.0.1:8080/mcp" });

    const stopped = await post("/api/lead/stop", []);
    expect(JSON.parse(stopped.body)).toMatchObject({ lead: "stopped" });
    expect((await cli("lead", "status", "--json")).json()).toMatchObject({ lead: "not running" });
  });
});

/** The events the stream sends until it goes quiet. */
async function drain(stream: Awaited<ReturnType<typeof events>>) {
  const names: string[] = [];
  for (let next = await stream.next(); next; next = await stream.next(50)) names.push(next.event);
  return names;
}

describe("/api/events for the Lead panel", () => {
  test("the Lead's `say` through MCP sends conversation-entry", async () => {
    const { handler, web } = withLead();
    const stream = await events(handler);
    const rpc = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "say", arguments: { text: "Two Specs are running" } } };
    expect((await web("/mcp", { method: "POST", body: JSON.stringify(rpc) })).status).toBe(200);
    expect(await drain(stream)).toEqual(["board-changed", "conversation-entry"]);
    await stream.close();
  });

  test("the Lead reading its Inbox changes nothing the panel shows", async () => {
    const { cli, handler, web, look } = withLead();
    await cli("say", "Hello");
    await look();
    const stream = await events(handler);
    const rpc = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "inbox", arguments: {} } };
    expect((await web("/mcp", { method: "POST", body: JSON.stringify(rpc) })).status).toBe(200);
    expect(await drain(stream)).toEqual(["board-changed"]);
    await stream.close();
  });

  test("a message posted to /api/say sends conversation-entry", async () => {
    const { handler, post } = withLead();
    const stream = await events(handler);
    await post("/api/say", ["--", "Hello"]);
    expect(await drain(stream)).toEqual(["board-changed", "conversation-entry"]);
    await stream.close();
  });

  test("a decided Proposal sends proposal-changed and conversation-entry, for its decision", async () => {
    const { cli, handler, post, look } = withLead();
    await cli("lead", "propose", "--reason", "Not now", "advance");
    await look();
    const stream = await events(handler);
    await post("/api/proposals/decline", ["1"]);
    expect(await drain(stream)).toEqual(["board-changed", "conversation-entry", "proposal-changed"]);
    await stream.close();
  });

  test("starting and stopping the Lead sends lead-state", async () => {
    const { handler, post } = withLead();
    const stream = await events(handler);
    await post("/api/lead/start", []);
    expect(await drain(stream)).toEqual(["board-changed", "lead-state"]);
    await post("/api/lead/stop", []);
    expect(await drain(stream)).toEqual(["board-changed", "lead-state"]);
    await stream.close();
  });

  test("a Board action that leaves the Lead alone sends only board-changed", async () => {
    const { cli, handler, post, look } = withLead();
    await cli("lead", "start");
    await look();
    const stream = await events(handler);
    await post("/api/harness/refresh", []);
    expect(await drain(stream)).toEqual(["board-changed"]);
    await stream.close();
  });

  test("changes made outside serve reach the stream when serve looks again, as on its tick", async () => {
    const { cli, handler, look, world } = withLead();
    const stream = await events(handler);
    await cli("lead", "start");
    await cli("lead", "propose", "--reason", "Next", "advance");
    await cli("say", "Hello");
    await look();
    expect(await drain(stream)).toEqual(["conversation-entry", "proposal-changed", "lead-state"]);
    // The Lead's Agent state changes in herdr, outside nico-agent.
    world.agentStates.set("lead", "idle");
    await look();
    expect(await drain(stream)).toEqual(["lead-state"]);
    await look();
    expect(await stream.next(50)).toBeNull();
    await stream.close();
  });
});
