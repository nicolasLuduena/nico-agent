import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HarnessesJson } from "./actions";
import type { BoardJson } from "./board";
import { type LeadStatusJson, openItems } from "./lead";
import { LeadMenu } from "./lead-menu";
import { LeadPanel, useConversation } from "./lead-panel";
import { ReposPane } from "./repos";
import { useResource } from "./stream";

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
 * The app: a header with the brand, the Lead and Stats pages, the count of
 * open questions and Proposals (which shows or hides the Questions list) and
 * the Lead's controls, then the Lead panel on the left and the page's own column
 * on the right: the Repos on the Lead page. The Board is asked of `serve` on
 * load and on each `board-changed`, and `serve` answers from its one-minute
 * cache (ADR-0011), so the page never asks GitHub more often than that.
 */
function App() {
  const { harnesses, reload: reloadHarnesses } = useHarnesses();
  const page = usePage();
  const { data: status = null } = useResource<LeadStatusJson>("/api/lead/status", ["lead-state"]);
  const { data: board = null } = useResource<BoardJson>("/api/board", ["board-changed"]);
  const conversation = useConversation();
  const questions = openItems(conversation.state);
  const [questionsShown, showQuestions] = useState(true);
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
            aria-expanded={questionsShown}
            aria-controls="questions"
            aria-label={`Questions, ${questions.length} open`}
            title={questionsShown ? "Hide the Questions list" : "Show the Questions list"}
            onClick={() => showQuestions(!questionsShown)}
          >
            Questions<b>{questions.length}</b>
          </button>
          <LeadMenu harnesses={harnesses} status={status} />
        </div>
      </header>
      <main className="shell">
        <LeadPanel status={status} conversation={conversation} questions={questionsShown ? questions : null} board={board} />
        {page === "stats"
          ? <Side title="Stats" lede="Merged PRs and issues defined per day will show here, counted from what nico-agent has seen." />
          : <ReposPane board={board} harnesses={harnesses} reloadHarnesses={reloadHarnesses} />}
      </main>
    </>
  );
}

/** The page's own column, beside the Lead panel. */
function Side({ title, lede }: { title: string; lede: string }) {
  return (
    <section className="side" aria-labelledby="side-title">
      <h1 id="side-title">{title}</h1>
      <p className="lede">{lede}</p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
