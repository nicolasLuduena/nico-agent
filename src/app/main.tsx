import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HarnessesJson } from "./actions";
import type { LeadStatusJson } from "./lead";
import { LeadMenu } from "./lead-menu";
import { LeadPanel } from "./lead-panel";
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
 * The app: a header with the brand, the Lead and Stats pages and the Lead's
 * controls, then the chat with the Lead on the left and the page's own column
 * on the right. The page never asks `/api/board` yet, so it costs GitHub
 * nothing; the Repos come to the right column on the Lead page.
 */
function App() {
  const { harnesses } = useHarnesses();
  const page = usePage();
  const { data: status = null } = useResource<LeadStatusJson>("/api/lead/status", ["lead-state"]);
  return (
    <>
      <header className="top">
        <a className="brand" href="#/">nico-agent</a>
        <nav aria-label="Pages">
          {PAGES.map((p) => <a key={p.page} href={p.href} aria-current={page === p.page ? "page" : undefined}>{p.label}</a>)}
        </nav>
        <LeadMenu harnesses={harnesses} status={status} />
      </header>
      <main className="shell">
        <LeadPanel status={status} />
        {page === "stats"
          ? (
            <section className="side" aria-labelledby="side-title">
              <h1 id="side-title">Stats</h1>
              <p className="lede">Merged PRs and issues defined per day will show here, counted from what nico-agent has seen.</p>
            </section>
          )
          : (
            <section className="side" aria-labelledby="side-title">
              <h1 id="side-title">Repos</h1>
              <p className="lede">Your Repos and the work in them will show here.</p>
            </section>
          )}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
