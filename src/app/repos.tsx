import { useEffect, useState } from "react";
import type { LaunchAction } from "./actions";
import { type BoardJson, agentClass, stageClass } from "./board";
import { BUTTONS, CloseButton, IssueOutcome, LaunchForm } from "./forms";
import { type DispatchLine, type IssueLine, type RepoRow, repoRows } from "./repo-rows";

/** Where the expanded Repos are remembered, in this browser only. */
const EXPANDED_KEY = "nico-agent.repos.expanded";

/** The Repos expanded, remembered across reloads; storage that cannot be used just forgets them. */
function useExpanded() {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]");
      return new Set(Array.isArray(stored) ? stored.filter((r): r is string => typeof r === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (repo: string) => setExpanded((was) => {
    const next = new Set(was);
    if (!next.delete(repo)) next.add(repo);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // Kept for this visit only.
    }
    return next;
  });
  return { expanded, toggle };
}

/**
 * The Repos pane: a row per configured Repo of `board` (null until it loads),
 * each summarising its work while collapsed and, expanded, listing its
 * In-flight Dispatches, its Held Specs, what starts next and its Ready and
 * Stackable issues, with the Board's actions: dispatch, launch a review and
 * Close, their state kept in the App's `Actions`. An action's failure shows under its issue; what it did shows once
 * `serve` says the Board changed. A Board that could not be read says why in
 * the notices.
 */
export function ReposPane({ board }: { board: BoardJson | null }) {
  const { expanded, toggle } = useExpanded();
  const rows = board && !board.error ? repoRows(board) : null;
  return (
    <section className="side repos" aria-labelledby="side-title">
      <h1 id="side-title">Repos</h1>
      {!board && <p className="loading">Reading the Repos…</p>}
      {board?.error && <p className="error">The Repos could not be read.</p>}
      {rows?.length === 0 && <p className="lede">No Repos yet. Run <code>nico-agent repo add</code> to add one.</p>}
      {rows && rows.length > 0 && (
        <ul className="repo-rows">
          {rows.map((r) => <RepoItem key={r.repo} row={r} open={expanded.has(r.repo)} toggle={() => toggle(r.repo)} />)}
        </ul>
      )}
    </section>
  );
}

/** A Repo's id in the page, for its expanded content. */
const bodyId = (repo: string) => `repo-${repo.replace(/[^\w-]/g, "-")}`;

function RepoItem({ row: r, open, toggle }: { row: RepoRow; open: boolean; toggle: () => void }) {
  return (
    <li className={`repo-row${open ? " open" : ""}`}>
      <button type="button" className="repo-head" aria-expanded={open} aria-controls={bodyId(r.repo)} onClick={toggle}>
        <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
        <span className="repo-name">{r.repo}</span>
        <Summary row={r} />
      </button>
      {open && (
        <div className="repo-body" id={bodyId(r.repo)}>
          {r.errors.map((e) => <p key={e} className="error">{e}</p>)}
          {r.empty && <p className="empty">Nothing In flight, Held or queued.</p>}
          {r.dispatches.length > 0 && (
            <Group title="In flight">
              <ul className="dispatches">{r.dispatches.map((d) => <Dispatch key={d.issue} line={d} />)}</ul>
            </Group>
          )}
          {r.held.length > 0 && (
            <Group title="Held">
              <ul className="held">
                {r.held.map((h) => <li key={h.spec}><IssueLink {...h} /><p className="reason">{h.reason}</p></li>)}
              </ul>
            </Group>
          )}
          {r.next.length > 0 && (
            <Group title="Starts next">
              <ul className="next">
                {r.next.map((n) => <li key={n.issue}><IssueLink {...n} /><span className="of">{`next in ${n.specLabel} ${n.specTitle}`}</span></li>)}
              </ul>
            </Group>
          )}
          {r.issues.length > 0 && (
            <Group title="To dispatch">
              <ul className="dispatchable">{r.issues.map((i) => <Dispatchable key={i.target.issue} line={i} />)}</ul>
            </Group>
          )}
          {r.queue.length > 0 && (
            <Group title="Queue">
              <ol className="queue" aria-label={`Queue of ${r.repo}`}>
                {r.queue.map((q) => <li key={q.spec}><IssueLink {...q} /></li>)}
              </ol>
            </Group>
          )}
        </div>
      )}
    </li>
  );
}

