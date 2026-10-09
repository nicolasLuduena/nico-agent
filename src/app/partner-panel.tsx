import { type KeyboardEvent, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { PARTNER_NAMES, type PartnerTab } from "../partner-tabs";
import type { ThreadEntry } from "../thread";
import { type Chosen, type HarnessesJson, launchChoice } from "./actions";
import { OutcomeNote, answerOf, post, usePost } from "./forms";
import { followsNewEntries } from "./lead";
import {
  DRAFT_REQUESTS, type PartnerJson, type ThreadCard, type ThreadState,
  handOffArgs, partnerSayArgs, partnerStanding, partnerStartArgs, reduceThread, threadCards,
} from "./partner";
import { sendsOnEnter } from "./popover";
import { Agent } from "./repos";
import { useResource } from "./stream";

/** What each tab's Partner is for, under its name. */
const LEDES: Record<PartnerTab, string> = {
  review: "Talk a PR through with an agent that knows only its Repo. Nothing reaches the Lead until you hand it a summary.",
  idea: "Think a problem through with an agent reading the Repo's code. Nothing reaches the Lead until you hand it a summary.",
};

/**
 * A Partner's tab (ADR-0014): its Thread with the composer on the left, or
 * the form that starts one, and on the right what it is for and the Partner itself. Each tab
 * stays mounted while another shows, so its draft and picks are kept.
 */
export function PartnerPanel({ tab, partner, harnesses, repos, hidden }: {
  tab: PartnerTab; partner: PartnerJson | undefined; harnesses: HarnessesJson | null; repos: string[]; hidden: boolean;
}) {
  const title = PARTNER_NAMES[tab];
  const standing = partnerStanding(partner);
  return (
    <main className="shell partner" hidden={hidden} aria-label={title}>
      <section className="lead-panel thread-panel" aria-label={`Thread with the ${title}`}>
        <div className="lead-bar">
          <h1>{title}</h1>
          {partner && <Agent role={partner.repo} state={standing === "running" ? partner.state : partner.partner} />}
        </div>
        {/* A new Partner starts a new Thread, so its tab starts afresh. */}
        {partner ? <Thread key={partner.startedAt} tab={tab} running={standing === "running"} /> : (
          <div className="conversation">
            <div className="empty partner-empty">
              <h2>{`Start the ${title}`}</h2>
              <p>Pick the Repo it works in and its launch; its Thread shows here.</p>
              <StartForm tab={tab} harnesses={harnesses} repos={repos} />
            </div>
          </div>
        )}
      </section>
      <aside className="side partner-side">
        <h1>{title}</h1>
        <p className="lede">{LEDES[tab]}</p>
        {partner && <PartnerFacts tab={tab} partner={partner} harnesses={harnesses} />}
      </aside>
    </main>
  );
}

/** The Thread of the tab's Partner, refetched on `partner-changed`, with the sends not in it yet. */
function useThread(tab: PartnerTab) {
  const log = useResource<{ entries?: ThreadEntry[] }>(`/api/partner/log?tab=${tab}`, ["partner-changed"]);
  const [state, dispatch] = useReducer(reduceThread, { entries: [], sends: [] } satisfies ThreadState);
  useEffect(() => dispatch({ type: "log", entries: log.data?.entries }), [log.data]);
  const sent = useRef(0);
  const send = async (text: string) => {
    const key = `send-${++sent.current}`;
    dispatch({ type: "send", key, text, at: new Date().toISOString() });
    const json = await post("/api/partner/say", partnerSayArgs(tab, text));
    if (typeof json?.said === "number") dispatch({ type: "sent", key, id: json.said });
    else dispatch({ type: "failed", key, error: answerOf(json).lines[0]?.text ?? "the message was not sent" });
  };
  return { state, send, dismiss: (key: string) => dispatch({ type: "dismiss", key }), failure: log.failure };
}

function Thread({ tab, running }: { tab: PartnerTab; running: boolean }) {
  const { state, send, dismiss, failure } = useThread(tab);
  const cards = threadCards(state);
  const scroller = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const list = scroller.current;
    if (list && atEnd.current) list.scrollTop = list.scrollHeight;
  });
  const sendAndFollow = (text: string) => {
    atEnd.current = true;
    return send(text);
  };
  const drafting = cards.some((c) => c.kind === "draft" && c.status === "open");
  return (
    <>
      {failure && <div className="notices" role="status"><p>{failure}</p></div>}
      <ol className="conversation" ref={scroller} aria-live="polite" aria-label="Thread" tabIndex={0} onScroll={(e) => { atEnd.current = followsNewEntries(e.currentTarget); }}>
        {cards.length
          ? cards.map((card) => <ThreadCardView key={card.key} tab={tab} card={card} send={send} dismiss={dismiss} />)
          : (
            <li className="empty">
              <h2>Say hello</h2>
              <p>Write below: your message goes to the Partner, and its replies show here. When you've settled something, ask it for a hand-off.</p>
            </li>
          )}
      </ol>
      <div className="composer">
        <div className="composer-row">
          <Composer tab={tab} send={sendAndFollow} disabled={!running} />
          <button type="button" className="quiet" disabled={!running || drafting} title={drafting ? "Its draft is waiting for you above" : "Ask the Partner for a summary to hand to the Lead"} onClick={() => void sendAndFollow(DRAFT_REQUESTS[tab])}>
            Draft a hand-off
          </button>
        </div>
      </div>
    </>
  );
}

