import { useEffect, useState } from "react";
import type { SyncStatus } from "../local-state";
import { useResource } from "./stream";
import { syncLine } from "./sync";

/** The time now, again every `ms`, so a line saying how long ago keeps true. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * The header's sync line (ADR-0015): how long ago Local state last synced,
 * the Sync button, which turns while a Sync runs (the button's own or
 * `serve`'s), and a warning naming each Repo whose last Sync failed, whose
 * last state stays on screen. Asked of `serve` again as each Sync starts and ends.
 */
export function SyncLine() {
  const { data } = useResource<SyncStatus>("/api/sync", [], ["sync"]);
  const [posting, setPosting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // A refusal holds only until a later Sync ends, which says how things stand now.
  useEffect(() => setRefused(null), [data?.at]);
  const now = useNow(15_000);
  const line = syncLine(data ?? null, now);
  const syncing = line.syncing || posting;
  /** Sync now, saying why if `serve` refused or could not be reached; the line itself follows the Sync's `state-changed`. */
  const sync = async () => {
    setPosting(true);
    setRefused(null);
    try {
      const answer = await fetch("/api/sync", { method: "POST" });
      if (!answer.ok) setRefused(((await answer.json()) as { error?: string }).error ?? `Sync failed (${answer.status})`);
    } catch {
      setRefused("Could not reach nico-agent serve");
    } finally {
      setPosting(false);
    }
  };
  const warning = refused ?? line.warning;
  return (
    <div className={`sync${syncing ? " syncing" : ""}`}>
      {warning && (
        <span className="sync-warning" role="status" title={refused ?? line.detail}>
          <i aria-hidden="true" /><span className="words">{warning}</span>
        </span>
      )}
      <span className="sync-when" title={data?.at ? new Date(data.at).toLocaleString() : undefined}>
        {line.text}
      </span>
      <button type="button" className="quiet sync-button" onClick={() => void sync()} disabled={posting} aria-label="Sync now" title={`${line.text}. Read git and GitHub again now`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.7M2.5 8a5.5 5.5 0 0 1 9.6-3.7" /><path d="M12.5 1.8v2.7H9.8M3.5 14.2v-2.7h2.7" /></svg>
        <span className="label">Sync</span>
      </button>
    </div>
  );
}
