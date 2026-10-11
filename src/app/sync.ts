import type { Repo } from "../config";
import type { PartName, SyncStatus } from "../local-state";
import { MONTHS } from "./stats-charts";

/** The header's sync line: when the last Sync ended, whether one runs, and the Repos the last one failed for. */
export interface SyncLine {
  text: string;
  syncing: boolean;
  /** One line naming the Repos whose last Sync failed; their last state stays on screen. */
  warning?: string;
  /** Each failed Repo's error, a line each, for the warning's tooltip. */
  detail?: string;
}

/** The sync line for `status` (null until `serve` answers) at `now`. */
export function syncLine(status: SyncStatus | null, now: Date): SyncLine {
  const syncing = status?.syncing ?? false;
  const text = status?.at ? `Synced ${ago(new Date(status.at), now)}` : syncing ? "Syncing…" : "Not synced yet";
  const failed = (status?.repos ?? []).filter((r) => r.error);
  if (!failed.length) return { text, syncing };
  return {
    text, syncing,
    warning: `${failed.map((r) => r.repo).join(failed.length === 2 ? " and " : ", ")} didn't sync`,
    detail: failed.map((r) => `${r.repo}: ${r.error}`).join("\n"),
  };
}

/** How long before `now` `at` was, in words: `just now`, `2 min ago`, `3 h ago`, or the day. */
function ago(at: Date, now: Date) {
  const seconds = (now.getTime() - at.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 24 * 3600) return `${Math.floor(seconds / 3600)} h ago`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

/** Whether a `state-changed` event's `data` names any of `parts`. */
export function namedParts(data: string, parts: PartName[]) {
  try {
    const named = (JSON.parse(data) as { parts?: unknown }).parts;
    return Array.isArray(named) && named.some((p) => parts.includes(p as PartName));
  } catch {
    return false;
  }
}

/** What `/api/repos` answers: `repo list --json`, its Repos or `0 configured`. */
export interface ReposJson {
  count?: number;
  repos?: Repo[] | string;
}

/** The configured Repos' slugs, in config order, from `/api/repos` (undefined until it answers). */
export function repoSlugs(json: ReposJson | undefined): string[] {
  return Array.isArray(json?.repos) ? json.repos.map((r) => r.slug) : [];
}
