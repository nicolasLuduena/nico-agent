import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type BoardJson, type InFlightDispatch, agentClass, stageClass } from "./board";

/** The Board, fetched on load, on each `board-changed`, and on reconnecting to `serve`. */
function useBoard() {
  const [board, setBoard] = useState<BoardJson | null>(null);
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
        setBoard(json);
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
  return { board, failure };
}

function App() {
  const { board, failure } = useBoard();
  const rows = board?.dispatches ?? [];
  return (
    <>
      <header className="top">
        <a className="brand" href="/">nico-agent</a>
        <h1>Board</h1>
        <a className="classic" href="/classic">Classic Board</a>
      </header>
      <main>
        {failure && <p className="error" role="status">{failure}</p>}
        {board?.error && <p className="error">{board.error}</p>}
        <section className="in-flight" aria-busy={board === null}>
          <header><h2>In flight</h2><span className="count">{rows.length}</span></header>
          {board === null
            ? <p className="empty">Loading the Board…</p>
            : rows.length
              ? <ul className="flights">{rows.map((d) => <Row key={d.issue} dispatch={d} />)}</ul>
              : <p className="empty">Nothing in flight.</p>}
        </section>
      </main>
    </>
  );
}

function Row({ dispatch: d }: { dispatch: InFlightDispatch }) {
  return (
    <li>
      <div className="head">
        {/* The Repo's name is enough to tell issues apart; the owner is in the key. */}
        <span className="key">{d.issue.slice(d.issue.indexOf("/") + 1)}</span>
        <span className="title">{d.title}</span>
        <span className={`stage ${stageClass(d.stage)}`}>{d.stage}</span>
        {d.pr && <a className="pr" href={d.pr}>PR</a>}
      </div>
      <div className="meta">
        <span className="chip">{`${d.harness} · ${d.model} · ${d.effort}`}</span>
        {d.base && <span className="chip">{d.base}</span>}
        {d.workspace && <span className="chip" title="herdr workspace">{d.workspace}</span>}
        <Agent role="implementer" state={d.implementer} />
        {d.reviewer && <Agent role="reviewer" state={d.reviewer} />}
      </div>
      {d.prError && <p className="error">{d.prError}</p>}
    </li>
  );
}

function Agent({ role, state }: { role: string; state: string }) {
  return <span className={`agent ${agentClass(state)}`}><i aria-hidden="true" />{`${role} ${state}`}</span>;
}

createRoot(document.getElementById("root")!).render(<App />);
