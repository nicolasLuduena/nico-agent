import { type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { Authored } from "../conversation";
import type { HarnessesJson, Outcome } from "./actions";
import { OutcomeNote, answerOf, post } from "./forms";
import {
  type Card, type Conversation, type LeadPicks, type LeadStatusJson, type ProposalJson,
  cards, declineArgs, leadChoice, leadControl, leadStartArgs, proposalLines, reduce, sayArgs,
} from "./lead";
import { LeadDrawer } from "./lead-drawer";
import { Agent } from "./repos";
import { useResource } from "./stream";
import { TalkButton, TalkStatus, useTalk } from "./talk-button";

const EMPTY: Conversation = { entries: [], proposals: [], sends: [] };

/**
 * The conversation with the Lead and its Proposals, refetched on
 * `conversation-entry` and `proposal-changed`, with the sends not in it yet.
 */
function useConversation() {
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
  return { state, send, dismiss: (key: string) => dispatch({ type: "dismiss", key }), failure: log.failure ?? proposals.failure };
}

/** An action of the panel's: busy while it runs, and the CLI's message and help when it failed, until the next try. */
function usePost() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** Post `args` to `path`; true when it did what it was asked. */
  const act = async (path: string, args: string[]) => {
    setBusy(true);
    setOutcome(null);
    const answer = answerOf(await post(path, args));
    setBusy(false);
    if (answer.failed) setOutcome(answer);
    return !answer.failed;
  };
  return { busy, outcome, act };
}

/** The Lead panel: the Lead's state and controls, the conversation as cards, and the composer. */
export function LeadPanel({ harnesses }: { harnesses: HarnessesJson | null }) {
  const { state, send, dismiss, failure } = useConversation();
  const [drawer, setDrawer] = useState(false);
  const voice = useResource<{ voice?: string }>("/api/voice/state", ["voice-changed"]).data?.voice === "on";
  const { data: status = null } = useResource<LeadStatusJson>("/api/lead/status", ["lead-state"]);
  const shown = cards(state);
  const scroller = useRef<HTMLOListElement>(null);
  // A new card brings the conversation to its end, unless the user scrolled up to read.
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const list = scroller.current;
    if (list && atEnd.current) list.scrollTop = list.scrollHeight;
  }, [shown.length, drawer]);
  return (
    <aside className="lead-panel" aria-label="Lead">
      <LeadHead harnesses={harnesses} status={status} drawer={drawer} onDrawer={setDrawer} voice={voice} />
      {failure && <p className="error" role="status">{failure}</p>}
      <LeadDrawer open={drawer} />
      <ol
        className="conversation"
        hidden={drawer}
        ref={scroller}
        aria-live="polite"
        onScroll={(e) => {
          const list = e.currentTarget;
          atEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        }}
      >
        {shown.length
          ? shown.map((card) => <CardView key={card.key} card={card} send={send} dismiss={dismiss} />)
          : <li className="empty">No conversation yet. Write to the Lead below; it reads your message when it next looks at its Inbox.</li>}
      </ol>
      <Composer send={send} voice={voice} working={status?.lead === "running" && status.state === "working"} />
    </aside>
  );
}

/**
 * The Lead's Agent state, launch and failure, live, with Start, Restart and
 * Stop on the picked launch, the Voice switch, and the button opening the
 * drawer in place of the conversation.
 */
