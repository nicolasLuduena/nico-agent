import { type IssueRow, type RepoSection, type RoomReadout, type SpecGroup, SPEC_STATES, agentClass } from "./board";
import { dispatchTarget, isLinear } from "./actions";
import { reachOf } from "./event";
import { IssueOutcome, LaunchForm, Pick, QueueControl, useActions } from "./forms";

/** A Repo's issues: Specs grouping theirs, then Specs of one, Stackable and PR-open issues. */
export function Repo({ section: s, lit, onLight }: { section: RepoSection; lit: string | null; onLight: (issue: string | null) => void }) {
  const list = (rows: IssueRow[]) => <ul className="issues">{rows.map((r) => <Row key={r.key} repo={s.repo} row={r} lit={lit} onLight={onLight} />)}</ul>;
  return (
    <section className="repo">
      <header>
        <h2>{s.repo}</h2>
        <span className="count">{s.count}</span>
        {s.room && <Room repo={s.repo} readout={s.room} />}
      </header>
      {s.errors.map((e) => <p key={e} className="error">{e}</p>)}
      {s.empty && <p className="empty">No Ready issues.</p>}
      {s.specs.map((g) => <Spec key={g.spec} repo={s.repo} group={g} list={list} />)}
      {s.specsOfOne.length > 0 && s.specs.length > 0 && <h3>Specs of one</h3>}
      {s.specsOfOne.length > 0 && list(s.specsOfOne)}
      {s.stackable.length > 0 && <><h3>Stackable</h3>{list(s.stackable)}</>}
      {s.prOpen.length > 0 && <><h3>PR open</h3>{list(s.prOpen)}</>}
    </section>
  );
}

/** The Repo's Specs as the Scheduler sees them: a slot per Spec that may run, filled while one does, and the Queue in start order. */
function Room({ repo, readout }: { repo: string; readout: RoomReadout }) {
  return (
    <div className="room" role="group" aria-label={`Specs of ${repo}`}>
      <span className="slots" aria-hidden="true">{readout.slots.map((taken, i) => <i key={i} className={taken ? "taken" : undefined} />)}</span>
      {readout.figures.map(([label, n]) => <span key={label}>{label} <b>{n}</b></span>)}
      {readout.queue.length > 0 && <ol className="queue-order" aria-label={`Queue of ${repo}`}>{readout.queue.map((s) => <li key={s}>{s}</li>)}</ol>}
    </div>
  );
}

function Spec({ repo, group: g, list }: { repo: string; group: SpecGroup; list: (rows: IssueRow[]) => React.ReactNode }) {
  return (
    <div className={`spec ${g.state}`}>
      <header>
        <span className="spec-state">{SPEC_STATES[g.state]}</span>
        {g.url ? <IssueLink label={g.label} title={g.title} url={g.url} /> : <span className="title"><span className="num">{g.label}</span> {g.title}</span>}
        {g.stage && <StageKey stage={g.stage} />}
        {g.queue && <QueueControl repo={repo} spec={g.spec} status={g.queue} />}
      </header>
      {g.note && <p className={`spec-note${g.note.error ? " error" : ""}`}>{g.note.text}</p>}
      {g.rows.length > 0 && list(g.rows)}
    </div>
  );
}

function Row({ repo, row: r, lit, onLight }: { repo: string; row: IssueRow; lit: string | null; onLight: (issue: string | null) => void }) {
  const { board } = useActions();
  const link = <IssueLink label={r.label} title={r.title} url={r.url} />;
  if (r.kind === "in-flight") {
    // Read-only: its row to act on is In flight, and hovering lights its track.
    return (
      <li className={`member${lit === r.key ? " lit" : ""}`} onMouseEnter={() => onLight(r.key)} onMouseLeave={() => onLight(null)}>
        {link}<StageKey stage={r.stage} />{r.pr && <PrLink {...r.pr} />}
      </li>
    );
  }
  if (r.kind === "pr-open") return <li className="member">{link}<PrLink {...r.pr} /></li>;
  const target = dispatchTarget(board, r.key, repo);
  return (
    <li>
      {/* No tick box for a Linear issue: a batch can't name the Repo of one several Repos claim. */}
      {!isLinear(r.key) && <Pick issue={r.key} />}
      {link}
      {r.kind === "ready" && r.queue && <QueueControl repo={repo} spec={r.key} status={r.queue} />}
      {target && <LaunchForm action="dispatch" target={target} />}
      <IssueOutcome issue={r.key} />
    </li>
  );
}

/** An issue's link: its number or key set apart from its title. Resting on it shows its card. */
export function IssueLink({ label, title, url }: { label: string; title: string; url: string }) {
  return <a className="title" href={url}><span className="num">{label}</span> {title}</a>;
}

export function PrLink({ url, number }: { url: string; number: number }) {
  return <a className="pr" href={url}>{number ? `PR #${number}` : "PR"}</a>;
}

/** A Stage as its track's legend key. */
export function StageKey({ stage }: { stage: string }) {
  return <span className={`stage ${reachOf(stage)}`}>{stage}</span>;
}

/** A Base, as a chip with the branch mark drawn in the brand glyph's stroke. */
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
