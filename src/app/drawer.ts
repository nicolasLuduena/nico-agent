import { ORDERS, type Order } from "../orders";
import type { RecordName } from "../records";
import { answerOf } from "./forms";

/** The Intent or the Notes as `nico-agent <record> --json` gives it: its text and the version a replace carries. */
export interface Stored {
  text: string;
  version: string;
}

/**
 * A drawer tab editing the Intent or the Notes: the record as last fetched,
 * and the user's draft with the version it started from. While the user is
 * not editing, the tab follows the record, so the Lead's latest edit shows.
 */
export interface Editor {
  stored: Stored | null;
  /** Null while the user is not editing. */
  draft: { text: string; from: Stored } | null;
  /** The text being saved, until `serve` answers. */
  saving: string | null;
  /**
   * The version the last save replaced: a fetch of it was sampled before
   * the save and is dropped, until a change by someone else is fetched.
   */
  replaced: string | null;
  /** Why the last save failed, until the next. */
  error: string | null;
}

export const NOT_LOADED: Editor = { stored: null, draft: null, saving: null, replaced: null, error: null };

export type EditorEvent =
  | { type: "fetched"; stored: Stored | null }
  | { type: "edit"; text: string }
  | { type: "saving"; text: string }
  | { type: "saved"; stored: Stored }
  /** The save carried a version no longer the record's: `stored` is the record now. */
  | { type: "stale"; stored: Stored }
  | { type: "failed"; error: string }
  /** Drop the draft for the record as it is now. */
  | { type: "take" }
  /** Keep the draft over a change the user has now seen: it saves over it. */
  | { type: "keep" };

/** The record in `/api/<record>`'s answer; null when it is not one, such as when `serve` failed to read it. */
export function storedOf(record: RecordName, json: Record<string, unknown> | null): Stored | null {
  const text = json?.[record];
  return typeof text === "string" && typeof json?.version === "string" ? { text, version: json.version } : null;
}

/** A draft that says what `stored` says is no draft: the user is no longer editing. */
function settle(state: Editor): Editor {
  const { draft, stored } = state;
  return draft && stored && draft.text === stored.text ? { ...state, draft: null } : state;
}

/** The tab's state after `event`. */
export function reduce(state: Editor, event: EditorEvent): Editor {
  switch (event.type) {
    case "fetched": {
      const { stored } = event;
      // A failed fetch keeps what was shown, and one from before the last save is stale.
      if (!stored || stored.version === state.replaced) return state;
      // The save's own write, refetched before `serve` answered it, is no change by someone else.
      const ours = state.saving !== null ? stored.text === state.saving : stored.version === state.stored?.version;
      const draft = ours && state.saving !== null && state.draft ? { ...state.draft, from: stored } : state.draft;
      return settle({ ...state, stored, draft, replaced: ours ? state.replaced : null });
    }
    case "edit": {
      const from = state.draft?.from ?? state.stored;
      if (!from) return state;
      // Undoing an edit back to the record, unchanged since, is no longer editing.
      if (event.text === from.text && from.version === state.stored?.version) return { ...state, draft: null };
      return { ...state, draft: { text: event.text, from } };
    }
    case "saving":
      return { ...state, saving: event.text, replaced: state.draft?.from.version ?? null, error: null };
    case "saved": {
      // What the user typed while it saved stays a draft on what was saved.
      const draft = state.draft && { text: state.draft.text, from: event.stored };
      return settle({ ...state, stored: event.stored, draft, saving: null, error: null });
    }
    case "stale":
      return settle({ ...state, stored: event.stored, saving: null, replaced: null });
    case "failed":
      return { ...state, saving: null, replaced: null, error: event.error };
    case "take":
      return { ...state, draft: null, error: null };
    case "keep":
      return state.draft && state.stored ? { ...state, draft: { ...state.draft, from: state.stored } } : state;
  }
}

/**
 * What the tab shows: the draft or the record, whether it is edited, the
 * record as changed by someone else since the draft started (the Lead, the
 * CLI, an editor), and whether Save may post. Blank text is never saved.
 */
export function editorView({ stored, draft, saving: sending, error }: Editor) {
  const text = draft?.text ?? stored?.text ?? "";
  const conflict = draft && stored && draft.from.version !== stored.version ? stored : null;
  const saving = sending !== null;
  return { text, dirty: draft !== null, conflict, saving, error, canSave: draft !== null && !conflict && !saving && text.trim() !== "" };
}

/** `<record> set`'s arguments for the draft: the version it started from, then its text last. */
export function saveArgs({ draft }: Editor): string[] | null {
  return draft && ["--version", draft.from.version, "--text", draft.text];
}

/** The event for `/api/<record>/set`'s answer to saving `text`; null when `serve` could not be reached. */
export function answered(record: RecordName, json: Record<string, unknown> | null, text: string): EditorEvent {
  if (json && typeof json.replaced === "string" && typeof json.version === "string") return { type: "saved", stored: { text, version: json.version } };
  // A stale version is refused with the record as it is now.
  const current = storedOf(record, json);
  if (current) return { type: "stale", stored: current };
  return { type: "failed", error: answerOf(json).lines[0]?.text ?? `the ${record} was not saved` };
}

/** A Standing order as the drawer lists it: on or off, and what it lets the Lead do unasked. */
export interface OrderRow {
  order: Order;
  on: boolean;
  lets: string;
}

/** Every Standing order in `nico-agent orders --json`, in the CLI's order; none while it has not answered. */
export function orderRows(json: Record<string, unknown> | null): OrderRow[] {
  const orders = json?.orders;
  if (!orders || typeof orders !== "object") return [];
  return (Object.keys(ORDERS) as Order[]).map((order) => ({ order, on: (orders as Record<string, unknown>)[order] === true, lets: ORDERS[order].lets }));
}

/** `orders set`'s arguments turning `order` on or off. */
export function orderArgs(order: Order, on: boolean): string[] {
  return [order, on ? "on" : "off"];
}
