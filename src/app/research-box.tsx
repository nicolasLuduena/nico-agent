import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { researchMessage } from "./lead";

/**
 * The Research button and its box: the question, and the Repo when the user
 * names one, sent to the Lead as the user's message marked as a research
 * request. The Lead writes the Research issue; the app writes nothing to a
 * Source (ADR-0007). Opening it moves focus to the question; Enter sends,
 * Shift+Enter starts a new line; Escape, a click elsewhere or focus leaving
 * it closes it, keeping the draft; sending closes it and clears it.
 */
export function ResearchBox({ send }: { send: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [repo, setRepo] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    field.current?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const submit = () => {
    if (!question.trim()) return;
    send(researchMessage(question, repo));
    setQuestion("");
    setRepo("");
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div
      className="research-menu"
      ref={box}
      onBlur={(e) => {
        if (open && !box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button type="button" ref={button} className="quiet" aria-expanded={open} aria-controls="research-box" onClick={() => setOpen(!open)}>
        Research
      </button>
      <form
        className="research-box"
        id="research-box"
        aria-label="Ask the Lead to research a question"
        hidden={!open}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <label>Question
          <textarea ref={field} rows={3} placeholder="What should be found out?" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={onKey} />
        </label>
        <label><span>Repo <span className="optional">(optional)</span></span>
          <input type="text" placeholder="owner/name" spellCheck={false} value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>
        <p className="lede">The Lead writes the Research issue and starts it.</p>
        <div className="buttons">
          <button type="submit" className="primary" disabled={!question.trim()}>Send to the Lead</button>
          <button type="button" onClick={() => { setOpen(false); button.current?.focus(); }}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