function ThreadCardView({ tab, card, send, dismiss }: { tab: PartnerTab; card: ThreadCard; send: (text: string) => Promise<void>; dismiss: (key: string) => void }) {
  if (card.kind === "draft") return <DraftCard tab={tab} card={card} />;
  const time = new Date(card.at);
  return (
    <li className={`card-message ${card.who === "user" ? "user" : "lead"}${card.sending ? " sending" : ""}`}>
      <p className="byline">
        <b>{card.who === "user" ? "You" : "Partner"}</b>
        <time dateTime={card.at} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        {card.sending && <span>sending…</span>}
      </p>
      <p className="text">{card.text}</p>
      {card.error && (
        <div className="send-failure">
          <p className="error">{card.error}</p>
          <button type="button" onClick={() => { dismiss(card.key); void send(card.text); }}>Send again</button>
          <button type="button" onClick={() => dismiss(card.key)}>Dismiss</button>
        </div>
      )}
    </li>
  );
}

/**
 * A Hand-off draft: open, the user edits it in place and hands it to the
 * Lead; replaced by a later draft, or handed, it is only shown.
 */
function DraftCard({ tab, card }: { tab: PartnerTab; card: Extract<ThreadCard, { kind: "draft" }> }) {
  const [text, setText] = useState(card.text);
  const { busy, outcome, act } = usePost();
  const status = { open: "Waiting for you", replaced: "Replaced by a later draft", handed: "Handed to the Lead" }[card.status];
  return (
    <li className={`card-proposal card-draft ${card.status}`}>
      <p className="byline"><b>Hand-off draft</b><span className="status">{status}</span></p>
      {card.status === "open" ? (
        <form className="draft" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void act("/api/partner/hand-off", handOffArgs(tab, card, text)); }}>
          <textarea aria-label="The hand-off, as the Lead will read it" value={text} rows={6} onChange={(e) => setText(e.target.value)} />
          <div className="buttons">
            <button type="submit" className="approve" disabled={busy || !text.trim()}>Hand to the Lead</button>
            {text !== card.text && <button type="button" disabled={busy} onClick={() => setText(card.text)}>Undo my edits</button>}
          </div>
        </form>
      ) : <pre className="write">{card.handed ?? card.text}</pre>}
      {outcome && <OutcomeNote outcome={outcome} />}
    </li>
  );
}