function LeadHead({ harnesses, status, drawer, onDrawer, voice }: { harnesses: HarnessesJson | null; status: LeadStatusJson | null; drawer: boolean; onDrawer: (open: boolean) => void; voice: boolean }) {
  const [chosen, setChosen] = useState<LeadPicks>({});
  const { busy, outcome, act: post } = usePost();
  const choice = harnesses && leadChoice(harnesses, status, chosen);
  const { start, stop } = leadControl(status, choice);
  // Once the Lead runs on the picks, they follow it again.
  const act = async (path: string, args: string[]) => {
    if (await post(path, args)) setChosen({});
  };
  const running = status?.lead === "running";
  const launch = status?.harness && `${status.harness} · ${status.model} · ${status.effort}`;
  return (
    <header className="lead-head">
      <div className="lead-line">
        <h2>Lead</h2>
        <label className="voice-switch" title={voice ? "The Lead's replies are spoken, and it talks for the ear" : "Speak the Lead's replies, and have it talk for the ear"}>
          <input type="checkbox" role="switch" checked={voice} disabled={busy} onChange={(e) => void post(e.target.checked ? "/api/voice/on" : "/api/voice/off", [])} />
          Voice
        </label>
        <button type="button" className="drawer-toggle" aria-expanded={drawer} aria-controls="lead-drawer" onClick={() => onDrawer(!drawer)}>
          {drawer ? "Conversation" : "Intent & orders"}
        </button>
      </div>
      <div className="lead-status">
        {running ? <Agent role="lead" state={status.state ?? "unknown"} /> : <span className={`lead-state${status?.failure ? " error" : ""}`}>{status?.lead ?? "…"}</span>}
        {launch && <span className="chip" title={launch}>{launch}</span>}
      </div>
      {status?.failure && <p className="error">{status.failure.error}</p>}
      {status?.warnings?.map((w) => <p key={w} className="warning">{w}</p>)}
      <form
        className="lead-controls"
        onSubmit={(e) => {
          e.preventDefault();
          if (choice && start) void act("/api/lead/start", leadStartArgs(choice, window.location.port));
        }}
      >
        {choice
          ? (
            <>
              <select name="harness" aria-label="Harness" value={choice.harness} onChange={(e) => setChosen({ harness: e.target.value })}>
                {choice.harnesses.map((h) => <option key={h}>{h}</option>)}
              </select>
              <select name="model" aria-label="Model" value={choice.model} onChange={(e) => setChosen({ ...chosen, harness: choice.harness, model: e.target.value, effort: undefined })}>
                {choice.models.map((m) => <option key={m}>{m}</option>)}
              </select>
              <select name="effort" aria-label="Effort" value={choice.effort} onChange={(e) => setChosen({ ...chosen, harness: choice.harness, model: choice.model, effort: e.target.value })}>
                {choice.efforts.map((f) => <option key={f}>{f}</option>)}
              </select>
              {start && <button type="submit" disabled={busy}>{start}</button>}
            </>
          )
          : <span className="loading">{harnesses ? "No Harness offers a model" : "Loading Harnesses…"}</span>}
        {stop && <button type="button" className="close" disabled={busy} onClick={() => void act("/api/lead/stop", [])}>Stop</button>}
      </form>
      {outcome && <OutcomeNote outcome={outcome} />}
    </header>
  );
}

/** Send a message to the Lead, or the answer to its question `question`; `raw` is what was heard of a spoken one. */
type SendText = (text: string, question?: number, raw?: string) => Promise<void>;

function CardView({ card, send, dismiss }: { card: Card; send: SendText; dismiss: (key: string) => void }) {
  switch (card.kind) {
    case "message":
      return (
        <li className={`card-message ${card.who}${card.sending ? " sending" : ""}${card.superseded ? " superseded" : ""}`}>
          <Byline who={card.who} at={card.at} note={messageNote(card)} />
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
      return <QuestionCard card={card} send={send} dismiss={dismiss} />;
    case "proposal":
      return <ProposalCard card={card} />;
  }
}

/** A message's muted note: on its way, spoken, correcting an earlier one, or corrected since. */
function messageNote(card: Card & { kind: "message" }) {
  if (card.sending) return "sending…";
  const notes = [card.spoken && "spoke", card.corrects !== undefined && "corrects", card.superseded && "corrected below"];
  return notes.filter(Boolean).join(" · ") || undefined;
}

/** Who wrote a card and when, then a muted note (such as "sending…") or, at its end, a Proposal's status. */
function Byline({ who, at, note, status }: { who: "user" | "lead"; at: string; note?: string | undefined; status?: string }) {
  const time = new Date(at);
  return (
    <p className="byline">
      <b>{who === "user" ? "You" : "Lead"}</b>
      <time dateTime={at} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      {note && <span>{note}</span>}
      {status && <span className="status">{status}</span>}
    </p>
  );
}

/** A question from the Lead: its choices as buttons and a free-text answer while open, then the answer. */
function QuestionCard({ card, send, dismiss }: { card: Card & { kind: "question" }; send: SendText; dismiss: (key: string) => void }) {
  const [text, setText] = useState("");
  const answer = (value: string) => {
    if (card.failure) dismiss(card.failure.key);
    void send(value, card.id);
  };
  return (
    <li className={`card-question${card.answer ? " answered" : ""}`}>
      <Byline who="lead" at={card.at} note="asks" />
      <p className="text">{card.text}</p>
      {card.answer
        ? (
          <>
            <p className="answer"><span>{card.answer.sending ? "Answering" : "You answered"}</span>{card.answer.text}</p>
            {card.answer.raw !== undefined && <p className="raw"><span>Heard</span>{card.answer.raw}</p>}
          </>
        )
        : (
          <>
            {card.choices.length > 0 && (
              <div className="choices">
                {card.choices.map((c) => <button key={c} type="button" onClick={() => answer(c)}>{c}</button>)}
              </div>
            )}
            <form
              className="free-answer"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                answer(text);
                setText("");
              }}
            >
              <input type="text" aria-label={`Answer question ${card.id}`} placeholder={card.choices.length ? "Or answer in your words" : "Your answer"} value={text} onChange={(e) => setText(e.target.value)} />
              <button type="submit" disabled={!text.trim()}>Answer</button>
            </form>
            {card.failure && <p className="error">{`“${card.failure.text}” was not sent: ${card.failure.error}`}</p>}
          </>
        )}
    </li>
  );
}

