import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Chosen, type HarnessesJson, type Outcome, canReview, harnessWarnings } from "./actions";
import { type BoardJson, type InFlightDispatch, agentClass, prOf, repoSections } from "./board";
import { EventDisplay, reducedMotion } from "./event-display";
import { ActionBar, Actions, type BoardActions, CloseButton, IssueOutcome, LaunchForm, Pick, RetryButton, TopActions } from "./forms";
import { installPreviews } from "./preview";
import { BaseChip, IssueLink, PrLink, Repo, StageKey } from "./repos";

/** The Board, fetched on load, on each `board-changed`, and on reconnecting to `serve`, with when it was sampled. */
function useBoard() {
  const [loaded, setLoaded] = useState<{ board: BoardJson; sampled: Date } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let latest = 0;
    const load = async () => {
      // A slow answer must not overwrite a newer one.
      const request = ++latest;
      try {
        const response = await fetch("/api/board");
        const json = (await response.json()) as BoardJson;
        if (request !== latest) return;
        setLoaded({ board: json, sampled: new Date() });
        setFailure(null);
      } catch {
        if (request === latest) setFailure("Could not reach nico-agent serve; retrying.");
      }
    };
    const events = new EventSource("/api/events");
    // `open` fires on the first connection and after each reconnection, such as a restarted serve.
    events.addEventListener("open", load);
    events.addEventListener("board-changed", load);
    events.addEventListener("error", () => setFailure("Lost nico-agent serve; reconnecting."));
    return () => events.close();
  }, []);
  return { ...loaded, failure };
}

/** Whether the Board offers a launch, so its forms need the Harnesses' models. */
function launchable(board: BoardJson | undefined) {
  return Boolean(board?.issues?.length || board?.stackable?.length || board?.dispatches?.some(canReview));
}

/**
 * The Harnesses' models and the remembered launch, asked once the Board has
 * something to launch (discovery may run a Harness's CLI), and again on `reload`.
 */
function useHarnesses(needed: boolean) {
  const [harnesses, setHarnesses] = useState<HarnessesJson | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!needed) return;
    let current = true;
    fetch("/api/harnesses").then((r) => r.json() as Promise<HarnessesJson>).then((json) => { if (current) setHarnesses(json); }).catch(() => {});
    return () => { current = false; };
  }, [needed, asked]);
  return { harnesses, reload: useCallback(() => setAsked((n) => n + 1), []) };
}

/** An In-flight row's DOM id, so a clicked track can bring it into view. */
const flightId = (issue: string) => `flight-${issue.replace(/[^\w-]/g, "-")}`;

