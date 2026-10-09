import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HEARING_FILES } from "../src/app/hearing";
import { THEME_KEY } from "../src/app/theme";

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
        await fetch(`${base}/api/board`);
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
    // The remembered theme is set in the head, before the first paint.
    expect(html).toContain(`localStorage.getItem("${THEME_KEY}")`);
    const script = html.match(/<script[^>]* src="([^"]+)"/)?.[1];
    const style = html.match(/<link[^>]* href="([^"]+\.css)"/)?.[1];
    expect(script).toBeDefined();
    expect(style).toBeDefined();

    const js = await fetch(new URL(script!, base));
    expect(js.status).toBe(200);
    const source = await js.text();
    expect(source).toContain("/api/events");
    expect(source).toContain("Conversation with the Lead");
    // The Repos pane reads the Board, through serve's cache.
    expect(source).toContain("/api/board");
    const css = await fetch(new URL(style!, base));
    expect(css.status).toBe(200);
    expect(await css.text()).toContain('[data-theme="dark"]');
  });

  test("serves the models the page hears speech with, and onnxruntime-web's WebAssembly, embedded", async () => {
    const sources = {
      [HEARING_FILES.vad]: join(import.meta.dir, "../src/app/models/silero-vad.onnx"),
      [HEARING_FILES.turn]: join(import.meta.dir, "../src/app/models/smart-turn-v3.2-cpu.onnx"),
      [HEARING_FILES.wasm]: join(import.meta.dir, "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"),
    };
    for (const [path, source] of Object.entries(sources)) {
      const file = await fetch(`${base}${path}`);
      expect(file.status).toBe(200);
      expect((await file.arrayBuffer()).byteLength).toBe(Bun.file(source).size);
    }
    expect((await fetch(`${base}${HEARING_FILES.wasm}`)).headers.get("content-type")).toBe("application/wasm");
  });

  test("no longer serves the htmx Board", async () => {
    expect((await fetch(`${base}/classic`)).status).toBe(404);
    expect((await fetch(`${base}/htmx.min.js`)).status).toBe(404);
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
