import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "bun:test";
import { run } from "../src/cli";
import { mcpHandler } from "../src/mcp";
import { webHandler } from "../src/web";
import { FakeWorld } from "./fake-world";

export function setup() {
  const world = new FakeWorld();
  const configDir = join(mkdtempSync(join(tmpdir(), "nico-agent-test-")), "config");
  const bin = "~/.local/bin/nico-agent";
  const cli = async (...argv: string[]) => {
    const result = await run(argv, { world, configDir, bin });
    return { ...result, json: () => JSON.parse(result.stdout) };
  };
  const handler = webHandler({ world, configDir });
  /** An HTTP request to the web app. */
  const web = async (path: string, init?: RequestInit) => {
    const response = await handler(new Request(`http://127.0.0.1:42069${path}`, init));
    return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
  };
  const answer = mcpHandler((argv) => run(argv, { world, configDir, bin }));
  /**
   * One line on the MCP server's stdin: a JSON-RPC message (or a raw string).
   * Returns its reply line parsed, or null when there is none.
   */
  const mcp = async (message: unknown) => {
    const reply = await answer(typeof message === "string" ? message : JSON.stringify(message));
    if (reply === null) return null;
    expect(reply).not.toContain("\n");
    return JSON.parse(reply);
  };
  return { world, configDir, cli, web, mcp };
}
