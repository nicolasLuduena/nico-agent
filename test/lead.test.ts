import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

function withConfig(config: Record<string, unknown> = {}) {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [], ...config }));
  return { ...ctx, home: join(ctx.configDir, "lead") };
}

const CLAUDE = { lead: { harness: "claude", model: "opus", effort: "high" } };

function herdrCalls(calls: string[]) {
  return calls.filter((c) => c.startsWith("herdr "));
}

describe("lead start", () => {
  test("on claude: a workspace in the Lead's home, the agent named lead with its MCP config, prompted with its skill", async () => {
    const { cli, world, home } = withConfig(CLAUDE);
    const { stdout, exitCode } = await cli("lead", "start");
    expect(stdout).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(herdrCalls(world.calls)).toEqual([
      `herdr workspace create --cwd ${home} --label lead --no-focus`,
      `herdr tab create --workspace w1 --cwd ${home} --label lead --no-focus`,
      `herdr agent start lead --kind claude --pane w1:p2 -- --model opus --effort high --mcp-config ${home}/mcp.json`,
      "herdr agent prompt lead /lead",
    ]);
    expect(JSON.parse(readFileSync(join(home, "mcp.json"), "utf8"))).toEqual({
      mcpServers: { "nico-agent": { type: "http", url: "http://127.0.0.1:42069/mcp" } },
    });
    expect(readFileSync(join(home, ".claude/skills/lead/SKILL.md"), "utf8")).toStartWith("---\nname: lead\n");
  });

  test("on codex: the MCP server in a -c override, the home trusted and its root, the skill where codex finds it", async () => {
    const { cli, world, home } = withConfig({ lead: { harness: "codex", model: "gpt-5.5", effort: "high" } });
    expect((await cli("lead", "start")).exitCode).toBe(0);
    expect(herdrCalls(world.calls)).toEqual([
      `herdr workspace create --cwd ${home} --label lead --no-focus`,
      `herdr tab create --workspace w1 --cwd ${home} --label lead --no-focus`,
      `herdr agent start lead --kind codex --pane w1:p2 -- -m gpt-5.5 -c model_reasoning_effort=high -c projects={"${home}"={trust_level="trusted"}} -c mcp_servers.nico-agent.url="http://127.0.0.1:42069/mcp" -c project_root_markers=[]`,
      "herdr agent prompt lead $lead",
    ]);
    expect(existsSync(join(home, ".agents/skills/lead/SKILL.md"))).toBe(true);
  });

  test("on opencode2: the MCP server in its config content beside the model", async () => {
    const variantFile = join(mkdtempSync(join(tmpdir(), "nico-agent-state-")), "opencode", "model.json");
    const model = "opencode-go/deepseek-v4.1-flash";
    const { cli, world, home } = withConfig({ lead: { harness: "opencode2", model, effort: "high" }, harnesses: { opencode2: { variantFile } } });
    expect((await cli("lead", "start", "--port", "8080")).exitCode).toBe(0);
    const config = JSON.stringify({
      model: `${model}#high`,
      agents: { build: { model: `${model}#high` } },
      mcp: { "nico-agent": { type: "remote", url: "http://127.0.0.1:8080/mcp" } },
    });
    expect(herdrCalls(world.calls)).toEqual([
      `herdr workspace create --cwd ${home} --label lead --no-focus`,
      `herdr tab create --workspace w1 --cwd ${home} --label lead --no-focus`,
      `herdr pane run w1:p2 env OPENCODE_CONFIG_CONTENT='${config}' opencode2 --standalone`,
      "herdr agent detect w1:p2 --timeout 30000",
      "herdr agent rename w1:p2 lead",
      "herdr agent read lead --source visible",
      "herdr agent wait lead --until idle --until done --timeout 5000",
      "herdr agent prompt lead @lead",
    ]);
    expect(existsSync(join(home, ".opencode/skills/lead/SKILL.md"))).toBe(true);
    expect(JSON.parse(readFileSync(variantFile, "utf8")).variant).toEqual({ [model]: "high" });
  });

  test("flags override the lead defaults one by one", async () => {
    const { cli, world } = withConfig(CLAUDE);
    expect((await cli("lead", "start", "--model", "sonnet")).exitCode).toBe(0);
    expect(world.calls.find((c) => c.startsWith("herdr agent start"))).toContain("--model sonnet --effort high");
  });

  test("the claude trust question for the home is answered, as for a worktree", async () => {
    const { cli, world, home } = withConfig(CLAUDE);
    world.blockAgentStart(`Do you trust the files in ${home}?\n❯ 1. No, exit\n  2. Yes, I trust this folder`);
    expect((await cli("lead", "start")).exitCode).toBe(0);
    expect(world.calls).toContain("herdr agent send-keys lead down enter");
  });
});

