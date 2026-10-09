import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type BoardJson, type InFlightDispatch, agentClass, prOf, repoSections } from "./board";
import { EventDisplay, reducedMotion } from "./event-display";
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

/** An In-flight row's DOM id, so a clicked track can bring it into view. */
const flightId = (issue: string) => `flight-${issue.replace(/[^\w-]/g, "-")}`;

function App() {
  const { board, sampled, failure } = useBoard();
  // The issue whose track and rows are lit, as the pointer rests on one of them.
  const [lit, setLit] = useState<string | null>(null);
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
        <a className="classic" href="/classic">htmx Board</a>
      </header>
      <main aria-busy={board === undefined}>
        {failure && <p className="error" role="status">{failure}</p>}
        {board?.error && <p className="error">{board.error}</p>}
        {board === undefined || sampled === undefined
          ? <p className="empty">Loading the Board…</p>
          : board.configured?.length
            ? (
              <>
                <EventDisplay rows={rows} sampled={sampled} lit={lit} onLight={setLit} onPick={pick} />
                <section className="in-flight">
                  <header><h2>In flight</h2><span className="count">{rows.length}</span></header>
                  {rows.length
                    ? <ul className="flights">{rows.map((d) => <Flight key={d.issue} dispatch={d} lit={lit === d.issue} onLight={setLit} />)}</ul>
                    : <p className="empty">Nothing in flight.</p>}
                </section>
                {repoSections(board).map((s) => <Repo key={s.repo} section={s} lit={lit} onLight={setLit} />)}
              </>
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
      {(d.failure || warnings.length > 0) && (
        <div className="notes">
          {d.failure && <p className="error">{d.failure}</p>}
          {warnings.map((w) => <p key={w} className="warning">{w}</p>)}
        </div>
      )}
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
