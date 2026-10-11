/** What `GET /api/status` answers: `status --json`, plus per Repo what the page shows beside its map. Only the fields the page reads so far. */
export interface Status {
  repos: Repo[];
  sources: { github: { paused_until: string | null }; linear: { paused_until: string | null } };
  dispatches: Dispatch[];
  /** morning.md as the morning agent wrote it; null while there is none. */
  morning_summary?: string | null;
}

export interface Repo {
  slug: string;
  /** When its Source was last read; null before the first read. */
  read_at: string | null;
  /** When GitHub was last asked about its PRs. */
  prs_checked_at: string | null;
  ready: Issue[];
  stackable: Issue[];
  /** Ready Gardening issues, kept out of `ready`. */
  gardening: Issue[];
  /** dispatch, stack, review, restart, flip, answer, gardening, quality_scan. */
  switches: Record<string, boolean>;
  /** The launch the loop dispatches on. */
  implementer: Launch;
  /** Each configured Harness, with the models and Efforts it takes (null: any). */
  harnesses: Record<string, { models: string[] | null; efforts: string[] | null }>;
}

/** A Harness, and its model and Effort; null is the default. */
export interface Launch {
  harness: string;
  model: string | null;
  effort: string | null;
}

export interface Issue {
  key: string;
  title: string;
}

/** `#7` for an issue of the Repo `slug`, else its whole key: another Repo's issue, or a Linear id. */
export const number = (key: string, slug: string) => (key.startsWith(`${slug}#`) ? key.slice(slug.length) : key);

export type Stage = "Implementing" | "PR draft" | "Verified" | "Merged" | "Closed" | "Failed";

export interface Dispatch {
  issue: string;
  title: string;
  /** The Repo's slug. */
  repo: string;
  stage: Stage;
  implementer: Launch;
  /** While its Implementer waits on the user, with the last meaningful line of its pane, as the last tick read it. */
  asking: { since: string; question: string } | null;
  /** Each agent's state as herdr says now (`blocked`: Asking); a Closed Dispatch has none. */
  agent_state?: { implementer: string; reviewer: string | null };
  verdict: { result: "pass" | "fail"; sha: string; at: string } | null;
  updated_at: string;
  closed_at: string | null;
}