/** A collapsed Repo at a glance: what is In flight, Asking and Held, or that it could not be read. */
function Summary({ row: r }: { row: RepoRow }) {
  const { inFlight, asking, held } = r.summary;
  return (
    <span className="summary">
      {r.errors.length > 0 && <span className="error" title={r.errors.join("\n")}>Could not load</span>}
      {inFlight > 0 && <span>{`${inFlight} In flight`}</span>}
      {asking > 0 && <span className="asking">{`${asking} Asking`}</span>}
      {held > 0 && <span className="held-count">{held === 1 ? "Held" : `${held} Held`}</span>}
      {r.issues.length > 0 && <span>{`${r.issues.length} to dispatch`}</span>}
      {r.empty && <span>Idle</span>}
    </span>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="repo-group"><h3>{title}</h3>{children}</section>;
}

/** How long a shown Dispatch waits after reading its Implementer's screen before reading it again. */
const SCREEN_POLL_MS = 4000;

/** Whether the page is shown, not hidden behind another tab or a minimised window. */
function usePageShown() {
  const [shown, setShown] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const changed = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return shown;
}

/**
 * What `issue`'s Implementer is doing: the last meaningful line of its screen,
 * read from herdr through `/api/peek` (no GitHub call) while `reading`, and
 * again a few seconds after each read. A screen that cannot be read is no line.
 */
function useScreenLine(issue: string, reading: boolean) {
  const [line, setLine] = useState<string>();
  useEffect(() => {
    if (!reading) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      let next: string | undefined;
      try {
        const response = await fetch(`/api/peek?issue=${encodeURIComponent(issue)}`);
        if (response.ok) next = ((await response.json()) as { line?: string }).line;
      } catch {
        // No line, until a read succeeds.
      }
      if (!current) return;
      setLine(next);
      timer = setTimeout(read, SCREEN_POLL_MS);
    };
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
      // Not shown again once stale: back on the page, the line waits for a fresh read.
      setLine(undefined);
    };
  }, [issue, reading]);
  return line;
}

function Dispatch({ line: d }: { line: DispatchLine }) {
  const [open, setOpen] = useState(false);
  // An Asking Implementer's question already shows its screen.
  const asking = Boolean(d.question);
  const doing = useScreenLine(d.issue, usePageShown() && !asking);
  return (
    <li>
      <IssueLink {...d} />
      <div className="facts">
        <StageKey stage={d.stage} />
        <Agent role="Implementer" state={d.agent} />
        {d.pr && <PrLink {...d.pr} />}
      </div>
      {d.question && <pre className="question">{d.question}</pre>}
      {!asking && doing && <p className="doing" title={doing}>{doing}</p>}
      <div className="row-actions">
        {d.review && <Toggle action="review" issue={d.issue} open={open} setOpen={setOpen} />}
        <CloseButton issue={d.issue} confirm={d.confirmClose} />
      </div>
      {open && <LaunchForm action="review" target={{ issue: d.issue }} onDone={() => setOpen(false)} />}
      <IssueOutcome issue={d.issue} />
    </li>
  );
}

/** A Ready or Stackable issue, with its dispatch form a click away. */
function Dispatchable({ line: i }: { line: IssueLine }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <IssueLink {...i} />
      <div className="facts">
        {i.kind === "stackable" && <span className="kind">Stackable</span>}
        <Toggle action="dispatch" issue={i.target.issue} open={open} setOpen={setOpen} />
      </div>
      {open && <LaunchForm action="dispatch" target={i.target} onDone={() => setOpen(false)} />}
      <IssueOutcome issue={i.target.issue} />
    </li>
  );
}

/** Opens and closes an issue's launch form. */
function Toggle({ action, issue, open, setOpen }: { action: LaunchAction; issue: string; open: boolean; setOpen: (open: boolean) => void }) {
  return (
    <button type="button" className="quiet" aria-expanded={open} aria-label={`${open ? "Cancel" : BUTTONS[action]} ${issue}`} onClick={() => setOpen(!open)}>
      {open ? "Cancel" : `${BUTTONS[action]}…`}
    </button>
  );
}

/** An issue's link: its number or key set apart from its title. Resting on it shows its card. */
export function IssueLink({ label, title, url }: { label: string; title: string; url: string }) {
  return <a className="title" href={url}><span className="num">{label}</span> {title}</a>;
}

export function PrLink({ url, number }: { url: string; number: number }) {
  return <a className="pr" href={url}>{number ? `PR #${number}` : "PR"}</a>;
}

/** A Stage, in its own colour. */
export function StageKey({ stage }: { stage: string }) {
  return <span className={`stage ${stageClass(stage)}`}>{stage}</span>;
}

/** A Base, as a chip with a branch mark. */
export function BaseChip({ branch }: { branch: string }) {
  return (
    <span className="chip" title="Base">
      <svg className="icon" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="3" cy="2.5" r="1.5" /><circle cx="3" cy="9.5" r="1.5" /><circle cx="9" cy="3.5" r="1.5" /><path d="M3 4v4M9 5c0 2.5-6 1.5-6 3" />
      </svg>
      {branch}
    </span>
  );
}

/** An agent's Agent state as herdr reports it; `blocked` stands out since it waits on the user. */
export function Agent({ role, state }: { role: string; state: string }) {
  return <span className={`agent ${agentClass(state)}`}><i aria-hidden="true" />{`${role} ${state}`}</span>;
}
