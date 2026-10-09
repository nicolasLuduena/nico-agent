import { useEffect, useReducer, useState } from "react";
import type { Order } from "../orders";
import type { RecordName } from "../records";
import type { Outcome } from "./actions";
import { NOT_LOADED, answered, editorView, orderArgs, orderRows, reduce, saveArgs, storedOf } from "./drawer";
import { OutcomeNote, answerOf, post } from "./forms";
import { useResource } from "./stream";

const RECORD_TABS: Record<RecordName, { name: string; lede: string }> = {
  intent: { name: "Intent", lede: "What you are working toward and why, in Markdown. The Lead reads it every turn and asks before changing it." },
  notes: { name: "Notes", lede: "Your standing preferences, recurring decisions and names for things. The Lead reads them every turn and adds what it learns." },
};

type Tab = RecordName | "orders";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "intent", label: "Intent" },
  { tab: "notes", label: "Notes" },
  { tab: "orders", label: "Standing orders" },
];

/**
 * The Intent or the Notes, refetched on its event: followed while the user
 * is not editing it, saved with the version the draft started from.
 */
function useRecord(record: RecordName) {
  const { data = null, failure } = useResource<Record<string, unknown>>(`/api/${record}`, [`${record}-changed` as const]);
  const [state, dispatch] = useReducer(reduce, NOT_LOADED);
  useEffect(() => dispatch({ type: "fetched", stored: storedOf(record, data) }), [record, data]);
  const save = async () => {
    const args = saveArgs(state);
    if (!args) return;
    dispatch({ type: "saving" });
    dispatch(answered(record, await post(`/api/${record}/set`, args), args.at(-1)!));
  };
  return { state, dispatch, save, failure };
}

/**
 * The Lead panel's drawer: the Intent and the Notes as Markdown, and the
 * Standing orders as switches, each what `nico-agent intent`, `notes` and
 * `orders` do (ADR-0006). Kept mounted while closed, so a draft survives.
 */
export function LeadDrawer({ open }: { open: boolean }) {
  const [tab, setTab] = useState<Tab>("intent");
  const records = { intent: useRecord("intent"), notes: useRecord("notes") };
  const marked = (t: Tab) => t !== "orders" && editorView(records[t].state).dirty;
  return (
    <section className="lead-drawer" id="lead-drawer" aria-label="Intent, Notes and Standing orders" hidden={!open}>
      <div className="tabs" role="tablist">
        {TABS.map(({ tab: t, label }) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`drawer-tab-${t}`}
            aria-controls={`drawer-${t}`}
            aria-selected={tab === t}
            className={marked(t) ? "edited" : undefined}
            title={marked(t) ? "Edited, not saved" : undefined}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      {(["intent", "notes"] as const).map((r) => (
        <RecordTab key={r} record={r} {...records[r]} hidden={tab !== r} />
      ))}
      <OrdersTab hidden={tab !== "orders"} />
    </section>
  );
}

function RecordTab({ record, state, dispatch, save, failure, hidden }: ReturnType<typeof useRecord> & { record: RecordName; hidden: boolean }) {
  const { name, lede } = RECORD_TABS[record];
  const { text, dirty, conflict, saving, error, canSave } = editorView(state);
  const loaded = state.stored !== null;
  return (
    <div className="drawer-tab record" role="tabpanel" id={`drawer-${record}`} aria-labelledby={`drawer-tab-${record}`} hidden={hidden}>
      <p className="lede">{lede}</p>
      {failure && <p className="error" role="status">{failure}</p>}
      {conflict && (
        <div className="conflict" role="alert">
          <p><b>{`The ${name} changed while you edited it.`}</b> Your edit is kept below; this is the {name} now.</p>
          <pre>{conflict.text.trim() ? conflict.text : "(empty)"}</pre>
          <div className="buttons">
            <button type="button" onClick={() => dispatch({ type: "keep" })}>Keep my edit</button>
            <button type="button" onClick={() => dispatch({ type: "take" })}>Use this instead</button>
          </div>
        </div>
      )}
      <textarea
        aria-label={`${name}, in Markdown`}
        placeholder={loaded ? `No ${name} yet. Write it in Markdown.` : "Loading…"}
        value={text}
        disabled={!loaded}
        onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
        spellCheck
      />
      <div className="record-foot">
        <span className="status" role="status">
          {saving ? "Saving…" : conflict ? "Not saved: changed meanwhile" : dirty ? (text.trim() ? "Edited, not saved" : "Blank text is not saved") : loaded ? "Saved" : ""}
        </span>
        <button type="button" disabled={!dirty || saving} onClick={() => dispatch({ type: "take" })}>Revert</button>
        <button type="button" className="save" disabled={!canSave} onClick={() => void save()}>Save</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** The Standing orders as switches; one flipped shows its new state until the refetch confirms it. */
function OrdersTab({ hidden }: { hidden: boolean }) {
  const { data = null, failure } = useResource<Record<string, unknown>>("/api/orders", ["orders-changed"]);
  const [pending, setPending] = useState<Partial<Record<Order, boolean>>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => setPending({}), [data]);
  const toggle = async (order: Order, on: boolean) => {
    setOutcome(null);
    setPending((p) => ({ ...p, [order]: on }));
    const answer = answerOf(await post("/api/orders/set", orderArgs(order, on)));
    if (answer.failed) {
      setOutcome(answer);
      setPending(({ [order]: _, ...rest }) => rest);
    }
  };
  const rows = orderRows(data);
  return (
    <div className="drawer-tab orders" role="tabpanel" id="drawer-orders" aria-labelledby="drawer-tab-orders" hidden={hidden}>
      <p className="lede">What the Lead may do without asking. With one off, it proposes the action for you to approve instead.</p>
      {failure && <p className="error" role="status">{failure}</p>}
      {rows.length
        ? (
          <ul className="orders">
            {rows.map(({ order, on, lets }) => {
              const shown = pending[order] ?? on;
              return (
                <li key={order}>
                  <label>
                    <input type="checkbox" role="switch" checked={shown} disabled={pending[order] !== undefined} onChange={(e) => void toggle(order, e.target.checked)} />
                    <span className="order">{order}</span>
                    <span className="state">{shown ? "on" : "off"}</span>
                  </label>
                  <p>{`Lets ${lets}.`}</p>
                </li>
              );
            })}
          </ul>
        )
        : <p className="empty">{data ? answerOf(data).lines[0]?.text ?? "No Standing orders." : "Loading…"}</p>}
      {outcome && <OutcomeNote outcome={outcome} />}
    </div>
  );
}
