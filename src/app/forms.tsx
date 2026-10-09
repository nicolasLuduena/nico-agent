import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  type BatchPlan, type Chosen, type DispatchTarget, type HarnessesJson, type LaunchAction, type LaunchChoice, type Outcome,
  advanceReport, baseOf, batchPlan, closeArgs, closePlan, launchArgs, launchChoice, outcomeOf, stackOnOf,
} from "./actions";
import type { BoardJson, QueueStatus } from "./board";

/**
 * What the Board's forms share, kept by the App so a refetched Board keeps it:
 * the choices in progress in each form, the ticked issues, and each issue's
 * last failed action, shown wherever its row is now.
 */
export interface BoardActions {
  board: BoardJson;
  /** Null until `/api/harnesses` answers. */
  harnesses: HarnessesJson | null;
  chosen: Record<string, Chosen>;
  choose: (key: string, patch: Chosen) => void;
  picked: Set<string>;
  pick: (issues: string[], on: boolean) => void;
  outcomes: Record<string, Outcome>;
  report: (key: string, outcome: Outcome | null) => void;
  /** Ask `/api/harnesses` again, after a refresh. */
  reloadHarnesses: () => void;
}

export const Actions = createContext<BoardActions | null>(null);

export function useActions() {
  return useContext(Actions)!;
}

/** The Board's forms' shared state for `board`, as `Actions` provides it, kept by the App so it outlives each refetched Board and a visit to another page. */
export function useBoardActions(board: BoardJson, harnesses: HarnessesJson | null, reloadHarnesses: () => void): BoardActions {
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  return {
    board, harnesses, chosen, picked, outcomes, reloadHarnesses,
    choose: (key, patch) => setChosen((was) => ({ ...was, [key]: { ...was[key], ...patch } })),
    pick: (issues, on) => setPicked((was) => {
      const next = new Set(was);
      for (const issue of issues) if (on) next.add(issue); else next.delete(issue);
      return next;
    }),
    report: (key, outcome) => setOutcomes(({ [key]: _, ...rest }) => (outcome ? { ...rest, [key]: outcome } : rest)),
  };
}

export const BUTTONS: Record<LaunchAction, string> = { dispatch: "Dispatch", review: "Launch review" };

const UNREACHABLE: Outcome = { failed: true, lines: [{ text: "Could not reach nico-agent serve; try again.", error: true }], help: [] };

/** What an action's answer says, or that `serve` could not be reached. */
export const answerOf = (json: Record<string, unknown> | null) => (json ? outcomeOf(json) : UNREACHABLE);

/** Post the CLI's arguments to an `/api` action; null when `serve` could not be reached. */
export async function post(path: string, args: string[] = []): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args }) });
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** An action outside the Board's rows (the Lead's, the Voice switch): busy while it runs, and the CLI's message and help when it failed, until the next try. */
export function usePost() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** Post `args` to `path`; true when it did what it was asked. */
  const act = async (path: string, args: string[]) => {
    setBusy(true);
    setOutcome(null);
    const answer = answerOf(await post(path, args));
    setBusy(false);
    if (answer.failed) setOutcome(answer);
    return !answer.failed;
  };
  return { busy, outcome, act };
}

/**
 * An action whose failure is reported under `key` (an issue, or a Queue
 * control): the CLI's message and help, kept until the next try.
 */
function useAction(key: string) {
  const { outcomes, report } = useActions();
  const [busy, setBusy] = useState(false);
  const run = async (path: string, args: string[]) => {
    setBusy(true);
    report(key, null);
    const json = await post(path, args);
    setBusy(false);
    const outcome = answerOf(json);
    if (outcome.failed) report(key, outcome);
    return !outcome.failed;
  };
  return { busy, run, outcome: outcomes[key] };
}

