import { type KeyboardEvent, useEffect, useReducer, useState } from "react";
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
    if (!args || !state.draft) return;
    const { text } = state.draft;
    dispatch({ type: "saving", text });
    dispatch(answered(record, await post(`/api/${record}/set`, args), text));
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
  // As tabs do: the arrow keys, Home and End move between them, so Tab goes from the selected one into its panel.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.tab === tab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1 + TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = TABS[to % TABS.length]!.tab;
    setTab(next);
    document.getElementById(`drawer-tab-${next}`)?.focus();
  };
  // A div, not a section: the Board's section is a card, and the drawer sits flat in the panel.
  return (
    <div className="lead-drawer" id="lead-drawer" role="region" aria-label="Intent, Notes and Standing orders" hidden={!open}>
      <div className="tabs" role="tablist" aria-label="Drawer" onKeyDown={onKey}>
        {TABS.map(({ tab: t, label }) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`drawer-tab-${t}`}
            aria-controls={`drawer-${t}`}
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
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
    </div>
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

/**
 * The Standing orders as switches. One flipped shows its new state until the
 * refetch agrees, and is disabled only while its post runs, so a lost event
 * never leaves it stuck or flipped back.
 */
function OrdersTab({ hidden }: { hidden: boolean }) {
  const { data = null, failure } = useResource<Record<string, unknown>>("/api/orders", ["orders-changed"]);
  const [wanted, setWanted] = useState<Partial<Record<Order, boolean>>>({});
  const [posting, setPosting] = useState<Set<Order>>(new Set());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const rows = orderRows(data);
  useEffect(() => {
    const now = new Map(rows.map((r) => [r.order, r.on]));
    setWanted((w) => Object.fromEntries(Object.entries(w).filter(([order, on]) => now.get(order as Order) !== on)));
  }, [data]);
  const toggle = async (order: Order, on: boolean) => {
    setOutcome(null);
    setWanted((w) => ({ ...w, [order]: on }));
    setPosting((p) => new Set(p).add(order));
    const answer = answerOf(await post("/api/orders/set", orderArgs(order, on)));
    setPosting((p) => {
      const next = new Set(p);
      next.delete(order);
      return next;
    });
    if (answer.failed) {
      setOutcome(answer);
      setWanted(({ [order]: _, ...rest }) => rest);
    }
  };
  return (
    <div className="drawer-tab orders" role="tabpanel" id="drawer-orders" aria-labelledby="drawer-tab-orders" hidden={hidden}>
      <p className="lede">What the Lead may do without asking. With one off, it proposes the action for you to approve instead.</p>
      {failure && <p className="error" role="status">{failure}</p>}
      {rows.length
        ? (
          <ul className="orders">
            {rows.map(({ order, on, lets }) => {
              const shown = wanted[order] ?? on;
              return (
                <li key={order}>
                  <label>
                    <input type="checkbox" role="switch" checked={shown} disabled={posting.has(order)} onChange={(e) => void toggle(order, e.target.checked)} />
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