const STATUS: Record<ProposalJson["status"], string> = { open: "Proposes", approved: "Approved", declined: "Declined", failed: "Failed" };

/** A Proposal: its action or write and reason with Approve and Decline while open, then how it was decided and what it did. */
function ProposalCard({ card }: { card: Card & { kind: "proposal" } }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, outcome, act } = usePost();
  const open = card.status === "open";
  const decline = async (e: FormEvent) => {
    e.preventDefault();
    if (await act("/api/proposals/decline", declineArgs(card.id, reason))) setDeclining(false);
  };
  const lines = proposalLines(card);
  return (
    <li className={`card-proposal ${card.status}`}>
      <Byline who="lead" at={card.at} status={STATUS[card.status]} />
      {card.write
        ? (
          <>
            <p className="action">{"Write to "}<code>{card.write.repo}</code>{"’s Source"}</p>
            <pre className="write" tabIndex={0} aria-label="What the Lead would write">{card.write.text}</pre>
          </>
        )
        : <p className="action"><code>{card.action}</code></p>}
      <p className="text">{card.reason}</p>
      {card.declineReason && <p className="decided">{`You said: ${card.declineReason}`}</p>}
      {lines.length > 0 && <div className="outcome">{lines.map((l, i) => <p key={i} className={l.error ? "error" : undefined}>{l.text}</p>)}</div>}
      {open && !declining && (
        <div className="buttons">
          <button type="button" className="approve" disabled={busy} onClick={() => void act("/api/proposals/approve", [String(card.id)])}>{busy ? (card.write ? "Approving…" : "Running…") : "Approve"}</button>
          <button type="button" disabled={busy} onClick={() => setDeclining(true)}>Decline</button>
        </div>
      )}
      {open && declining && (
        <form className="decline" onSubmit={(e) => void decline(e)}>
          <input type="text" aria-label="Why you decline (optional)" placeholder="Why, for the Lead (optional)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <button type="submit" disabled={busy}>Decline</button>
          <button type="button" disabled={busy} onClick={() => setDeclining(false)}>Cancel</button>
        </form>
      )}
      {open && outcome && <OutcomeNote outcome={outcome} />}
    </li>
  );
}

/**
 * Where the user writes or talks to the Lead: Enter sends, Shift+Enter starts
 * a new line; the talk button sends the Scribe's text, keeping what it heard,
 * as the answer to the Lead's question when said right after it. With `voice`
 * on, the Lead is heard here too; while the Lead is `working`, a conversation
 * by voice shows it thinking.
 */
function Composer({ send, voice, working }: { send: SendText; voice: boolean; working: boolean }) {
  const [text, setText] = useState("");
  const talking = useTalk((text, heard, answers) => void send(text, answers, heard), voice);
  const submit = () => {
    if (!text.trim()) return;
    void send(text);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <>
      <TalkStatus talk={talking} working={working} />
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea aria-label="Message to the Lead" placeholder="Write to the Lead" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        <TalkButton talk={talking} />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </>
  );
}
