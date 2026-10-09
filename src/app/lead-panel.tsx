import { type KeyboardEvent, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { Authored } from "../conversation";
import type { BoardJson } from "./board";
import { OutcomeNote, answerOf, post, usePost } from "./forms";
import {
  type Card, type Conversation, type ItemLine, type LeadStatusJson, type OpenItem, type ProposalJson, type Speaker,
  cards, followsNewEntries, itemLine, notices, reduce, sayArgs, toastId,
} from "./lead";
import { LeadDrawer } from "./lead-drawer";
import { sendsOnEnter } from "./popover";
import { ResearchBox } from "./research-box";
import { useResource } from "./stream";
import { TalkButton, TalkStatus, useTalk } from "./talk-button";

const EMPTY: Conversation = { entries: [], proposals: [], sends: [] };

/**
 * The conversation with the Lead and its Proposals, refetched on
 * `conversation-entry` and `proposal-changed`, with the sends not in it yet.
 * The App keeps it, so the header counts the Questions list, and its toasts
 * show, on every page.
 */
export function useConversation() {
  const log = useResource<{ entries?: Authored[] }>("/api/lead/log", ["conversation-entry"]);
  const proposals = useResource<{ proposals?: ProposalJson[] }>("/api/proposals", ["proposal-changed"]);
  const [state, dispatch] = useReducer(reduce, EMPTY);
  useEffect(() => dispatch({ type: "log", entries: log.data?.entries }), [log.data]);
  useEffect(() => dispatch({ type: "proposals", proposals: proposals.data?.proposals }), [proposals.data]);
  const sent = useRef(0);
  /** Send a message, or the answer to `question`, showing it at once; a spoken message keeps what was heard as `raw`. */
  const send = async (text: string, question?: number, raw?: string) => {
    const key = `send-${++sent.current}`;
    dispatch({ type: "send", key, text, at: new Date().toISOString(), ...(question !== undefined && { question }), ...(raw !== undefined && { raw }) });
    const json = await post("/api/say", sayArgs(text, question, raw));
    // `say` names the entry it wrote: `said` for a message, `id` for an answer.
    const id = json?.said ?? json?.id;
    if (typeof id === "number") dispatch({ type: "sent", key, id });
    else dispatch({ type: "failed", key, error: answerOf(json).lines[0]?.text ?? "the message was not sent" });
  };
  return {
    state, send, dismiss: (key: string) => dispatch({ type: "dismiss", key }), failure: log.failure ?? proposals.failure,
    /** Whether both the log and the Proposals have been fetched once. */
    loaded: Boolean(log.data && proposals.data),
  };
}

export type ConversationState = ReturnType<typeof useConversation>;

/**
 * The Lead panel: the Voice switch, the Research button and the drawer's
 * button, the one quiet place for warnings (the Board's among them), the
 * conversation as cards, with a line for each question and Proposal (an open
 * one's line calls `summon` to bring its toast forward), and the composer,
 * which stays put and keeps its draft while entries arrive.
 */
export function LeadPanel({ status, conversation, summon, board }: {
  status: LeadStatusJson | null; conversation: ConversationState; summon: (key: string) => void; board: BoardJson | null;
}) {
  const { state, send, dismiss, failure } = conversation;
  const [drawer, setDrawer] = useState(false);
  const voice = useResource<{ voice?: string }>("/api/voice/state", ["voice-changed"]).data?.voice === "on";
  const { busy, outcome, act } = usePost();
  const shown = cards(state);
  const scroller = useRef<HTMLOListElement>(null);
  // Whatever grows the conversation (a new card, an answer, the notices, the talk status) keeps it at its end,
  // unless the user scrolled up to read.
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const list = scroller.current;
    if (list && atEnd.current) list.scrollTop = list.scrollHeight;
  });
  /** A new message, written or spoken, brings the conversation to its end; answering a question where it is does not. */
  const sendAndFollow: SendText = (text, question, raw) => {
    atEnd.current = true;
    return send(text, question, raw);
  };
  const talking = useTalk(voice);
  const warnings = notices({ failure, status, talk: talking.warning, board });
  return (
    <section className="lead-panel" aria-label="Conversation with the Lead">
      <div className="lead-bar">
        <h1>Lead</h1>
        <label className="switch" title={voice ? "The Lead's replies are spoken, and it talks for the ear" : "Speak the Lead's replies, and have it talk for the ear"}>
          <input type="checkbox" role="switch" checked={voice} disabled={busy} onChange={(e) => void act(e.target.checked ? "/api/voice/on" : "/api/voice/off", [])} />
          Voice
        </label>
        <ResearchBox send={(text) => {
          // The request shows in the conversation, so it takes the drawer's place.
          setDrawer(false);
          void sendAndFollow(text);
        }} />
        <button type="button" className="quiet" aria-expanded={drawer} aria-controls="lead-drawer" onClick={() => setDrawer(!drawer)}>
          {drawer ? "Conversation" : "Intent & orders"}
        </button>
      </div>
      {(warnings.length > 0 || outcome) && (
        <div className="notices" role="status">
          {warnings.map((n) => (
            <p key={n.key}>{n.text}{n.help.map((h) => <span key={h} className="help">{h}</span>)}</p>
          ))}
          {outcome && <OutcomeNote outcome={outcome} />}
        </div>
      )}
      <LeadDrawer open={drawer} />
      <ol
        className="conversation"
        hidden={drawer}
        ref={scroller}
        aria-live="polite"
        aria-label="Conversation"
        tabIndex={0}
        onScroll={(e) => { atEnd.current = followsNewEntries(e.currentTarget); }}
      >
        {shown.length
          ? shown.map((card) => <CardView key={card.key} card={card} send={send} dismiss={dismiss} summon={summon} />)
          : (
            <li className="empty">
              <h2>Talk to the Lead</h2>
              <p>No conversation yet. Write or talk to the Lead below; it reads your message when it next looks at its Inbox.</p>
            </li>
          )}
      </ol>
      <Composer send={sendAndFollow} talk={talking} working={status?.lead === "running" && status.state === "working"} />
    </section>
  );
}

