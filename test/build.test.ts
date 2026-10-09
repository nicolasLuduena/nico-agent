import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/** A port nothing listens on, from the OS. */
function freePort() {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const { port } = probe;
  probe.stop(true);
  return port!;
}

// Built and run as `scripts/install.sh` does, from a directory away from the sources, so it serves only what it embeds.
describe("the compiled binary", () => {
  const dir = mkdtempSync(join(tmpdir(), "nico-agent-build-"));
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;
  let server: ReturnType<typeof Bun.spawn> | undefined;

  beforeAll(async () => {
    const build = Bun.spawnSync(["bun", "build", "--compile", join(import.meta.dir, "../src/main.ts"), "--outfile", join(dir, "nico-agent")], { stderr: "pipe" });
    expect(build.stderr.toString()).not.toContain("error");
    expect(build.exitCode).toBe(0);
    server = Bun.spawn([join(dir, "nico-agent"), "serve", "--port", String(port)], {
      cwd: dir,
      env: { ...process.env, NICO_AGENT_CONFIG_DIR: join(dir, "config") },
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let tries = 0; ; tries++) {
      try {
        await fetch(`${base}/classic`);
        break;
      } catch (e) {
        if (tries > 100) throw e;
        await Bun.sleep(50);
      }
    }
  }, 60_000);

  afterAll(() => server?.kill());

  test("serves the React app at /, its script and stylesheet bundled in", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toStartWith("text/html");
    const html = await page.text();
    expect(html).toContain('<div id="root"></div>');
    const script = html.match(/<script[^>]* src="([^"]+)"/)?.[1];
    const style = html.match(/<link[^>]* href="([^"]+\.css)"/)?.[1];
    expect(script).toBeDefined();
    expect(style).toBeDefined();

    const js = await fetch(new URL(script!, base));
    expect(js.status).toBe(200);
    const source = await js.text();
    expect(source).toContain("/api/events");
    expect(source).toContain("In flight");
    const css = await fetch(new URL(style!, base));
    expect(css.status).toBe(200);
    expect(await css.text()).toContain("prefers-color-scheme");
  });

  test("serves the htmx Board at /classic, htmx included", async () => {
    const page = await fetch(`${base}/classic`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<script src="/htmx.min.js"></script>');
    expect((await fetch(`${base}/htmx.min.js`)).status).toBe(200);
  });

  test("answers /api/board and opens /api/events", async () => {
    const board = await fetch(`${base}/api/board`);
    expect(board.status).toBe(200);
    expect(await board.json()).toMatchObject({ repos: "0 configured" });

    const controller = new AbortController();
    const events = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    const { value } = await events.body!.getReader().read();
    expect(new TextDecoder().decode(value)).toBe("retry: 1000\n\n");
    controller.abort();
  });
});