/** An action's lines and, when it failed, the CLI's help. */
export function OutcomeNote({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return null;
  return (
    <div className="outcome" role="status">
      {outcome.lines.map((l, i) => <p key={i} className={l.error ? "error" : undefined}>{l.text}</p>)}
      {outcome.help.map((h) => <p key={h} className="help">{h}</p>)}
    </div>
  );
}

/** The failure last reported for `key`, wherever its row now sits. */
export function IssueOutcome({ issue }: { issue: string }) {
  return <OutcomeNote outcome={useActions().outcomes[issue]} />;
}

/** A launch form's Base or Stack on, then Harness, model and Effort; changing one keeps the others while still valid. */
function LaunchFields({ target, choice, chosen, onChoose }: { target: DispatchTarget; choice: LaunchChoice; chosen: Chosen; onChoose: (patch: Chosen) => void }) {
  const select = (name: keyof Chosen, options: string[], value: string, label: string) => (
    <select name={name} aria-label={`${label} for ${target.issue}`} value={value} onChange={(e) => onChoose({ [name]: e.target.value })}>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
  const { stack, base } = target;
  // The same fallbacks as what the form posts, so it shows what it will send.
  const stackOn = stackOnOf(target, chosen);
  const baseValue = baseOf(target, chosen);
  return (
    <>
      {stack && stackOn ? (
        <label>Stack on{" "}
          <select name="stackOn" value={stackOn} onChange={(e) => onChoose({ stackOn: e.target.value })}>
            {stack.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      ) : base && baseValue && (
        <label>Base {select("base", base.branches, baseValue, "Base")}</label>
      )}
      {select("harness", choice.harnesses, choice.harness, "Harness")}
      {select("model", choice.models, choice.model, "Model")}
      {select("effort", choice.efforts, choice.effort, "Effort")}
    </>
  );
}

/** A form's choices are kept by action and issue, so a batch row starts from the row's own form. */
const formKey = (action: LaunchAction, issue: string) => `${action} ${issue}`;

/** The choices in progress in `action`'s form of `issue`, and how to change them. */
function useChosen(action: LaunchAction, issue: string) {
  const { chosen, choose } = useActions();
  const key = formKey(action, issue);
  return { chosen: chosen[key] ?? {}, choose: (patch: Chosen) => choose(key, patch) };
}

const NO_HARNESS = <p className="empty">No Harness has models to launch with.</p>;

/** An issue's dispatch or review form; its failure is shown under the issue, and `onDone` is called once it launched. */
export function LaunchForm({ action, target, onDone }: { action: LaunchAction; target: DispatchTarget; onDone?: () => void }) {
  const { harnesses } = useActions();
  const { chosen, choose } = useChosen(action, target.issue);
  const { busy, run } = useAction(target.issue);
  if (!harnesses) return <span className="loading">Loading Harnesses…</span>;
  const choice = launchChoice(harnesses, chosen);
  if (!choice) return NO_HARNESS;
  return (
    <form className={`launch ${action}`} onSubmit={(e) => {
      e.preventDefault();
      void run(`/api/${action}`, launchArgs(action, target, choice, chosen)).then((done) => { if (done) onDone?.(); });
    }}>
      <LaunchFields target={target} choice={choice} chosen={chosen} onChoose={choose} />
      <button disabled={busy}>{BUTTONS[action]}</button>
    </form>
  );
}

/**
 * Retry posts the failed launch's own arguments, which resume it from its
 * failed step (ADR-0006). A Dispatch's Retry is the primary action.
 */
export function RetryButton({ issue, retry }: { issue: string; retry: string[] }) {
  const { busy, run } = useAction(issue);
  const [command, ...args] = retry;
  return <button className={`retry ${command === "dispatch" ? "primary" : "review"}`} disabled={busy} onClick={() => void run(`/api/${command}`, args)}>Retry</button>;
}

/** Close an In-flight issue: straight away once it has a PR, else only after confirming (`confirm`), since it is still Implementing. */
export function CloseButton({ issue, confirm }: { issue: string; confirm: boolean }) {
  const { busy, run } = useAction(issue);
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="confirm" role="group" aria-label={`Close ${issue}`}>
        <span>No PR yet. Close removes the worktree and workspace and forgets the Dispatch; the branch is kept.</span>
        <button className="close" disabled={busy} onClick={() => void run("/api/close", closeArgs(issue, true)).then(() => setConfirming(false))}>Confirm close</button>
        <button onClick={() => setConfirming(false)}>Cancel</button>
      </span>
    );
  }
  return <button className="close" disabled={busy} onClick={() => (confirm ? setConfirming(true) : void run("/api/close", closeArgs(issue, false)))}>Close</button>;
}

/**
 * A candidate Spec's Queue control: Queue, or once queued its place in the
 * Queue, Unqueue, and moves up and down (none past either end).
 */
export function QueueControl({ repo, spec, status }: { repo: string; spec: string; status: QueueStatus }) {
  const key = `queue ${repo} ${spec}`;
  const { busy, run, outcome } = useAction(key);
  const act = (command: string, ...direction: string[]) => () => void run(`/api/${command}`, [spec, ...direction, "--repo", repo]);
  const { place, of } = status;
  return (
    <span className="queue">
      {place >= 0 && <span className="queued">Queued {place + 1} of {of}</span>}
      <button disabled={busy} onClick={act(place < 0 ? "queue" : "unqueue")}>{place < 0 ? "Queue" : "Unqueue"}</button>
      {place > 0 && <button disabled={busy} aria-label={`Move ${spec} up`} onClick={act("move", "up")}>↑</button>}
      {place >= 0 && place < of - 1 && <button disabled={busy} aria-label={`Move ${spec} down`} onClick={act("move", "down")}>↓</button>}
      <OutcomeNote outcome={outcome} />
    </span>
  );
}

/** A row's tick box, for the action bar. */
export function Pick({ issue }: { issue: string }) {
  const { picked, pick } = useActions();
  return <input type="checkbox" className="pick" aria-label={`Select ${issue}`} checked={picked.has(issue)} onChange={(e) => pick([issue], e.target.checked)} />;
}

type BatchAction = "dispatch" | "review" | "close";

/** Dispatch, Review and Close for the ticked issues, each with how many it applies to; Dispatch and Review open a form with a row each. */
export function ActionBar() {
  const { board, picked } = useActions();
  const [open, setOpen] = useState<BatchAction | null>(null);
  const plan = batchPlan(board, [...picked]);
  const count: Record<BatchAction, number> = { dispatch: plan.dispatch.length, review: plan.review.length, close: plan.close.length };
  const button = (action: BatchAction, label: string) =>
    <button className={action} disabled={!count[action] || open !== null} onClick={() => setOpen(action)}>{label} {count[action]}</button>;
  return (
    <>
      <div className="actions" role="toolbar" aria-label="With selected">
        <span>With selected</span>
        {button("dispatch", "Dispatch")}
        {button("review", "Review")}
        {button("close", "Close")}
      </div>
      {open === "close"
        ? <BatchClose issues={plan.close} onDone={() => setOpen(null)} />
        : open && <BatchLaunch action={open} plan={plan} onDone={() => setOpen(null)} />}
    </>
  );
}

/** One form with a row per ticked issue that fits the action, each filled in like its own launch form, then each launched on its own. */
function BatchLaunch({ action, plan, onDone }: { action: LaunchAction; plan: BatchPlan; onDone: () => void }) {
  const { harnesses, chosen, choose, pick } = useActions();
  // Fixed when the form opens, so a refetched Board doesn't change what is being launched.
  const [targets] = useState<DispatchTarget[]>(() => (action === "dispatch" ? plan.dispatch : plan.review.map((issue) => ({ issue }))));
  const [skipped] = useState(() => plan.skipped[action]);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const chosenOf = (issue: string) => chosen[formKey(action, issue)] ?? {};
  const choices = harnesses && targets.map((t) => launchChoice(harnesses, chosenOf(t.issue)));
  const submit = async () => {
    setBusy(true);
    const done: Outcome[] = [];
    for (const [i, target] of targets.entries()) {
      const json = await post(`/api/${action}`, launchArgs(action, target, choices![i]!, chosenOf(target.issue)));
      const outcome = answerOf(json);
      // The CLI says `acme/api#7`, `acme/api#7 (resumed from tab)` or `acme/api#7 already In flight (no-op)` under its verb.
      const verb = action === "dispatch" ? "dispatched" : "reviewing";
      const said = String(json?.[verb] ?? "");
      const result = said.startsWith(target.issue) ? said.slice(target.issue.length).trim() : said;
      done.push(outcome.failed ? { ...outcome, lines: outcome.lines.map((l) => ({ ...l, text: `${target.issue}: ${l.text}` })) }
        : { failed: false, lines: [{ text: `${target.issue}: ${result || verb}`, error: false }], help: [] });
      setResults([...done]);
    }
    setBusy(false);
    pick(targets.map((t) => t.issue), false);
  };
  return (
    <section className="batch" aria-label={`${BUTTONS[action]} ${targets.length}`}>
      <header><h2>{BUTTONS[action]} {targets.length} {targets.length === 1 ? "issue" : "issues"}</h2></header>
      {results
        ? results.map((o, i) => <OutcomeNote key={i} outcome={o} />)
        : !choices
          ? <p className="empty">Loading Harnesses…</p>
          : choices.some((c) => !c)
            ? NO_HARNESS
            : (
              <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                {targets.map((t, i) => (
                  <fieldset key={t.issue} className="row">
                    <legend>{t.issue}</legend>
                    <LaunchFields target={t} choice={choices[i]!} chosen={chosenOf(t.issue)} onChoose={(patch) => choose(formKey(action, t.issue), patch)} />
                  </fieldset>
                ))}
                <div className="buttons">
                  <button className="primary" disabled={busy}>{BUTTONS[action]} {targets.length}</button>
                  <button type="button" disabled={busy} onClick={onDone}>Cancel</button>
                </div>
              </form>
            )}
      {skipped.length > 0 && <ul className="skipped">{skipped.map((s) => <li key={s}>Skipped {s}</li>)}</ul>}
      {results && !busy && <div className="buttons"><button onClick={onDone}>Done</button></div>}
    </section>
  );
}

/** Close the ticked In-flight issues: those with a PR straight away, the rest after one confirmation. */
function BatchClose({ issues, onDone }: { issues: string[]; onDone: () => void }) {
  const { board, pick } = useActions();
  const [plan] = useState(() => closePlan(board, issues));
  const [results, setResults] = useState<Outcome[]>([]);
  const [asked, setAsked] = useState(plan.confirm.length > 0);
  const [busy, setBusy] = useState(false);
  const close = async (issues: string[], confirm: boolean) => {
    setBusy(true);
    const json = await post("/api/close", [...issues, ...(confirm ? ["--confirm"] : [])]);
    const outcome = answerOf(json);
    // One issue closed says only `closed: <issue>`; several say a line each.
    const closed = { failed: false, lines: [{ text: `Closed ${String(json?.closed ?? issues.join(", "))}`, error: false }], help: [] };
    setResults((r) => [...r, outcome.lines.length ? outcome : closed]);
    pick(issues, false);
    setBusy(false);
  };
  // Those with a PR need no confirmation, so they close as the step opens; once, however often it renders.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !plan.now.length) return;
    started.current = true;
    void close(plan.now, false);
  }, []);
  return (
    <section className="batch" aria-label="Close">
      <header><h2>Close</h2></header>
      {results.map((o, i) => <OutcomeNote key={i} outcome={o} />)}
      {asked ? (
        <div className="confirm">
          <p>{plan.confirm.join(", ")} {plan.confirm.length === 1 ? "has" : "have"} no PR yet. Close removes the worktree and workspace and forgets the Dispatch. The branch is kept.</p>
          <div className="buttons">
            <button className="close" disabled={busy} onClick={() => { setAsked(false); void close(plan.confirm, true); }}>Confirm close</button>
            <button disabled={busy} onClick={() => { setAsked(false); onDone(); }}>Cancel</button>
          </div>
        </div>
      ) : !busy && <div className="buttons"><button onClick={onDone}>Done</button></div>}
    </section>
  );
}

