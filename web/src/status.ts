/** What `GET /api/status` answers: `status --json`, plus per Repo what the page shows beside its map. Only the fields the page reads so far. */
export interface Status {
  repos: Repo[];
  sources: { github: { paused_until: string | null }; linear: { paused_until: string | null } };
  dispatches: Dispatch[];
}

export interface Repo {
  slug: string;
  /** When its Source was last read; null before the first read. */
  read_at: string | null;
  /** When GitHub was last asked about its PRs. */
  prs_checked_at: string | null;
  ready: Issue[];
  stackable: Issue[];
  /** dispatch, stack, review, restart, flip. */
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

export type Stage = "Implementing" | "PR draft" | "Verified" | "Merged" | "Closed" | "Failed";

export interface Dispatch {
  issue: string;
  title: string;
  /** The Repo's slug. */
  repo: string;
  stage: Stage;
  implementer: Launch;
  /** While its Implementer waits on the user, with the last meaningful line of its pane. */
  asking: { since: string; question: string } | null;
  verdict: { result: "pass" | "fail"; sha: string; at: string } | null;
  updated_at: string;
  closed_at: string | null;
}
