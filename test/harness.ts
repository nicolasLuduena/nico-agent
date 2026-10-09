import { expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";
import { cachedPrs } from "../src/stage";
import { webHandler } from "../src/web";
import { FakeWorld } from "./fake-world";

export function setup() {
  const world = new FakeWorld();
  const configDir = join(mkdtempSync(join(tmpdir(), "nico-agent-test-")), "config");
  const bin = "~/.local/bin/nico-agent";
  const context = { world, configDir, bin };
  const cli = async (...argv: string[]) => {
    const result = await run(argv, context);
    return { ...result, json: () => JSON.parse(result.stdout) };
  };
  // As `serve` does: its runs share one PR lookup, so the app's refetches ask GitHub only every ~30s.
  const served = { ...context, prs: cachedPrs(world) };
  const handler = webHandler({ world, configDir, runCli: (argv) => run(argv, served) });
  /** An HTTP request to the web app. */
  const web = async (path: string, init?: RequestInit) => {
    const response = await handler(new Request(`http://127.0.0.1:42069${path}`, init));
    return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
  };
  return { world, configDir, cli, web, handler };
}

/** The SSE stream's reader, and the next event it sends: its name and data, or null when none comes within `ms`. */
export async function events(handler: (request: Request) => Promise<Response>) {
  const response = await handler(new Request("http://127.0.0.1:42069/api/events"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A read outlives a timeout, so the next call picks up its chunk.
  let pending: ReturnType<typeof reader.read> | null = null;
  const next = async (ms = 1000): Promise<{ event: string; data: string } | null> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const field = (name: string) => block.split("\n").find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
        // A block of comments or `retry` alone is not an event.
        if (field("data") === undefined) continue;
        return { event: field("event") ?? "message", data: field("data")! };
      }
      pending ??= reader.read();
      const read = await Promise.race([pending, Bun.sleep(ms).then(() => null)]);
      if (!read) return null;
      pending = null;
      const { value, done } = read;
      if (done) throw new Error("the stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { next, close: () => reader.cancel() };
}