/** Send a message to the Lead, or the answer to its question `question`; `raw` is what was heard of a spoken one. */
export type SendText = (text: string, question?: number, raw?: string) => Promise<void>;

/** A card as the conversation draws it: a message, or a question's or Proposal's line. */
function CardView({ card, send, dismiss, summon }: { card: Card; send: SendText; dismiss: (key: string) => void; summon: (key: string) => void }) {
  switch (card.kind) {
    case "message":
      return (
        <li className={`card-message ${card.who}${card.sending ? " sending" : ""}${card.superseded ? " superseded" : ""}`}>
          <Byline who={card.who} at={card.at} note={messageNote(card)} />
          {card.heard !== undefined && <p className="heard"><span>You said</span>{card.heard}</p>}
          {card.raw === undefined
            ? <p className="text">{card.text}</p>
            : (
              <div className="spoken">
                <p className="text">{card.text}</p>
                <p className="raw"><span>Heard</span>{card.raw}</p>
              </div>
            )}
          {card.error && (
            <div className="send-failure">
              <p className="error">{card.error}</p>
              <button type="button" onClick={() => { dismiss(card.key); void send(card.text); }}>Send again</button>
              <button type="button" onClick={() => dismiss(card.key)}>Dismiss</button>
            </div>
          )}
        </li>
      );
    case "question":
    case "proposal":
      return <ItemLineView item={card} summon={summon} />;
  }
}

/** What a line says of where its item stands. */
const STATUS: Record<ItemLine["status"], string> = {
  open: "Open", answering: "Answering", answered: "You answered", approved: "Approved", declined: "Declined", failed: "Failed",
};

/**
 * A question's or Proposal's one line in the conversation: that the Lead
 * asked or proposed, what, and where it stands, with the answer or decision
 * and what the action did once there is one. An open line brings its toast
 * forward; a decided one unfolds to its whole text, and folds again.
 */
function ItemLineView({ item, summon }: { item: OpenItem; summon: (key: string) => void }) {
  const [whole, setWhole] = useState(false);
  const shown = itemLine(item);
  const open = shown.status === "open";
  /** The answer or decline reason, then what the action did. */
  const settled = [shown.answer && (shown.status === "declined" ? `“${shown.answer}”` : shown.answer), ...shown.outcome.map((o) => o.text)]
    .filter(Boolean).join(" · ");
  const time = new Date(item.at);
  return (
    <li className={`item-line ${shown.status}${whole ? " whole" : ""}`}>
      <button
        type="button"
        {...(open ? { "aria-controls": toastId(item.key) } : { "aria-expanded": whole })}
        title={open ? (shown.verb === "asked" ? "Answer it" : "Decide it") : undefined}
        onClick={() => (open ? summon(item.key) : setWhole(!whole))}
      >
        <span className="mark" aria-hidden="true" />
        <span className="who"><b>Lead</b>{` ${shown.verb}`}</span>
        <time dateTime={item.at} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        <span className="what">
          {shown.action !== undefined && <code>{shown.action}</code>}
          {shown.text}
        </span>
        <span className="where">
          <b>{STATUS[shown.status]}</b>
          {settled && <span className={shown.outcome.some((o) => o.error) ? "error" : undefined}>{settled}</span>}
          {shown.raw !== undefined && <span className="raw">{`heard “${shown.raw}”`}</span>}
        </span>
      </button>
    </li>
  );
}

/** A message's muted note: on its way, spoken, correcting an earlier one, or corrected since. */
function messageNote(card: Card & { kind: "message" }) {
  if (card.sending) return "sending…";
  const notes = [card.spoken && "spoke", card.corrects !== undefined && "corrects", card.superseded && "corrected below"];
  return notes.filter(Boolean).join(" · ") || undefined;
}

/** What a byline calls each speaker. */
const WHO: Record<Speaker, string> = { user: "You", lead: "Lead", "front-voice": "Front voice" };

/** Who wrote a card and when, then a muted note (such as "sending…") or, at its end, a Proposal's status. */
export function Byline({ who, at, note, status }: { who: Speaker; at: string; note?: string | undefined; status?: string }) {
  const time = new Date(at);
  return (
    <p className="byline">
      <b>{WHO[who]}</b>
      <time dateTime={at} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      {note && <span>{note}</span>}
      {status && <span className="status">{status}</span>}
    </p>
  );
}

/**
 * Where the user writes or talks to the Lead, side by side: Enter sends,
 * Shift+Enter starts a new line; what the talk button hears goes to the
 * Front voice, which answers it or hands it to the Lead. While the Lead is `working`, a conversation by voice shows it
 * thinking. The draft is the composer's own, so entries arriving never touch it.
 */
function Composer({ send, talk, working }: { send: SendText; talk: ReturnType<typeof useTalk>; working: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    void send(text);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendsOnEnter(e)) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div className="composer">
      <TalkStatus talk={talk} working={working} />
      <div className="composer-row">
        <form className="write" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea aria-label="Message to the Lead" placeholder="Write to the Lead" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <button type="submit" className="primary" disabled={!text.trim()}>Send</button>
        </form>
        <TalkButton talk={talk} />
      </div>
    </div>
  );
}
