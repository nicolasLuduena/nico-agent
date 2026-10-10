import { expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";
import { cachedPrs } from "../src/stage";
import { Events } from "../src/events";
import { lookAtLead, webHandler, webSockets } from "../src/web";
import type { SocketHandler } from "../src/world";
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
  // The web app's runs share one PR lookup, so its refetches ask GitHub only every ~30s.
  // `serve` itself caches all its GitHub reads instead (test/serve.test.ts).
  const served = { ...context, prs: cachedPrs(world) };
  const events = new Events();
  /** What `serve` does on its tick: look at the conversation, the Proposals and the Lead again. */
  const look = lookAtLead(context, events);
  const handler = webHandler({ world, configDir, runCli: (argv) => run(argv, served), events, look });
  /** An HTTP request to the web app. */
  const web = async (path: string, init?: RequestInit) => {
    const response = await handler(new Request(`http://127.0.0.1:42069${path}`, init));
    return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
  };
  const startSockets = () => webSockets({ world, configDir, runCli: (argv) => run(argv, served), events });
  let sockets = startSockets();
  /** Start `serve`'s sockets afresh on the same config directory, as a restart does. */
  const restart = () => {
    sockets = startSockets();
  };
  /** A WebSocket to the web app, as a page on `origin` opens it: its refusal, or the session. */
  const socket = (path: string, headers: Record<string, string> = {}) => openSocket(sockets[path], new Request(`http://127.0.0.1:42069${path}`, { headers: { upgrade: "websocket", ...headers } }));
  return { world, configDir, cli, web, handler, look, socket, restart, events };
}

/**
 * A WebSocket opened on `handler` as `serve` would: `refused` when it answered
 * with a response; else what the server sent so far, text parsed as JSON and
 * binary as bytes, and the next one.
 */
async function openSocket(handler: SocketHandler | undefined, request: Request) {
  const answer = handler ? handler(request) : new Response("No socket\n", { status: 404 });
  if (answer instanceof Response) return { refused: { status: answer.status, body: await answer.text() } } as const;
  const received: any[] = [];
  let closed = false;
  const session = answer({ send: (message) => received.push(typeof message === "string" ? JSON.parse(message) : message), close: () => { closed = true; } });
  let read = 0;
  return {
    received,
    closed: () => closed,
    send: (data: string | Uint8Array) => session.message(data),
    json: (message: unknown) => session.message(JSON.stringify(message)),
    close: () => session.close(),
    /** The next message the server sends, or null when none comes within `ms`. */
    async next(ms = 1000): Promise<any> {
      for (const until = Date.now() + ms; received.length <= read && Date.now() < until;) await Bun.sleep(1);
      return received.length > read ? received[read++] : null;
    },
  };
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
