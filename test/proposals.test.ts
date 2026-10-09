import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { run } from "../src/cli";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const DISPATCH = ["dispatch", ...FLAGS, "--", "acme/api#7"];

type Ctx = ReturnType<typeof setup>;

/** A tool call POSTed to /mcp, answering its result. */
async function call(web: Ctx["web"], name: string, args: Record<string, unknown> = {}) {
  const response = await web("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return JSON.parse(response.body).result as { structuredContent: Record<string, unknown>; isError: boolean };
}

/** acme/api with acme/api#7 Ready, the Scheduler defaults and every Standing order off. */
async function board() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addIssue("acme/api", { number: 7 });
  const file = join(ctx.configDir, "config.json");
  const off = { start: false, answer: false, review: false, close: false, write: false };
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), scheduler: { harness: "claude", model: "opus", effort: "high" }, orders: off }));
  ctx.world.calls.length = 0;
  return ctx;
}

/** The Lead proposes `action`, answering the Proposal's id. */
async function propose(web: Ctx["web"], action: string[], reason = "acme/api#7 is the smallest Ready issue") {
  const result = await call(web, "propose", { action, reason });
  expect(result.isError).toBe(false);
  return result.structuredContent.proposed as number;
}

describe("the Lead proposes, the user decides", () => {
  test("propose then proposals lists it, with what it would do and why, touching nothing", async () => {
    const { web, cli, world } = await board();
    const id = await propose(web, DISPATCH);
    expect(world.calls.filter((c) => !c.startsWith("notify"))).toEqual([]);

    const listed = await cli("proposals", "--json");
    expect(listed.exitCode).toBe(0);
    expect(listed.json().open).toEqual([{
      id,
      at: world.now().toISOString(),
      action: "nico-agent dispatch --harness claude --model opus --effort high -- acme/api#7",
      reason: "acme/api#7 is the smallest Ready issue",
    }]);
    expect(listed.json().help).toContain(`Run \`nico-agent proposals approve ${id}\` to run one, or \`nico-agent proposals decline ${id} [reason]\` to turn it down`);
  });

  test("approve runs the action with the same World calls as the CLI command, and marks it approved with the outcome", async () => {
    const lead = await board();
    const user = await board();
    const id = await propose(lead.web, DISPATCH);
    lead.world.calls.length = 0;

    const approved = await lead.cli("proposals", "approve", String(id), "--json");
    const ran = await user.cli(...DISPATCH.slice(0, -2), "acme/api#7", "--json");
    expect(approved.exitCode).toBe(0);
    expect(lead.world.calls).toEqual(user.world.calls);
    const { help: _, ...outcome } = ran.json();
    expect(approved.json()).toMatchObject({ approved: id, outcome });

    expect((await lead.cli("proposals", "--json")).json().open).toEqual([]);
    const all = (await lead.cli("proposals", "--all", "--json")).json().proposals;
    expect(all).toMatchObject([{ id, status: "approved", outcome }]);
  });

  test("decline with a reason writes a decision the Lead's inbox returns, with the reason", async () => {
    const { web, cli, world } = await board();
    const id = await propose(web, DISPATCH);
    await call(web, "inbox");
    world.calls.length = 0;

    const declined = await cli("proposals", "decline", String(id), "Finish", "billing", "first", "--json");
    expect(declined.exitCode).toBe(0);
    expect(declined.json()).toMatchObject({ declined: id, action: "nico-agent dispatch --harness claude --model opus --effort high -- acme/api#7" });
    expect(world.calls).toEqual([]);

    const inbox = (await call(web, "inbox")).structuredContent.entries;
    expect(inbox).toEqual([{ id: expect.any(Number), at: world.now().toISOString(), type: "decision", proposal: id, decision: "declined", action: DISPATCH, text: "Finish billing first" }]);
    expect((await cli("proposals", "--all", "--json")).json().proposals).toMatchObject([{ id, status: "declined", declineReason: "Finish billing first" }]);
  });

  test("an approval and its outcome reach the Lead's inbox", async () => {
    const { web, cli } = await board();
    const id = await propose(web, DISPATCH);
    await call(web, "inbox");
    await cli("proposals", "approve", String(id));

    const [decision] = (await call(web, "inbox")).structuredContent.entries as Record<string, unknown>[];
    expect(decision).toMatchObject({ type: "decision", proposal: id, decision: "approved", action: DISPATCH, text: "", outcome: { dispatched: "acme/api#7" } });
  });

  test("approving a dispatch of an issue already In flight is refused with the reason and closes it as failed", async () => {
    const { web, cli, world } = await board();
    const id = await propose(web, DISPATCH);
    await cli(...DISPATCH);
    world.calls.length = 0;

    const approved = await cli("proposals", "approve", String(id), "--json");
    expect(approved.exitCode).toBe(1);
    expect(approved.json().error).toBe(`Proposal ${id} is no longer possible, so it was closed as failed: nothing left to do: acme/api#7 already In flight (no-op)`);
    expect(world.calls.filter((c) => c.startsWith("herdr worktree create"))).toEqual([]);
    expect((await cli("proposals", "--all", "--json")).json().proposals).toMatchObject([{ id, status: "failed" }]);
    expect((await call(web, "inbox")).structuredContent.entries).toMatchObject([{ type: "decision", proposal: id, decision: "failed" }]);
  });

  test("an approved action on several issues is approved if any ran, and failed with each issue's reason if none did", async () => {
    const { web, cli, world } = await board();
    world.addIssue("acme/api", { number: 8 });
    const both = ["dispatch", ...FLAGS, "--", "acme/api#7", "acme/api#8"];
    const partly = await propose(web, both);
    const neither = await propose(web, both);
    await cli(...DISPATCH);

    const approved = await cli("proposals", "approve", String(partly), "--json");
    expect(approved.exitCode).toBe(0);
    expect(approved.json()).toMatchObject({ approved: partly, outcome: { dispatched: "2 of 2 issues" } });

    const failed = await cli("proposals", "approve", String(neither), "--json");
    expect(failed.exitCode).toBe(1);
    expect(failed.json().error).toBe(`Proposal ${neither} is no longer possible, so it was closed as failed: `
      + "nothing left to do: acme/api#7: already In flight (no-op); acme/api#8: already In flight (no-op)");
    expect((await cli("proposals", "--all", "--json")).json().proposals.map((p: { status: string }) => p.status)).toEqual(["approved", "failed"]);
  });

  test("approving an answer to an Implementer no longer Asking is refused with the reason and closes it as failed", async () => {
    const { web, cli, world } = await board();
    await cli(...DISPATCH);
    world.linkPr("acme/api", 7, { number: 9 });
    world.agentStates.set("impl-api-7", "blocked");
    const id = await propose(web, ["answer", "--", "acme/api#7", "Use option 2"]);
    world.agentStates.set("impl-api-7", "working");
    world.calls.length = 0;

    const approved = await cli("proposals", "approve", String(id), "--json");
    expect(approved.exitCode).toBe(1);
    expect(approved.json().error).toBe(`Proposal ${id} is no longer possible, so it was closed as failed: acme/api#7's Implementer is not waiting on the user (it is working)`);
    expect(approved.json().help).toContain("Run `herdr agent read impl-api-7` to see what it is doing");
    expect(world.calls.some((c) => c.startsWith("herdr agent prompt"))).toBe(false);
    expect((await cli("proposals", "--all", "--json")).json().proposals).toMatchObject([{ id, status: "failed" }]);
  });

  test("approving or declining twice is refused with help, and so is an unknown id", async () => {
    const { web, cli, world } = await board();
    const approved = await propose(web, DISPATCH);
    const declined = await propose(web, ["advance"], "Keep the Specs moving");
    const open = await propose(web, ["advance"], "Again");
    await cli("proposals", "approve", String(approved));
    await cli("proposals", "decline", String(declined));
    world.calls.length = 0;

    for (const [verb, id, error] of [
      ["approve", approved, `Proposal ${approved} was already approved`],
      ["decline", approved, `Proposal ${approved} was already approved`],
      ["approve", declined, `Proposal ${declined} was already declined`],
      ["decline", declined, `Proposal ${declined} was already declined`],
      ["approve", 99, "no Proposal has id 99"],
      ["decline", 99, "no Proposal has id 99"],
    ] as const) {
      const refused = await cli("proposals", verb, String(id), "--json");
      expect(refused.exitCode).toBe(1);
      expect(refused.json()).toEqual({ error, help: [`Run \`nico-agent proposals --all\` to see every Proposal (the open ones are ${open})`] });
    }
    expect(world.calls).toEqual([]);
  });

  test("a new Proposal notifies the desktop once, and the next one only itself", async () => {
    const { web, cli, world } = await board();
    const first = await propose(web, DISPATCH);
    expect(world.notifications).toEqual([{
      title: "The Lead proposes: nico-agent dispatch --harness claude --model opus --effort high -- acme/api#7",
      body: `acme/api#7 is the smallest Ready issue\nRun \`nico-agent proposals approve ${first}\` to run it, or \`nico-agent proposals decline ${first} [reason]\``,
    }]);
    await cli("advance");
    const second = await propose(web, ["advance"], "Keep the Specs moving");
    expect(world.notifications.map((n) => n.title)).toEqual([
      "The Lead proposes: nico-agent dispatch --harness claude --model opus --effort high -- acme/api#7",
      "The Lead proposes: nico-agent advance",
    ]);
    expect(second).toBe(first + 1);
  });

  test("a Proposal notice leaves advance's notices alone, so they are not repeated", async () => {
    const { web, cli, world } = await board();
    await cli(...DISPATCH);
    world.agentStates.set("impl-api-7", "blocked");
    await cli("advance");
    expect(world.notifications.map((n) => n.title)).toEqual(["acme/api#7 is Asking"]);
    await propose(web, ["advance"]);
    await cli("advance");
    expect(world.notifications.map((n) => n.title)).toEqual(["acme/api#7 is Asking", "The Lead proposes: nico-agent advance"]);
  });

  test("propose refuses a command no action tool runs, or one that cannot run as typed, recording nothing", async () => {
    const { web, cli, world } = await board();
    for (const [action, error] of [
      [["orders", "set", "start", "on"], "`orders` is not an action a Proposal can run"],
      [["proposals", "approve", "1"], "`proposals` is not an action a Proposal can run"],
      [["dispatch", "--harness"], "the action is not a valid `dispatch` command: --harness needs a value"],
      [["close", "--force", "--", "acme/api#7"], "the action is not a valid `close` command: unknown flag --force for `close`"],
      [["advance", "--help"], "the action is not a valid `advance` command: --help shows help; it is not an action"],
    ] as const) {
      const result = await call(web, "propose", { action, reason: "why not" });
      expect(result.isError).toBe(true);
      expect(result.structuredContent.error).toBe(error);
    }
    expect((await cli("proposals", "--json")).json().open).toEqual([]);
    expect(world.notifications).toEqual([]);
  });

  test("the orient packet carries the open Proposals, so a restarted Lead knows what waits on the user", async () => {
    const { web, cli, world } = await board();
    const decided = await propose(web, ["advance"], "Keep the Specs moving");
    const open = await propose(web, DISPATCH);
    await cli("proposals", "decline", String(decided));

    const { orient } = (await call(web, "inbox")).structuredContent as { orient: { proposals: unknown } };
    expect(orient.proposals).toEqual([{ id: open, at: world.now().toISOString(), action: DISPATCH, reason: "acme/api#7 is the smallest Ready issue", status: "open" }]);
  });

  test("the CLI proposes as the Lead's tool does", async () => {
    const { cli } = await board();
    const proposed = await cli("lead", "propose", "--reason", "Smallest unblocked issue", "--json", "--", ...DISPATCH);
    expect(proposed.exitCode).toBe(0);
    expect(proposed.json()).toMatchObject({ proposed: 1, action: "nico-agent dispatch --harness claude --model opus --effort high -- acme/api#7" });
  });
});

