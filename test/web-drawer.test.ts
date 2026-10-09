import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { events, setup } from "./harness";

function withConfig() {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [] }));
  const post = (path: string, args: string[]) => ctx.web(path, { method: "POST", body: JSON.stringify({ args }) });
  return { ...ctx, post };
}

for (const record of ["intent", "notes"] as const) {
  describe(`the drawer's ${record} tab`, () => {
    test(`/api/${record} is the record as \`${record} --json\`, empty while there is none`, async () => {
      const { cli, web } = withConfig();
      expect(JSON.parse((await web(`/api/${record}`)).body)).toMatchObject({ [record]: "" });
      await cli(record, "set", "--text", "- Ship billing first\n");

      const { status, body } = await web(`/api/${record}`);
      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual((await cli(record, "--json")).json());
      expect(JSON.parse(body)).toMatchObject({ [record]: "- Ship billing first\n", version: expect.any(String) });
    });

    test(`/api/${record}/set replaces it with the version read, and the Lead's \`${record}\` tool reads the change`, async () => {
      const { cli, web, post } = withConfig();
      await cli(record, "set", "--text", "- Ship billing first\n");
      const { version } = JSON.parse((await web(`/api/${record}`)).body);

      const saved = await post(`/api/${record}/set`, ["--version", version, "--text", "- Ship search first\n"]);
      expect(saved.status).toBe(200);
      const { version: now } = JSON.parse(saved.body);
      expect(now).not.toBe(version);
      expect((await cli(record, "--json")).json()).toMatchObject({ [record]: "- Ship search first\n", version: now });
      const rpc = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: record, arguments: {} } };
      expect((await web("/mcp", { method: "POST", body: JSON.stringify(rpc) })).body).toContain("Ship search first");
    });

    test(`/api/${record}/set with a stale version is refused with the current text, which stays`, async () => {
      const { cli, web, post } = withConfig();
      await cli(record, "set", "--text", "- Ship billing first\n");
      const { version } = JSON.parse((await web(`/api/${record}`)).body);
      // The Lead edits it while the user does.
      await cli(record, "set", "--text", "- Ship billing first\n- Then search\n");

      const refused = await post(`/api/${record}/set`, ["--version", version, "--text", "- Ship search first\n"]);
      expect(refused.status).toBe(422);
      const current = (await cli(record, "--json")).json();
      expect(JSON.parse(refused.body)).toMatchObject({ error: expect.stringContaining("changed since"), [record]: "- Ship billing first\n- Then search\n", version: current.version });
      expect(current[record]).toBe("- Ship billing first\n- Then search\n");
    });
  });
}

describe("the drawer's Standing orders tab", () => {
  test("/api/orders is `orders --json`, and /api/orders/set toggles one as `orders set` does", async () => {
    const { cli, web, post } = withConfig();
    const read = await web("/api/orders");
    expect(read.status).toBe(200);
    expect(JSON.parse(read.body)).toEqual((await cli("orders", "--json")).json());

    const set = await post("/api/orders/set", ["start", "on"]);
    expect(set.status).toBe(200);
    expect(JSON.parse(set.body)).toMatchObject({ order: "start on" });
    expect((await cli("orders", "--json")).json().orders).toEqual({ start: true, answer: false, review: true, close: true, write: false });
    await post("/api/orders/set", ["review", "off"]);
    expect(JSON.parse((await web("/api/orders")).body).orders).toMatchObject({ start: true, review: false });
  });

  test("/api/orders/set refuses an order there is not, with the CLI's help", async () => {
    const { post } = withConfig();
    const { status, body } = await post("/api/orders/set", ["nope", "on"]);
    expect(status).toBe(400);
    expect(JSON.parse(body)).toMatchObject({ error: "`nope` is not a Standing order", help: expect.arrayContaining(["Standing orders: start, answer, review, close, write"]) });
  });
});

/** The events the stream sends until it goes quiet. */
async function drain(stream: Awaited<ReturnType<typeof events>>) {
  const names: string[] = [];
  for (let next = await stream.next(); next; next = await stream.next(50)) names.push(next.event);
  return names;
}

describe("/api/events for the drawer", () => {
  test("saving the Intent or the Notes, or toggling an order, sends its own event", async () => {
    const { handler, web, post } = withConfig();
    const stream = await events(handler);
    const { version } = JSON.parse((await web("/api/intent")).body);
    await post("/api/intent/set", ["--version", version, "--text", "- Ship billing\n"]);
    expect(await drain(stream)).toEqual(["board-changed", "intent-changed"]);
    await post("/api/orders/set", ["start", "on"]);
    expect(await drain(stream)).toEqual(["board-changed", "orders-changed"]);
    await stream.close();
  });

  test("the Lead's edits and the CLI's reach the stream when serve looks again, as on its tick", async () => {
    const { cli, handler, look } = withConfig();
    const stream = await events(handler);
    await cli("notes", "set", "--text", "- audit-notes runs on codex\n");
    await cli("intent", "set", "--text", "- Ship billing\n");
    await cli("orders", "set", "write", "on");
    await look();
    expect(await drain(stream)).toEqual(["intent-changed", "notes-changed", "orders-changed"]);
    await look();
    expect(await stream.next(50)).toBeNull();
    await stream.close();
  });
});
