import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { type Editor, NOT_LOADED, answered, editorView, orderArgs, orderRows, reduce, saveArgs, storedOf } from "../src/app/drawer";
import { setup } from "./harness";

/** A tab of the drawer over a real `serve`: it loads the record, and saves as the page does. */
function withRecord(record: "intent" | "notes") {
  const ctx = setup();
  mkdirSync(ctx.configDir, { recursive: true });
  writeFileSync(join(ctx.configDir, "config.json"), JSON.stringify({ repos: [] }));
  /** The state after refetching `/api/<record>`, as on its event. */
  const fetched = async (state: Editor) => reduce(state, { type: "fetched", stored: storedOf(record, JSON.parse((await ctx.web(`/api/${record}`)).body)) });
  /** The state after Save: posted, and its answer taken. */
  const save = async (state: Editor) => {
    const args = saveArgs(state)!;
    const sent = reduce(state, { type: "saving" });
    const response = await ctx.web(`/api/${record}/set`, { method: "POST", body: JSON.stringify({ args }) });
    return reduce(sent, answered(record, JSON.parse(response.body), args.at(-1)!));
  };
  return { ...ctx, fetched, save };
}

const edit = (state: Editor, text: string) => reduce(state, { type: "edit", text });

for (const record of ["intent", "notes"] as const) {
  describe(`the drawer's ${record} editor`, () => {
    test("shows the record, and follows the Lead's edits while the user is not editing", async () => {
      const { cli, fetched } = withRecord(record);
      let state = await fetched(NOT_LOADED);
      expect(editorView(state)).toMatchObject({ text: "", dirty: false, conflict: null, canSave: false });

      await cli(record, "set", "--text", "- Ship billing first\n");
      state = await fetched(state);
      expect(editorView(state)).toMatchObject({ text: "- Ship billing first\n", dirty: false, conflict: null });
    });

    test("saves an edit with the version it was read at, after which it is no longer dirty", async () => {
      const { cli, fetched, save } = withRecord(record);
      await cli(record, "set", "--text", "- Ship billing first\n");
      let state = edit(await fetched(NOT_LOADED), "- Ship search first\n");
      expect(editorView(state)).toMatchObject({ text: "- Ship search first\n", dirty: true, canSave: true });

      state = await save(state);
      expect(editorView(state)).toMatchObject({ text: "- Ship search first\n", dirty: false, conflict: null, saving: false, error: null });
      expect((await cli(record, "--json")).json()[record]).toBe("- Ship search first\n");
      // The save's own event refetches what it wrote: nothing changes.
      expect(editorView(await fetched(state))).toMatchObject({ text: "- Ship search first\n", dirty: false, conflict: null });
    });

    test("an edit undone is not dirty, and blank text cannot be saved", async () => {
      const { cli, fetched } = withRecord(record);
      await cli(record, "set", "--text", "- Ship billing first\n");
      const state = await fetched(NOT_LOADED);
      expect(editorView(edit(edit(state, "- Ship"), "- Ship billing first\n"))).toMatchObject({ dirty: false, canSave: false });
      expect(editorView(edit(state, "  \n"))).toMatchObject({ dirty: true, canSave: false });
    });

    test("a change by the Lead while the user edits is shown beside the draft, never overwritten", async () => {
      const { cli, fetched, save } = withRecord(record);
      await cli(record, "set", "--text", "- Ship billing first\n");
      let state = edit(await fetched(NOT_LOADED), "- Ship search first\n");
      await cli(record, "set", "--text", "- Ship billing first\n- Then search\n");

      state = await fetched(state);
      expect(editorView(state)).toMatchObject({ text: "- Ship search first\n", dirty: true, canSave: false, conflict: { text: "- Ship billing first\n- Then search\n" } });

      // Keeping the draft saves it over the change the user has now seen.
      state = reduce(state, { type: "keep" });
      expect(editorView(state)).toMatchObject({ conflict: null, canSave: true });
      state = await save(state);
      expect(editorView(state)).toMatchObject({ dirty: false, error: null });
      expect((await cli(record, "--json")).json()[record]).toBe("- Ship search first\n");
    });

    test("taking the Lead's change drops the draft", async () => {
      const { cli, fetched } = withRecord(record);
      await cli(record, "set", "--text", "- Ship billing first\n");
      let state = edit(await fetched(NOT_LOADED), "- Ship search first\n");
      await cli(record, "set", "--text", "- Then search\n");
      state = reduce(await fetched(state), { type: "take" });
      expect(editorView(state)).toMatchObject({ text: "- Then search\n", dirty: false, conflict: null });
    });

    test("a save refused as stale, the change not fetched yet, shows the change as a conflict", async () => {
      const { cli, fetched, save } = withRecord(record);
      await cli(record, "set", "--text", "- Ship billing first\n");
      let state = edit(await fetched(NOT_LOADED), "- Ship search first\n");
      await cli(record, "set", "--text", "- Then search\n");

      state = await save(state);
      expect(editorView(state)).toMatchObject({ text: "- Ship search first\n", saving: false, conflict: { text: "- Then search\n" }, error: null });
      expect((await cli(record, "--json")).json()[record]).toBe("- Then search\n");
    });

    test("a save that fails otherwise keeps the draft and says why", async () => {
      const { cli, fetched } = withRecord(record);
      await cli(record, "set", "--text", "- Ship billing first\n");
      const state = reduce(reduce(edit(await fetched(NOT_LOADED), "- Ship search first\n"), { type: "saving" }), answered(record, null, "- Ship search first\n"));
      expect(editorView(state)).toMatchObject({ text: "- Ship search first\n", dirty: true, canSave: true, error: "Could not reach nico-agent serve; try again." });
    });
  });
}

describe("the drawer's Standing orders", () => {
  test("lists every order with what it lets the Lead do, and a toggle posts `orders set`", async () => {
    const { cli, web } = withRecord("intent");
    const rows = () => web("/api/orders").then((r) => orderRows(JSON.parse(r.body)));
    expect(await rows()).toEqual([
      { order: "start", on: false, lets: "the Lead queue and start Specs (the Repo's room still caps it)" },
      { order: "answer", on: false, lets: "the Lead answer an Asking Implementer in its own words" },
      { order: "review", on: true, lets: "the Lead launch Reviewers" },
      { order: "close", on: true, lets: "the Lead Close Dispatches whose PR is ready" },
      { order: "write", on: false, lets: "the Lead write Specs and tickets to a Source" },
    ]);

    expect(orderArgs("start", true)).toEqual(["start", "on"]);
    await web("/api/orders/set", { method: "POST", body: JSON.stringify({ args: orderArgs("start", true) }) });
    await web("/api/orders/set", { method: "POST", body: JSON.stringify({ args: orderArgs("close", false) }) });
    expect((await cli("orders", "--json")).json().orders).toMatchObject({ start: true, close: false });
    expect((await rows()).filter((r) => r.on).map((r) => r.order)).toEqual(["start", "review"]);
  });

  test("lists nothing while `/api/orders` has not answered", () => {
    expect(orderRows({ error: "config.json is not JSON" })).toEqual([]);
  });
});