describe("lead start defaults", () => {
  test("no lead defaults and no flags: refused naming the config keys, before any outside-world call", async () => {
    const { cli, world, configDir } = withConfig();
    const { json, exitCode } = await cli("lead", "start", "--json");
    expect(exitCode).toBe(1);
    expect(json()).toEqual({
      error: "the Lead defaults lead.harness, lead.model, lead.effort are not set",
      help: [
        `Set "lead": {"harness": "claude", "model": "opus", "effort": "high"} (your choice) in ${join(configDir, "config.json")}`,
        "Or pass --harness, --model, --effort to `nico-agent lead start`",
      ],
    });
    expect(world.calls).toEqual([]);
  });

  test("a default missing from config can come from a flag; the rest are still named", async () => {
    const { cli } = withConfig({ lead: { harness: "claude" } });
    const { json, exitCode } = await cli("lead", "start", "--model", "opus", "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe("the Lead default lead.effort is not set");
  });

  test("a bad default is named as the config's fault", async () => {
    const { cli, configDir } = withConfig({ lead: { harness: "claude", model: "gpt", effort: "high" } });
    const { json, exitCode } = await cli("lead", "start", "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe(`lead.model in ${join(configDir, "config.json")}: unknown model \`gpt\` for claude`);
  });

  test("an unknown lead key in config is a config error", async () => {
    const { cli, configDir } = withConfig({ lead: { harness: "claude", repo: "acme/api" } });
    const { json, exitCode } = await cli("lead", "start", "--json");
    expect(exitCode).toBe(1);
    expect(json()).toEqual({ error: `${join(configDir, "config.json")}: lead.repo is not a Lead default`, help: ["Lead defaults: harness, model, effort"] });
  });
});

describe("lead start again", () => {
  test("while the Lead runs: a no-op that reports it, with no herdr changes", async () => {
    const { cli, world } = withConfig(CLAUDE);
    await cli("lead", "start");
    world.calls.length = 0;
    const { json, exitCode } = await cli("lead", "start", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toMatchObject({ lead: "already running (no-op)", workspace: "w1", agent: "lead", harness: "claude", model: "opus", effort: "high" });
    expect(herdrCalls(world.calls)).toEqual(["herdr agent list"]);
  });

  test("after a failed step: refused with how to resume, and the next run resumes from that step", async () => {
    const { cli, world, home } = withConfig(CLAUDE);
    world.failHerdr("agent start", "agent_start_failed: claude exited");
    const failed = await cli("lead", "start", "--json");
    expect(failed.exitCode).toBe(1);
    expect(failed.json()).toEqual({
      error: "the Lead failed at agent start: agent_start_failed: claude exited",
      help: ["Run `nico-agent lead status` to see the Lead", "Run `nico-agent lead start` again to resume from agent start"],
    });
    expect((await cli("lead", "status", "--json")).json()).toMatchObject({
      lead: "Failed at agent start",
      workspace: "w1",
      failure: { step: "agent start", error: "agent_start_failed: claude exited" },
    });

    world.clearFailures();
    world.calls.length = 0;
    const resumed = await cli("lead", "start", "--json");
    expect(resumed.exitCode).toBe(0);
    expect(resumed.json().lead).toBe("resumed from agent start");
    expect(herdrCalls(world.calls)).toEqual([
      `herdr agent start lead --kind claude --pane w1:p2 -- --model opus --effort high --mcp-config ${home}/mcp.json`,
      "herdr agent prompt lead /lead",
    ]);
    expect((await cli("lead", "status", "--json")).json().lead).toBe("running");
  });

  test("on another Harness: stops the old Lead and starts the new one", async () => {
    const { cli, world, home } = withConfig(CLAUDE);
    await cli("lead", "start");
    world.calls.length = 0;
    const { json, exitCode } = await cli("lead", "start", "--harness", "codex", "--model", "gpt-5.5", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toMatchObject({ lead: "restarted, replacing claude opus high", workspace: "w2", harness: "codex", model: "gpt-5.5", effort: "high" });
    expect(herdrCalls(world.calls).slice(0, 2)).toEqual(["herdr workspace close w1", `herdr workspace create --cwd ${home} --label lead --no-focus`]);
    expect(existsSync(join(home, ".agents/skills/lead/SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude/skills"))).toBe(false);
  });

  test("whose agent is gone from herdr: starts it afresh", async () => {
    const { cli, world } = withConfig(CLAUDE);
    await cli("lead", "start");
    world.agentStates.delete("lead");
    expect((await cli("lead", "status", "--json")).json()).toMatchObject({ lead: "gone from herdr", state: "unknown" });
    const { json } = await cli("lead", "start", "--json");
    expect(json()).toMatchObject({ lead: "restarted, replacing claude opus high", workspace: "w2" });
  });
});

describe("lead status and stop", () => {
  test("status shows the workspace, Harness, model, Effort and Agent state", async () => {
    const { cli, world, home } = withConfig(CLAUDE);
    expect((await cli("lead", "status", "--json")).json()).toEqual({ lead: "not running", help: [expect.stringContaining("nico-agent lead start")] });
    await cli("lead", "start");
    world.agentStates.set("lead", "working");
    const { json, exitCode } = await cli("lead", "status", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toMatchObject({
      lead: "running",
      workspace: "w1",
      agent: "lead",
      harness: "claude",
      model: "opus",
      effort: "high",
      state: "working",
      home,
      mcp: "http://127.0.0.1:42069/mcp",
    });
  });

  test("stop closes the workspace and forgets the Lead, keeping its home and the conversation", async () => {
    const { cli, world, home } = withConfig(CLAUDE);
    await cli("lead", "start");
    expect((await cli("say", "keep this")).exitCode).toBe(0);
    world.calls.length = 0;
    const { json, exitCode } = await cli("lead", "stop", "--json");
    expect(exitCode).toBe(0);
    expect(json()).toMatchObject({ lead: "stopped", workspace: "w1" });
    expect(herdrCalls(world.calls)).toEqual(["herdr workspace close w1"]);
    expect((await cli("lead", "status", "--json")).json().lead).toBe("not running");
    expect(existsSync(join(home, "mcp.json"))).toBe(true);
    expect((await cli("lead", "log")).stdout).toContain("keep this");
    expect((await cli("lead", "stop", "--json")).json().lead).toBe("not running (no-op)");
  });
});

describe("the Lead's home", () => {
  /** A nico-agent checkout with the shaping skills but `triage`. */
  function checkout() {
    const path = mkdtempSync(join(tmpdir(), "nico-agent-clone-"));
    for (const name of ["grilling", "to-spec", "to-tickets", "retro"]) {
      mkdirSync(join(path, ".agents/skills", name), { recursive: true });
      writeFileSync(join(path, ".agents/skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
    }
    return path;
  }

  test("links the shaping skills from the nico-agent checkout beside the lead skill, warning for a missing one", async () => {
    const path = checkout();
    const { cli, home } = withConfig({ ...CLAUDE, repos: [{ slug: "nicolasLuduena/nico-agent", path }] });
    const { json } = await cli("lead", "start", "--json");
    expect(json().warnings).toEqual([`the shaping skill triage is left out: ${join(path, ".agents/skills/triage")} does not exist`]);
    for (const name of ["grilling", "to-spec", "to-tickets", "retro"]) {
      const link = join(home, ".claude/skills", name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(join(path, ".agents/skills", name));
    }
    expect(existsSync(join(home, ".claude/skills/triage"))).toBe(false);
  });

  test("without the nico-agent checkout as a Repo: no shaping skills, with a warning and how to add it", async () => {
    const { cli, home } = withConfig(CLAUDE);
    const { json, exitCode } = await cli("lead", "start", "--json");
    expect(exitCode).toBe(0);
    expect(json().warnings).toEqual(["the shaping skills (grilling, to-spec, to-tickets, triage, retro) are left out: nicolasLuduena/nico-agent is not a configured Repo"]);
    expect(json().help).toContain("Run `nico-agent repo add nicolasLuduena/nico-agent --path <clone>` to give the Lead the shaping skills");
    expect(existsSync(join(home, ".claude/skills/lead/SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude/skills/grilling"))).toBe(false);
  });

  test("a new Harness without mcpArgs is refused before anything is created", async () => {
    const { cli, world } = withConfig({
      lead: { harness: "gemini", model: "pro", effort: "default" },
      harnesses: { gemini: { launchMode: "herdr-kind", kind: "gemini", sigil: "/", modelArgs: ["-m", "{model}"], effortArgs: [], models: ["pro"], efforts: ["default"] } },
    });
    const { json, exitCode } = await cli("lead", "start", "--json");
    expect(exitCode).toBe(1);
    expect(json().error).toBe("gemini has no mcpArgs to connect the Lead to nico-agent's MCP server");
    expect(herdrCalls(world.calls)).toEqual([]);
  });
});

describe("the lead skill", () => {
  /** The skill `lead start` wrote into the Lead's home. */
  async function writtenSkill() {
    const ctx = withConfig(CLAUDE);
    expect((await ctx.cli("lead", "start")).exitCode).toBe(0);
    return { ...ctx, skill: readFileSync(join(ctx.home, ".claude/skills/lead/SKILL.md"), "utf8") };
  }

  test("its Tools section names exactly the tools the MCP server offers", async () => {
    const { web, skill } = await writtenSkill();
    const reply = await web("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const offered = JSON.parse(reply.body).result.tools.map((t: { name: string }) => t.name);
    const section = skill.split(/^## /m).find((s) => s.startsWith("Tools\n"));
    expect(section).toBeDefined();
    const named = [...section!.matchAll(/^- `([a-z]+)`/gm)].map((m) => m[1]);
    expect(named).toEqual(offered);
  });

  test("outside its Tools section, it names no shell command for something a tool does", async () => {
    const { skill } = await writtenSkill();
    const sections = skill.split(/^## /m);
    const tools = sections.find((s) => s.startsWith("Tools\n"));
    expect(tools).toBeDefined();
    // Each tool's shell twin, as the Tools section names it: `- \`say\` (\`nico-agent lead say <text>\`)`.
    const twins = [...tools!.matchAll(/^- `[a-z]+` \(`nico-agent ([a-z]+(?: [a-z]+)*)/gm)].map((m) => m[1]!);
    expect(twins).toContain("answer");
    const rest = sections.filter((s) => s !== tools).join("\n");
    const named = [...rest.matchAll(/`nico-agent ([a-z]+(?: [a-z]+)*)/g)].map((m) => m[1]!);
    expect(named.filter((command) => twins.some((twin) => command === twin || command.startsWith(`${twin} `)))).toEqual([]);
    // herdr's writes are what dispatch, review, close and answer do.
    expect(rest.match(/`herdr (?:agent (?:send|send-keys|prompt|start)|workspace (?:create|close))\b[^`]*`/g)).toBeNull();
  });

  test("every nico-agent command it names is a real command", async () => {
    const { cli, skill } = await writtenSkill();
    // The command's name: its words up to the first placeholder, flag or argument.
    const name = (line: string) => line.match(/^[a-z]+(?: [a-z]+)*(?= |$)/)![0];
    const commands = new Set([...skill.matchAll(/`nico-agent ([^`]*)`/g)].map((m) => name(m[1]!)));
    expect(commands.size).toBeGreaterThan(0);
    for (const command of commands) {
      const { exitCode } = await cli(...command.split(" "), "--help");
      expect({ command, exitCode }).toEqual({ command, exitCode: 0 });
    }
  });
});
