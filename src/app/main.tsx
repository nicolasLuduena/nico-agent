import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HarnessesJson } from "./actions";
import { askingItems } from "./asking";
import type { BoardJson } from "./board";
import { type LeadStatusJson, freshItems, openItems } from "./lead";
import { LeadMenu } from "./lead-menu";
import { Actions, useBoardActions } from "./forms";
import { LeadPanel, useConversation } from "./lead-panel";
import { PAGES, type Page, type PartnerJson, pageOf } from "./partner";
import { PartnerPanel } from "./partner-panel";
import { PARTNER_TABS, isPartnerTab } from "../partner-tabs";
import { ReposPane } from "./repos";
import { StatsPane } from "./stats-page";
import { useResource } from "./stream";
import { type ReposJson, repoSlugs } from "./sync";
import { SyncLine } from "./sync-line";
import { useTalk } from "./talk-button";
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

/** The page the address names (see `pageOf`), followed as it changes. */
function usePage(): Page {
  const [page, setPage] = useState(() => pageOf(location.hash));
  useEffect(() => {
    const changed = () => setPage(pageOf(location.hash));
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
 * The app: a header with the brand, the Lead's, the Partners' and the Stats pages, the count of
 * open questions, Proposals and Asking Implementers (which collapses or
 * expands their toasts) and the Lead's controls and the theme toggle, then
 * the Lead panel on the left and the page's own column on the right: the Repos on the Lead page, the
 * charts on the Stats page, and the toasts at the bottom right. A Partner's
 * page is its tab instead (ADR-0014); every page stays mounted while another
 * shows, so switching keeps each one's drafts and picks. The page has one
 * talk button's worth of voice, which follows the page: on a Partner's tab
 * it talks to that tab's Front voice and speaks only its replies, elsewhere
 * the Lead's. The Board, the Repos and the Partners are asked of `serve` on
 * load and again only when a Sync's `state-changed` names them; `serve`
 * answers from its Local state (ADR-0015), so the page never asks GitHub.
 */
function App() {
  const { harnesses, reload } = useHarnesses();
  const page = usePage();
  const { data: status = null } = useResource<LeadStatusJson>("/api/lead/status", ["lead-state"]);
  const { data: board = null } = useResource<BoardJson>("/api/board", [], ["board"]);
  // The Repos are config, read as it is, so the tabs and filters list them before any Sync ends.
  const repos = repoSlugs(useResource<ReposJson>("/api/repos", [], ["repos"]).data);
  const actions = useBoardActions(board ?? {}, harnesses, reload);
  const conversation = useConversation();
  const answered = useAnswered(board);
  const questions: ToastItem[] = [...openItems(conversation.state), ...askingItems(board, answered.questions)];
  const toasts = useToasts(questions);
  const partners = useResource<{ partners?: PartnerJson[] }>("/api/partners", ["partner-changed"], ["partners"]).data?.partners ?? [];
  const onPartner = page !== "lead" && page !== "stats";
  const voice = useResource<{ voice?: string }>("/api/voice/state", ["voice-changed"]).data?.voice === "on";
  const talking = useTalk(voice, isPartnerTab(page) ? page : "lead");
  return (
    <>
      <header className="top">
        <a className="brand" href="#/" aria-label="nico-agent">
          <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="8" /><path d="M8 8.5l4.5 4.5L8 17.5M14.5 17.5H19" /></svg>
          <span className="word">nico-agent</span>
        </a>
        <nav aria-label="Pages">
          {PAGES.map((p) => <a key={p.page} href={p.href} aria-current={page === p.page ? "page" : undefined}>{p.label}</a>)}
        </nav>
        <div className="top-end">
          <SyncLine />
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
      <main className={`shell ${page}`} hidden={onPartner}>
        <LeadPanel status={status} conversation={conversation} summon={toasts.summon} board={board} voice={voice} talking={talking} />
        {page === "stats" ? <StatsPane repos={repos} /> : <Actions.Provider value={actions}><ReposPane board={board} /></Actions.Provider>}
      </main>
      {PARTNER_TABS.map((tab) => (
        <PartnerPanel key={tab} tab={tab} partner={partners.find((p) => p.tab === tab)} harnesses={harnesses} repos={repos} hidden={page !== tab} talking={talking} />
      ))}
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