/** Where the user writes to the Partner: Enter sends, Shift+Enter starts a new line; the draft is kept across tabs. */
function Composer({ tab, send, disabled }: { tab: PartnerTab; send: (text: string) => Promise<void>; disabled: boolean }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim() || disabled) return;
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
    <form className="write" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea aria-label={`Message to the ${PARTNER_NAMES[tab]}`} placeholder={disabled ? "The Partner is not running" : "Write to the Partner"} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <button type="submit" className="primary" disabled={disabled || !text.trim()}>Send</button>
    </form>
  );
}

/** The Partner's Repo and launch, with End, and Start again when it stopped short. */
function PartnerFacts({ tab, partner, harnesses }: { tab: PartnerTab; partner: PartnerJson; harnesses: HarnessesJson | null }) {
  const { busy, outcome, act } = usePost();
  const stopped = partnerStanding(partner) === "stopped";
  const choice = harnesses && launchChoice(harnesses, partner);
  return (
    <>
      <dl className="partner-facts">
        <dt>Repo</dt><dd className="mono">{partner.repo}</dd>
        <dt>Launch</dt><dd className="mono">{`${partner.harness} · ${partner.model} · ${partner.effort}`}</dd>
        <dt>Agent</dt><dd className="mono">{partner.agent}</dd>
        {partner.failure && (<><dt>Failed</dt><dd className="error">{`at ${partner.failure.step}: ${partner.failure.error}`}</dd></>)}
      </dl>
      <div className="buttons">
        {stopped && choice && (
          <button type="button" className="primary" disabled={busy} onClick={() => void act("/api/partner/start", partnerStartArgs(tab, partner.repo, choice, window.location.port))}>Start again</button>
        )}
        <button type="button" className="close" disabled={busy} title="Stop its agent and remove its worktree; the Thread's file is kept" onClick={() => void act("/api/partner/end", [tab])}>End</button>
      </div>
      {outcome && <OutcomeNote outcome={outcome} />}
    </>
  );
}

/** The form that starts the tab's Partner: the Repo, then Harness, model and Effort, from the last launch. */
function StartForm({ tab, harnesses, repos }: { tab: PartnerTab; harnesses: HarnessesJson | null; repos: string[] }) {
  const [chosen, setChosen] = useState<Chosen & { repo?: string }>({});
  const { busy, outcome, act } = usePost();
  const choice = harnesses && launchChoice(harnesses, chosen);
  const repo = chosen.repo && repos.includes(chosen.repo) ? chosen.repo : repos[0];
  const select = (name: string, label: string, value: string, options: string[], pick: (value: string) => void) => (
    <label>{label}
      <select name={name} value={value} onChange={(e) => pick(e.target.value)}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
  return (
    <form className="partner-start" onSubmit={(e) => { e.preventDefault(); if (choice && repo) void act("/api/partner/start", partnerStartArgs(tab, repo, choice, window.location.port)); }}>
      {repo ? select("repo", "Repo", repo, repos, (r) => setChosen({ ...chosen, repo: r })) : <p className="loading">No Repo yet: add one with `nico-agent repo add`</p>}
      {choice
        ? (
          <>
            {select("harness", "Harness", choice.harness, choice.harnesses, (h) => setChosen({ repo: chosen.repo, harness: h }))}
            {select("model", "Model", choice.model, choice.models, (m) => setChosen({ ...chosen, harness: choice.harness, model: m, effort: undefined }))}
            {select("effort", "Effort", choice.effort, choice.efforts, (f) => setChosen({ ...chosen, harness: choice.harness, model: choice.model, effort: f }))}
          </>
        )
        : <p className="loading">{harnesses ? "No Harness offers a model" : "Loading Harnesses…"}</p>}
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy || !choice || !repo}>{busy ? "Starting…" : "Start"}</button>
      </div>
      {outcome && <OutcomeNote outcome={outcome} />}
    </form>
  );
}
