import { describe, expect, test } from "bun:test";
import { events, setup } from "./harness";

const TALK = "http://127.0.0.1:42069/api/voice/talk";

describe("a key anywhere: voice talk", () => {
  test("with the app open, the page that connected last hears `listen`, and nothing else changes", async () => {
    const { web, handler } = setup();
    const first = await events(handler);
    const last = await events(handler);

    const answer = await web("/api/voice/talk", { method: "POST" });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toMatchObject({ listen: "sent" });
    expect(await last.next()).toEqual({ event: "listen", data: "{}" });
    expect(await first.next(100)).toBeNull();
    expect(await last.next(100)).toBeNull();
    await first.close();
    await last.close();
  });

  test("with no app open, it is refused with help", async () => {
    const { web } = setup();
    const answer = await web("/api/voice/talk", { method: "POST" });
    expect(answer.status).toBe(422);
    expect(JSON.parse(answer.body)).toMatchObject({ error: "no app is open to listen", help: [expect.stringContaining("Open http://")] });
  });

  test("another site's page cannot start the microphone", async () => {
    const { web, handler } = setup();
    const page = await events(handler);
    const answer = await web("/api/voice/talk", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
    expect(answer.status).toBe(403);
    expect(await page.next(100)).toBeNull();
    await page.close();
  });

  test("the CLI posts it to serve, and says so", async () => {
    const { cli, world, handler } = setup();
    world.endpoint(TALK, handler);
    const page = await events(handler);

    const result = await cli("voice", "talk", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.json()).toMatchObject({ listen: "sent" });
    expect(await page.next()).toEqual({ event: "listen", data: "{}" });
    await page.close();
  });

  test("the CLI is refused with help when no app is open, or serve is not running", async () => {
    const { cli, world, handler } = setup();
    world.endpoint(TALK, handler);
    const closed = await cli("voice", "talk", "--json");
    expect(closed.exitCode).toBe(1);
    expect(closed.json()).toMatchObject({ error: "no app is open to listen", help: [expect.stringContaining("Open http://")] });

    const elsewhere = await cli("voice", "talk", "--port", "8080", "--json");
    expect(elsewhere.exitCode).toBe(1);
    expect(elsewhere.json()).toMatchObject({ error: expect.stringContaining("could not reach nico-agent serve"), help: [expect.stringContaining("nico-agent serve --port 8080")] });
  });
});
