import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HarnessesJson } from "./actions";
import type { BoardJson } from "./board";
import { type LeadStatusJson, type OpenItem, openItems } from "./lead";
import { LeadMenu } from "./lead-menu";
import { Actions, useBoardActions } from "./forms";
import { LeadPanel, useConversation } from "./lead-panel";
import { ReposPane } from "./repos";
import { StatsPane } from "./stats-page";
import { useResource } from "./stream";
import { ThemeToggle } from "./theme-toggle";
import { Toasts } from "./toasts";

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
function useToasts(items: OpenItem[]) {
  const [shown, setShown] = useState(true);
  const [summoned, setSummoned] = useState<{ key: string } | null>(null);
  const known = useRef(new Set<string>());
  const keys = items.map((i) => i.key).join(" ");
  useEffect(() => {
    if (items.some((i) => !known.current.has(i.key))) setShown(true);
    known.current = new Set(items.map((i) => i.key));
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
 * The app: a header with the brand, the Lead and Stats pages, the count of
 * open questions and Proposals (which collapses or expands their toasts) and
 * the Lead's controls and the theme toggle, then the Lead panel on the left
 * and the page's own column on the right: the Repos on the Lead page, the
 * charts on the Stats page, and the toasts at the bottom right. The Board is asked of `serve` on load and on each
 * `board-changed`, and `serve` answers from its one-minute cache (ADR-0011),
 * so the page never asks GitHub more often than that.
 */
function App() {
  const { harnesses, reload } = useHarnesses();
  const page = usePage();
  const { data: status = null } = useResource<LeadStatusJson>("/api/lead/status", ["lead-state"]);
  const { data: board = null } = useResource<BoardJson>("/api/board", ["board-changed"]);
  const actions = useBoardActions(board ?? {}, harnesses, reload);
  const conversation = useConversation();
  const questions = openItems(conversation.state);
  const toasts = useToasts(questions);
  return (
    <>
      <header className="top">
        <a className="brand" href="#/">nico-agent</a>
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
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