/** The Lead proposes writing SPEC to acme/api's Source, answering the Proposal's id. */
async function proposeWrite(web: Ctx["web"]) {
  const result = await call(web, "propose", { write: { repo: "acme/api", text: SPEC }, reason: "We agreed on billing" });
  expect(result.isError).toBe(false);
  return result.structuredContent.proposed as number;
}

const SPEC = "# Spec: billing\n\n## Tickets\n\n1. Invoice model\n2. Stripe webhook, blocked by 1\n";

describe("the Lead proposes writing a Spec, the user decides", () => {
  test("propose with write lists the text to write and its Repo, touching nothing", async () => {
    const { web, cli, world } = await board();
    const result = await call(web, "propose", { write: { repo: "acme/api", text: SPEC }, reason: "We agreed on billing; the write order is off" });
    expect(result.isError).toBe(false);
    const id = result.structuredContent.proposed as number;
    expect(result.structuredContent.write).toBe("acme/api");
    expect(world.calls.filter((c) => !c.startsWith("notify"))).toEqual([]);

    expect((await cli("proposals", "--json")).json().open).toEqual([{
      id,
      at: world.now().toISOString(),
      write: { repo: "acme/api", text: SPEC },
      reason: "We agreed on billing; the write order is off",
    }]);
    expect(world.notifications).toEqual([{
      title: "The Lead proposes to write a Spec to acme/api's Source",
      body: `We agreed on billing; the write order is off\nRun \`nico-agent proposals\` to read it, then \`nico-agent proposals approve ${id}\` to have the Lead write it, or \`nico-agent proposals decline ${id} [reason]\``,
    }]);
  });

  test("approving runs nothing in nico-agent and hands the write to the Lead's inbox, which is Nudged", async () => {
    const { web, cli, world } = await board();
    const id = await proposeWrite(web);
    await call(web, "inbox");
    world.calls.length = 0;

    const approved = await cli("proposals", "approve", String(id), "--json");
    expect(approved.exitCode).toBe(0);
    expect(approved.json()).toMatchObject({ approved: id, write: "acme/api" });
    expect(approved.json().help).toContain("The Lead writes it to acme/api's Source when it reads its Inbox");
    expect(world.calls.filter((c) => !c.startsWith("herdr agent"))).toEqual([]);

    const inbox = (await call(web, "inbox")).structuredContent.entries;
    expect(inbox).toEqual([{ id: expect.any(Number), at: world.now().toISOString(), type: "decision", proposal: id, decision: "approved", write: { repo: "acme/api", text: SPEC }, text: "" }]);
    expect((await cli("proposals", "--all", "--json")).json().proposals).toEqual([{
      id, at: world.now().toISOString(), reason: "We agreed on billing", status: "approved", decidedAt: world.now().toISOString(), write: { repo: "acme/api", text: SPEC },
    }]);
  });

  test("declining writes nothing and tells the Lead why", async () => {
    const { web, cli, world } = await board();
    const id = await proposeWrite(web);
    await call(web, "inbox");
    world.calls.length = 0;

    const declined = await cli("proposals", "decline", String(id), "Split the webhook out", "--json");
    expect(declined.exitCode).toBe(0);
    expect(declined.json()).toMatchObject({ declined: id, write: "acme/api" });
    expect(world.calls.filter((c) => !c.startsWith("herdr agent"))).toEqual([]);
    expect((await call(web, "inbox")).structuredContent.entries).toMatchObject([
      { type: "decision", proposal: id, decision: "declined", write: { repo: "acme/api", text: SPEC }, text: "Split the webhook out" },
    ]);
  });

  test("propose refuses a write to a Repo not configured, a blank one, or one beside an action, recording nothing", async () => {
    const { web, cli, world } = await board();
    for (const [args, error] of [
      [{ write: { repo: "acme/web", text: SPEC } }, "acme/web is not a configured Repo"],
      [{ write: { repo: "acme/api", text: "  \n" } }, "propose's write needs text, a non-empty string"],
      [{ write: { repo: "acme/api" } }, "propose's write needs text, a non-empty string"],
      [{ write: { repo: "acme/api", text: SPEC, title: "x" } }, "propose's write takes repo and text (got title)"],
      [{ write: { repo: "acme/api", text: SPEC }, action: ["advance"] }, "propose takes action or write, exactly one"],
      [{}, "propose takes action or write, exactly one"],
    ] as const) {
      const response = await web("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "propose", arguments: { ...args, reason: "why not" } } }),
      });
      const reply = JSON.parse(response.body);
      // A bad argument is the protocol's error; a Repo not configured is the CLI's refusal.
      expect(reply.error?.message ?? reply.result.structuredContent.error).toBe(error);
    }
    expect((await cli("proposals", "--json")).json().open).toEqual([]);
    expect(world.notifications).toEqual([]);
  });

  test("the CLI proposes a write from a file, --text or standard input, as the Lead's tool does", async () => {
    const { cli, configDir, world } = await board();
    const file = join(configDir, "spec.md");
    writeFileSync(file, SPEC);
    for (const flags of [["--file", file], ["--text", SPEC]]) {
      const proposed = await cli("lead", "propose", "--reason", "We agreed on billing", "--write", "acme/api", ...flags, "--json");
      expect(proposed.exitCode).toBe(0);
      expect(proposed.json()).toMatchObject({ write: "acme/api" });
    }
    const piped = await run(["lead", "propose", "--reason", "We agreed on billing", "--write", "acme/api"], { world, configDir, bin: "nico-agent", stdin: async () => SPEC });
    expect(piped.exitCode).toBe(0);
    const open = (await cli("proposals", "--json")).json().open as { write: unknown }[];
    expect(open.map((p) => p.write)).toEqual(Array(3).fill({ repo: "acme/api", text: SPEC }));

    const both = await cli("lead", "propose", "--reason", "x", "--write", "acme/api", "--text", SPEC, "--json", "--", "advance");
    expect(both.exitCode).toBe(2);
    expect(both.json().error).toBe("a Proposal runs a command or writes a Spec, not both");
    const stray = await cli("lead", "propose", "--reason", "x", "--text", SPEC, "--json", "--", "advance");
    expect(stray.json().error).toBe("--file and --text go with --write");
  });
});
