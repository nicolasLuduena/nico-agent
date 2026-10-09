import { useEffect, useRef, useState } from "react";
import type { HarnessesJson } from "./actions";
import { OutcomeNote, usePost } from "./forms";
import { type LeadPicks, type LeadStatusJson, leadChoice, leadControl, leadStartArgs } from "./lead";
import { Agent } from "./repos";

/**
 * The Lead's controls, tucked into the header: a button naming where the Lead
 * stands opens its launch, the Harness, model and Effort pickers, and Start,
 * Restart and Stop on the picked launch. Escape or a click elsewhere closes it.
 */
export function LeadMenu({ harnesses, status }: { harnesses: HarnessesJson | null; status: LeadStatusJson | null }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const running = status?.lead === "running";
  return (
    <div
      className="lead-menu"
      ref={menu}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button type="button" ref={button} className="lead-button" aria-expanded={open} aria-controls="lead-controls" onClick={() => setOpen(!open)}>
        {running ? <Agent role="Lead" state={status.state ?? "unknown"} /> : <span className={`agent ${status?.failure ? "failed" : "unknown"}`}><i aria-hidden="true" />{`Lead ${status?.lead ?? "…"}`}</span>}
      </button>
      <div className="lead-controls" id="lead-controls" role="group" aria-label="The Lead's launch" hidden={!open}>
        <LeadControls harnesses={harnesses} status={status} />
      </div>
    </div>
  );
}

function LeadControls({ harnesses, status }: { harnesses: HarnessesJson | null; status: LeadStatusJson | null }) {
  const [chosen, setChosen] = useState<LeadPicks>({});
  const { busy, outcome, act: post } = usePost();
  const choice = harnesses && leadChoice(harnesses, status, chosen);
  const { start, stop } = leadControl(status, choice);
  // Once the Lead runs on the picks, they follow it again.
  const act = async (path: string, args: string[]) => {
    if (await post(path, args)) setChosen({});
  };
  const launch = status?.harness && `${status.harness} · ${status.model} · ${status.effort}`;
  return (
    <>
      <p className="launch-now">{launch ? <>Running on <span className="mono" title={launch}>{launch}</span></> : "Not running"}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (choice && start) void act("/api/lead/start", leadStartArgs(choice, window.location.port));
        }}
      >
        {choice
          ? (
            <>
              <label>Harness
                <select name="harness" value={choice.harness} onChange={(e) => setChosen({ harness: e.target.value })}>
                  {choice.harnesses.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
              <label>Model
                <select name="model" value={choice.model} onChange={(e) => setChosen({ ...chosen, harness: choice.harness, model: e.target.value, effort: undefined })}>
                  {choice.models.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label>Effort
                <select name="effort" value={choice.effort} onChange={(e) => setChosen({ ...chosen, harness: choice.harness, model: choice.model, effort: e.target.value })}>
                  {choice.efforts.map((f) => <option key={f}>{f}</option>)}
                </select>
              </label>
            </>
          )
          : <p className="loading">{harnesses ? "No Harness offers a model" : "Loading Harnesses…"}</p>}
        <div className="buttons">
          {start && <button type="submit" className="primary" disabled={busy}>{start}</button>}
          {stop && <button type="button" className="close" disabled={busy} onClick={() => void act("/api/lead/stop", [])}>Stop</button>}
        </div>
      </form>
      {outcome && <OutcomeNote outcome={outcome} />}
    </>
  );
}
