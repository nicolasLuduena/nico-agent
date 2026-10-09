import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HarnessesJson } from "./actions";
import { askingItems } from "./asking";
import type { BoardJson } from "./board";
import { type LeadStatusJson, freshItems, openItems } from "./lead";
import { LeadMenu } from "./lead-menu";
import { Actions, useBoardActions } from "./forms";
import { LeadPanel, useConversation } from "./lead-panel";
import { ReposPane } from "./repos";
import { StatsPane } from "./stats-page";
import { useResource } from "./stream";
import { ThemeToggle } from "./theme-toggle";
import { type ToastItem, Toasts } from "./toasts";

/** The Harnesses' models and the remembered launch, for the Lead's pickers, asked on load and again on `reload`. */
function useHarnesses() {
  const [harnesses, setHarnesses] = useState<HarnessesJson | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let current = true;
    fetch("/api/harnesses").then((r) => r.json() as Promise<HarnessesJson>).then((json) => { if (current) setHarnesses(json); }).catch(() => {});
    return () => { current = false; };
  }, [asked]);
  return { harnesses, reload: useCallback(() => setAsked((n) => n + 1), []) };
}

type Page = "lead" | "stats";

const PAGES: { page: Page; label: string; href: string }[] = [
  { page: "lead", label: "Lead", href: "#/" },
  { page: "stats", label: "Stats", href: "#/stats" },
];

/** The page the address names: `#/stats` is Stats, anything else the Lead. */
function usePage(): Page {
  const read = (): Page => (location.hash === "#/stats" ? "stats" : "lead");
  const [page, setPage] = useState(read);
  useEffect(() => {
    const changed = () => setPage(read());
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return page;
}

/**
 * Whether the toasts show: from the start, and again whenever a new item
 * arrives; the header's Questions count collapses and expands them, and an
 * open item's line in the conversation summons its toast, expanding them.
 */
function useToasts(items: ToastItem[]) {
  const [shown, setShown] = useState(true);
  const [summoned, setSummoned] = useState<{ key: string } | null>(null);
  const before = useRef<ToastItem[]>([]);
  const keys = items.map((i) => i.key).join(" ");
  useEffect(() => {
    if (freshItems(before.current, items).length) setShown(true);
    before.current = items;
  }, [keys]);
  return {
    shown, summoned,
    toggle: () => setShown(!shown),
    summon: (key: string) => {
      setShown(true);
      setSummoned({ key });
    },
  };
}

/**
 * The question each Asking Implementer was answered on from its toast, so the
 * toast leaves at once; each is forgotten once the Board shows that
 * Implementer no longer Asking, so the same question asked again shows again.
 */
function useAnswered(board: BoardJson | null) {
  const [questions, setQuestions] = useState<Record<string, string>>({});
  useEffect(() => {
    const asking = new Set(board?.asking?.flatMap((a) => (a.issue === undefined ? [] : [a.issue])));
    setQuestions((q) => {
      const kept = Object.entries(q).filter(([issue]) => asking.has(issue));
      return kept.length === Object.keys(q).length ? q : Object.fromEntries(kept);
    });
  }, [board]);
  return { questions, add: useCallback((issue: string, question: string) => setQuestions((q) => ({ ...q, [issue]: question })), []) };
}

/**
 * The app: a header with the brand, the Lead and Stats pages, the count of
 * open questions, Proposals and Asking Implementers (which collapses or
 * expands their toasts) and the Lead's controls and the theme toggle, then
 * the Lead panel on the left and the page's own column on the right: the Repos on the Lead page, the
 * charts on the Stats page, and the toasts at the bottom right. The Board is
 * asked of `serve` on load and on each `board-changed`, and `serve` answers
 * from its one-minute cache (ADR-0011), so the page never asks GitHub more
 * often than that.
 */
function App() {
  const { harnesses, reload } = useHarnesses();
  const page = usePage();
  const { data: status = null } = useResource<LeadStatusJson>("/api/lead/status", ["lead-state"]);
  const { data: board = null } = useResource<BoardJson>("/api/board", ["board-changed"]);
  const actions = useBoardActions(board ?? {}, harnesses, reload);
  const conversation = useConversation();
  const answered = useAnswered(board);
  const questions: ToastItem[] = [...openItems(conversation.state), ...askingItems(board, answered.questions)];
  const toasts = useToasts(questions);
  return (
    <>
      <header className="top">
        <a className="brand" href="#/" aria-label="nico-agent">
          <svg className="mark" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="8" /><path d="M8 8.5l4.5 4.5L8 17.5M14.5 17.5H19" /></svg>
          <span className="word">nico-agent</span>
        </a>
        <nav aria-label="Pages">
          {PAGES.map((p) => <a key={p.page} href={p.href} aria-current={page === p.page ? "page" : undefined}>{p.label}</a>)}
        </nav>
        <div className="top-end">
          <button
            type="button"
            className={`questions-count${questions.length ? " waiting" : ""}`}
            aria-expanded={toasts.shown && questions.length > 0}
            aria-controls="questions"
            aria-label={`Questions, ${questions.length} open`}
            title={!questions.length ? "Nothing waits on you" : toasts.shown ? "Collapse the questions" : "Expand the questions"}
            onClick={toasts.toggle}
          >
            <span className="label">Questions</span><b>{questions.length}</b>
          </button>
          <ThemeToggle />
          <LeadMenu harnesses={harnesses} status={status} />
        </div>
      </header>
      <main className={`shell ${page}`}>
        <LeadPanel status={status} conversation={conversation} summon={toasts.summon} board={board} />
        {page === "stats" ? <StatsPane /> : <Actions.Provider value={actions}><ReposPane board={board} /></Actions.Provider>}
      </main>
      <Toasts
        items={questions}
        shown={toasts.shown}
        loaded={conversation.loaded}
        summoned={toasts.summoned}
        send={conversation.send}
        dismiss={conversation.dismiss}
        markAnswered={answered.add}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
