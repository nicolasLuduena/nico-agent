import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { run } from "../src/cli";
import { setup } from "./harness";

describe.each(["intent", "notes"] as const)("nico-agent %s", (record) => {
  const file = `${record}.md`;

  test("shows none yet, with a hint, when there is no file", async () => {
    const { cli, configDir } = setup();
    const shown = await cli(record);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain(`none yet: ${join(configDir, file)} is missing or empty`);
    expect(shown.stdout).toContain(`nico-agent ${record} set --file <path>`);

    const json = (await cli(record, "--json")).json();
    expect(json).toMatchObject({ [record]: "", path: join(configDir, file) });
    expect(typeof json.version).toBe("string");
  });
});

describe.each(["intent", "notes"] as const)("nico-agent %s set", (record) => {
  const file = `${record}.md`;

  test("replaces it whole with a file, then shows it with its new version", async () => {
    const { cli, configDir } = setup();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, file), "old text\n");
    const source = join(configDir, "..", "new.md");
    writeFileSync(source, "- Ship billing by Friday\n");

    const set = await cli(record, "set", "--file", source, "--json");
    expect(set.exitCode).toBe(0);
    expect(set.json()).toMatchObject({ replaced: join(configDir, file) });
    expect(readFileSync(join(configDir, file), "utf8")).toBe("- Ship billing by Friday\n");

    const shown = (await cli(record, "--json")).json();
    expect(shown[record]).toBe("- Ship billing by Friday\n");
    expect(shown.version).toBe(set.json().version);
    expect((await cli(record)).stdout).toContain("Ship billing by Friday");
  });

  test("reads standard input when given no file", async () => {
    const { world, configDir } = setup();
    const piped = await run([record, "set"], { world, configDir, bin: "nico-agent", stdin: async () => "- From a pipe\n" });
    expect(piped.exitCode).toBe(0);
    expect(readFileSync(join(configDir, file), "utf8")).toBe("- From a pipe\n");
  });

  test("with no file and nothing piped in, is refused", async () => {
    const { cli } = setup();
    const refused = await cli(record, "set");
    expect(refused.exitCode).toBe(2);
    expect(refused.stdout).toContain("pass --file, or pipe the Markdown in");
  });

  test("a replace carrying the version read succeeds; a stale one is refused with the current text", async () => {
    const { cli, configDir } = setup();
    const read = (await cli(record, "--json")).json();
    const first = await cli(record, "set", "--text", "- Mine\n", "--version", read.version, "--json");
    expect(first.exitCode).toBe(0);

    // The other editor still holds the version from before the first replace.
    const stale = await cli(record, "set", "--text", "- Theirs\n", "--version", read.version, "--json");
    expect(stale.exitCode).toBe(1);
    expect(stale.json()).toMatchObject({ [record]: "- Mine\n", version: first.json().version });
    expect(stale.json().error).toContain("changed since");
    expect(stale.json().help.join(" ")).toContain(`--version ${first.json().version}`);
    expect(readFileSync(join(configDir, file), "utf8")).toBe("- Mine\n");
  });

  test("a hand edit to the file makes the version read before it stale", async () => {
    const { cli, configDir } = setup();
    const read = (await cli(record, "--json")).json();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, file), "- Edited in an editor\n");
    expect((await cli(record, "set", "--text", "- Lead's\n", "--version", read.version)).exitCode).toBe(1);
  });

  test("the orient packet carries what was set", async () => {
    const { cli } = setup();
    await cli(record, "set", "--text", "- Billing first\n");
    expect((await cli("lead", "inbox", "--json")).json().orient[record]).toBe("- Billing first\n");
  });
});

/** A tools/call to the web handler's /mcp, as the Lead's Harness makes it. */
async function callTool(web: ReturnType<typeof setup>["web"], name: string, args: Record<string, unknown>) {
  const response = await web("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return JSON.parse(response.body);
}

describe.each(["intent", "notes"] as const)("the Lead's %s tool", (record) => {
  test("reads it with its version, and replaces it carrying that version", async () => {
    const { web, cli } = setup();
    await cli(record, "set", "--text", "- Billing first\n");

    const read = (await callTool(web, record, {})).result;
    expect(read.isError).toBe(false);
    expect(read.structuredContent).toMatchObject({ [record]: "- Billing first\n" });

    const replaced = (await callTool(web, record, { text: "- Billing first\n- Then search\n", version: read.structuredContent.version })).result;
    expect(replaced.isError).toBe(false);
    expect((await cli(record, "--json")).json()[record]).toBe("- Billing first\n- Then search\n");
  });

  test("a replace with a stale version is refused with the current text, and changes nothing", async () => {
    const { web, cli } = setup();
    const read = (await callTool(web, record, {})).result.structuredContent;
    await cli(record, "set", "--text", "- The user's edit\n");

    const stale = (await callTool(web, record, { text: "- The Lead's\n", version: read.version })).result;
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ [record]: "- The user's edit\n" });
    expect(stale.structuredContent.help.join(" ")).toContain("Merge your change");
    expect((await cli(record, "--json")).json()[record]).toBe("- The user's edit\n");
  });

  test("a replace needs the version it read", async () => {
    const { web } = setup();
    const reply = await callTool(web, record, { text: "- Unread\n" });
    expect(reply.error.message).toContain("version");
  });
});