function App() {
  const { board, sampled, failure } = useBoard();
  // The issue whose track and rows are lit, as the pointer rests on one of them.
  const [lit, setLit] = useState<string | null>(null);
  // Kept here, above every row, so a refetched Board keeps the forms' choices, the ticks and the failures.
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [report, setReport] = useState<ReactNode>(null);
  const { harnesses, reload } = useHarnesses(launchable(board));
  const actions = useMemo((): BoardActions | null => board ? {
    board, harnesses, chosen, picked, outcomes, reloadHarnesses: reload,
    choose: (key, patch) => setChosen((c) => ({ ...c, [key]: { ...c[key], ...patch } })),
    pick: (issues, on) => setPicked((p) => {
      const next = new Set(p);
      for (const issue of issues) if (on) next.add(issue); else next.delete(issue);
      return next;
    }),
    report: (key, outcome) => setOutcomes(({ [key]: _, ...rest }) => (outcome ? { ...rest, [key]: outcome } : rest)),
  } : null, [board, harnesses, chosen, picked, outcomes, reload]);
  useEffect(installPreviews, []);
  const rows = board?.dispatches ?? [];
  const pick = (issue: string) => {
    const row = document.getElementById(flightId(issue));
    row?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    row?.querySelector<HTMLElement>("a.title")?.focus({ preventScroll: true });
  };
  return (
    <>
      <header className="top">
        <a className="brand" href="/"><Glyph />nico-agent</a>
        <h1>Board</h1>
        {actions && board?.configured?.length ? <Actions.Provider value={actions}><TopActions onReport={setReport} /></Actions.Provider> : null}
      </header>
      <main aria-busy={board === undefined}>
        {failure && <p className="error" role="status">{failure}</p>}
        {board?.error && <p className="error">{board.error}</p>}
        {report && <div className="top-report">{report}<button className="dismiss" onClick={() => setReport(null)}>Dismiss</button></div>}
        {board === undefined || sampled === undefined || actions === null
          ? <p className="empty">Loading the Board…</p>
          : board.configured?.length
            ? (
              <Actions.Provider value={actions}>
                {harnesses && harnessWarnings(harnesses).map((w) => <p key={w} className="warning">{w}</p>)}
                <EventDisplay rows={rows} sampled={sampled} lit={lit} onLight={setLit} onPick={pick} />
                <ActionBar />
                <section className="in-flight">
                  <header><h2>In flight</h2><span className="count">{rows.length}</span></header>
                  {rows.length
                    ? <ul className="flights">{rows.map((d) => <Flight key={d.issue} dispatch={d} lit={lit === d.issue} onLight={setLit} />)}</ul>
                    : <p className="empty">Nothing in flight.</p>}
                </section>
                {repoSections(board).map((s) => <Repo key={s.repo} section={s} lit={lit} onLight={setLit} />)}
              </Actions.Provider>
            )
            : <p className="empty">No Repos configured. Run <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code> to add one.</p>}
      </main>
    </>
  );
}

function Flight({ dispatch: d, lit, onLight }: { dispatch: InFlightDispatch; lit: boolean; onLight: (issue: string | null) => void }) {
  const warnings = [...(d.warnings ?? []), ...(d.prError ? [`could not look up the PR: ${d.prError}`] : [])];
  return (
    <li id={flightId(d.issue)} className={`flight${lit ? " lit" : ""}`} onMouseEnter={() => onLight(d.issue)} onMouseLeave={() => onLight(null)}>
      <div className="head">
        <Pick issue={d.issue} />
        {/* The Repo's name is enough to tell issues apart; the owner is in the link. */}
        <IssueLink label={d.issue.slice(d.issue.indexOf("/") + 1)} title={d.title} url={d.url} />
        <StageKey stage={d.stage} />
        {d.pr && <PrLink {...prOf(d.pr)} />}
      </div>
      <div className="meta">
        <span className="chip">{`${d.harness} · ${d.model} · ${d.effort}`}</span>
        {d.base && <BaseChip branch={d.base} />}
        {d.workspace && <span className="chip" title="herdr workspace">{d.workspace}</span>}
        <Agent role="implementer" state={d.implementer} />
        {d.reviewer && <Agent role="reviewer" state={d.reviewer} />}
      </div>
      <div className="notes">
        {d.failure && <p className="error">{d.failure}</p>}
        {warnings.map((w) => <p key={w} className="warning">{w}</p>)}
        <IssueOutcome issue={d.issue} />
      </div>
      <div className="row-actions">
        <CloseButton dispatch={d} />
        {d.retry ? <RetryButton issue={d.issue} retry={d.retry} /> : canReview(d) && <LaunchForm action="review" target={{ issue: d.issue }} />}
      </div>
    </li>
  );
}

/** The brand glyph: a detector end-on with one amber trail. */
function Glyph() {
  return (
    <svg className="glyph" viewBox="-12 -12 24 24" aria-hidden="true">
      <circle r="4.5" /><circle r="8" /><circle r="11" /><path className="trail" d="M0 0 Q4 -1 8.5 -7" />
    </svg>
  );
}

/** An agent's Agent state as herdr reports it; `blocked` stands out since it waits on the user. */
function Agent({ role, state }: { role: string; state: string }) {
  return <span className={`agent ${agentClass(state)}`}><i aria-hidden="true" />{`${role} ${state}`}</span>;
}

createRoot(document.getElementById("root")!).render(<App />);
