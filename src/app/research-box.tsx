import { useState } from "react";
import { researchMessage } from "./lead";
import { sendsOnEnter, usePopover } from "./popover";

/**
 * The Research button and its box: the question, and the Repo when the user
 * names one, sent to the Lead as the user's message marked as a research
 * request. The Lead writes the Research issue; the app writes nothing to a
 * Source (ADR-0007). Opening it moves focus to the question; Enter sends,
 * Shift+Enter starts a new line; Escape, Cancel, a click elsewhere or focus
 * leaving it closes it, keeping the draft; sending closes it and clears it.
 */
export function ResearchBox({ send }: { send: (text: string) => void }) {
  const { open, toggle, close, wrapper, button } = usePopover((box) => box.querySelector("textarea"));
  const [question, setQuestion] = useState("");
  const [repo, setRepo] = useState("");
  const submit = () => {
    if (!question.trim()) return;
    send(researchMessage(question, repo));
    setQuestion("");
    setRepo("");
    close();
  };
  return (
    <div className="research" {...wrapper}>
      <button type="button" ref={button} className="quiet" aria-expanded={open} aria-controls="research-box" onClick={toggle}>
        Research
      </button>
      <form
        className="popover research-box"
        id="research-box"
        aria-label="Ask the Lead to research a question"
        hidden={!open}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <label>Question
          <textarea
            rows={3}
            placeholder="What should be found out?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (!sendsOnEnter(e)) return;
              e.preventDefault();
              submit();
            }}
          />
        </label>
        <label><span>Repo <span className="optional">(optional)</span></span>
          <input type="text" placeholder="owner/name" spellCheck={false} value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>
        <p className="lede">The Lead writes the Research issue and starts it.</p>
        <div className="buttons">
          <button type="submit" className="primary" disabled={!question.trim()}>Send to the Lead</button>
          <button type="button" onClick={close}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
