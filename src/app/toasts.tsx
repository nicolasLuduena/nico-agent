import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { OutcomeNote, usePost } from "./forms";
import { type OpenItem, type ProposalJson, declineArgs } from "./lead";
import { Byline, type SendText } from "./lead-panel";

/** The id of an item's toast, which its line in the conversation brings forward. */
export const toastId = (key: string) => `toast-${key}`;

/**
 * The Questions list as toasts at the bottom right of every page: each open
 * question and Proposal of the Lead's, oldest nearest the corner, answered or
 * decided right on it; hidden while `shown` is false. The stack scrolls past
 * a modest height. A toast answered or decided from the keyboard hands focus
 * to the next one, or to the conversation once none is left. A new toast is
 * announced politely; those there on load are not. `summoned` asks for a
 * toast to come forward and take focus: each ask is a new object, so asking
 * for the same toast again brings it forward again.
 */
export function Toasts({ items, shown, loaded, summoned, send, dismiss }: {
  items: OpenItem[]; shown: boolean; loaded: boolean; summoned: { key: string } | null;
  send: SendText; dismiss: (key: string) => void;
}) {
  const stack = useRef<HTMLElement>(null);
  // Read while rendering, before a toast that leaves takes the focus with it.
  const focused = stack.current?.contains(document.activeElement) ?? false;
  const keys = items.map((i) => i.key).join(" ");
  useLayoutEffect(() => {
    const section = stack.current;
    if (!focused || !section || section.contains(document.activeElement)) return;
    // The focused toast left: the next one takes focus, or the conversation once none is left.
    const next = section.querySelector<HTMLElement>("li :is(button, input):not(:disabled)")
      ?? document.querySelector<HTMLElement>(".conversation:not([hidden])")
      ?? document.querySelector<HTMLElement>(".composer textarea");
    next?.focus();
  }, [keys]);
  useEffect(() => {
    if (!summoned) return;
    const toast = document.getElementById(toastId(summoned.key));
    if (!toast) return;
    toast.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    toast.focus({ preventScroll: true });
  }, [summoned]);
  const announced = useAnnouncement(items, loaded);
  return (
    <>
      <p className="visually-hidden" role="status" aria-live="polite">{announced}</p>
      <section id="questions" className="toasts" aria-label="Questions" ref={stack} hidden={!shown || !items.length}>
        <ol>
          {items.map((item) => item.kind === "question"
            ? <QuestionToast key={item.key} card={item} send={send} dismiss={dismiss} />
            : <ProposalToast key={item.key} card={item} />)}
        </ol>
      </section>
    </>
  );
}

/** What a screen reader hears of the newest toast: the Lead's question or Proposal, once the conversation has loaded. */
function useAnnouncement(items: OpenItem[], loaded: boolean) {
  const seen = useRef<Set<string> | null>(null);
  const [announced, setAnnounced] = useState("");
  const keys = items.map((i) => i.key).join(" ");
  useEffect(() => {
    if (!loaded) return;
    // What was open when the page loaded is no news.
    if (!seen.current) {
      seen.current = new Set(items.map((i) => i.key));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.key));
    for (const i of fresh) seen.current.add(i.key);
    const newest = fresh.at(-1);
    if (newest) setAnnounced(newest.kind === "question" ? `The Lead asks: ${newest.text}` : `The Lead proposes: ${newest.reason}`);
  }, [keys, loaded]);
  return announced;
}

/** A question's toast: its choices as buttons and a free-text answer, and why an answer was not sent. */
function QuestionToast({ card, send, dismiss }: { card: OpenItem & { kind: "question" }; send: SendText; dismiss: (key: string) => void }) {
  const [text, setText] = useState("");
  const answer = (value: string) => {
    if (card.failure) dismiss(card.failure.key);
    void send(value, card.id);
  };
  return (
    <li id={toastId(card.key)} tabIndex={-1} className="toast card-question">
      <Byline who="lead" at={card.at} note="asks" />
      <p className="text">{card.text}</p>
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
    </li>
  );
}

/** A Proposal's toast: its action or write and reason, with Approve and Decline, which opens an optional reason. */
function ProposalToast({ card }: { card: OpenItem & { kind: "proposal" } & ProposalJson }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, outcome, act } = usePost();
  const decline = async (e: FormEvent) => {
    e.preventDefault();
    if (await act("/api/proposals/decline", declineArgs(card.id, reason))) setDeclining(false);
  };
  return (
    <li id={toastId(card.key)} tabIndex={-1} className="toast card-proposal open">
      <Byline who="lead" at={card.at} status="Proposes" />
      {card.write
        ? (
          <>
            <p className="action">{"Write to "}<code>{card.write.repo}</code>{"’s Source"}</p>
            <pre className="write" tabIndex={0} aria-label="What the Lead would write">{card.write.text}</pre>
          </>
        )
        : <p className="action"><code>{card.action}</code></p>}
      <p className="text">{card.reason}</p>
      {!declining
        ? (
          <div className="buttons">
            <button type="button" className="approve" disabled={busy} onClick={() => void act("/api/proposals/approve", [String(card.id)])}>{busy ? (card.write ? "Approving…" : "Running…") : "Approve"}</button>
            <button type="button" disabled={busy} onClick={() => setDeclining(true)}>Decline</button>
          </div>
        )
        : (
          <form className="decline" onSubmit={(e) => void decline(e)}>
            <input type="text" aria-label="Why you decline (optional)" placeholder="Why, for the Lead (optional)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            <button type="submit" disabled={busy}>Decline</button>
            <button type="button" disabled={busy} onClick={() => setDeclining(false)}>Cancel</button>
          </form>
        )}
      {outcome && <OutcomeNote outcome={outcome} />}
    </li>
  );
}
