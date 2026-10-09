import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HarnessesJson } from "./actions";
import { LeadPanel } from "./lead-panel";

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

/**
 * The app is the conversation with the Lead alone: the Board view is off, so
 * the page never asks `/api/board` and polling it costs GitHub nothing. The
 * Board itself stays in the CLI and the Lead's `board` tool.
 */
function App() {
  const { harnesses } = useHarnesses();
  return (
    <>
      <header className="top">
        <a className="brand" href="/"><Glyph />nico-agent</a>
        <h1>Lead</h1>
      </header>
      <div className="layout chat-only">
        <LeadPanel harnesses={harnesses} />
      </div>
    </>
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

createRoot(document.getElementById("root")!).render(<App />);