/** Advance now and Refresh harnesses, in the top bar; what they did shows under it. */
export function TopActions({ onReport }: { onReport: (report: React.ReactNode) => void }) {
  const { reloadHarnesses } = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const advance = async () => {
    setBusy("advance");
    const json = await post("/api/advance");
    setBusy(null);
    if (!json) return onReport(<OutcomeNote outcome={UNREACHABLE} />);
    const { lines, help } = advanceReport(json);
    onReport(
      <section className="report" aria-label="Advance">
        <header><h2>Advance</h2></header>
        <ul className="advanced">{lines.map((l, i) => <li key={i} className={l.result}>{l.text}</li>)}</ul>
        <OutcomeNote outcome={help.length ? { failed: true, lines: [], help } : undefined} />
      </section>,
    );
  };
  const refresh = async () => {
    setBusy("refresh");
    const json = await post("/api/harness/refresh");
    setBusy(null);
    reloadHarnesses();
    // A Harness whose discovery failed says why in its row; the CLI's help says what to do next.
    const failed = ((json?.refreshed ?? []) as { error?: string }[]).filter((r) => r.error);
    const outcome = failed.length && json
      ? { failed: true, lines: failed.map((r) => ({ text: r.error!, error: true })), help: (json.help ?? []) as string[] }
      : answerOf(json);
    onReport(outcome.failed ? <OutcomeNote outcome={outcome} /> : null);
  };
  return (
    <div className="top-actions">
      <button className="refresh" disabled={busy !== null} onClick={() => void refresh()}>{busy === "refresh" ? "Refreshing…" : "Refresh harnesses"}</button>
      <button className="advance primary" disabled={busy !== null} onClick={() => void advance()}>{busy === "advance" ? "Advancing…" : "Advance now"}</button>
    </div>
  );
}
