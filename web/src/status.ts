import type { Library } from "./wiki/wiki";

/** What `GET /api/status` answers: `status --json`, plus per Repo what the page shows beside its map. Only the fields the page reads so far. */
export interface Status {
  /** Each Project: a Repo naming none is its own, named by its slug. */
  projects: Project[];
  repos: Repo[];
  sources: { github: { paused_until: string | null }; linear: { paused_until: string | null } };
  dispatches: Dispatch[];
  /** morning.md as the morning agent wrote it; null while there is none. */
  morning_summary?: string | null;
  /** The last morning agent's Run; none before the first. */
  morning?: Run;
  /** Each Wiki built, tried, queued or building, by its id. */
  wikis: WikiState[];
  /** The Library versions `[wiki]` adds that no Repo links: the Libraries tab's. */
  libraries: Library[];
}

/** Where a Wiki's builds stand. */
export interface WikiState {
  wiki: string;
  state: "built" | "building" | "queued" | "failed";
  /** The commit of the build that built it; null before one did. */
  commit: string | null;
  /** Why its last build failed, if it did. */
  why?: string;
}

/** The settings of a Repo, or the defaults of a Project, each as it takes effect. */
export interface Settings {
  /** dispatch, stack, review, restart, flip, answer, gardening, quality_scan, wiki. */
  switches: Record<string, Setting<boolean>>;
  /** How many Dispatches a Repo may have In flight at once. */
  room: Setting<number>;
  /** The branch a Dispatch starts from unless stacked; null, origin's default branch. */
  base: Setting<string | null>;
  /** The launch the loop dispatches on. */
  implementer: Setting<Launch>;
  /** The launch Reviewers start on. */
  reviewer: Setting<Launch>;
  /** The Library versions its agents ask the Wikis of. */
  libraries: Setting<Library[]>;
}

export interface Repo extends Settings {
  slug: string;
  /** When its Source was last read; null before the first read. */
  read_at: string | null;
  /** When GitHub was last asked about its PRs. */
  prs_checked_at: string | null;
  ready: Issue[];
  stackable: Issue[];
  /** Ready Gardening issues, kept out of `ready`. */
  gardening: Issue[];
  /** Each configured Harness, with the models and Efforts it takes (null: any). */
  harnesses: Record<string, { models: string[] | null; efforts: string[] | null }>;
  /** Its last quality-scan's Run; none before the first. */
  last_scan?: Run;
  /** Its Readiness checks; none before the first. */
  checks?: Checks;
  /** Its Install, while it has a command. */
  install?: { command: string; last: Install | null };
}

/** How a Repo's last Install went. */
export interface Install {
  /** When it started, before it pulled. */
  at: string;
  /** The commit it installed; null when it was refused or its pull failed. */
  sha: string | null;
  ok: boolean;
  /** The last lines of what it printed, or why it was refused. */
  output: string;
}

/** A Repo's Readiness checks: what would break it before it does. */
export interface Checks {
  /** Since when they say what they say. */
  at: string;
  results: Check[];
}

export interface Check {
  name: string;
  ok: boolean;
  said: string;
  /** What to do about it, while it fails. */
  help: string | null;
}

/** Repos that work together, and the defaults they take where they set none, each shown as its own or the default. */
export interface Project extends Settings {
  name: string;
  /** The slugs of its Repos. */
  repos: string[];
  /** What it sets, as config.toml writes it: e.g. `{room: 4, switches: {review: false}}`. */
  defaults: Record<string, any>;
}

/** A setting as it takes effect, and which of the Repo, its Project and the defaults sets it. */
export interface Setting<T> {
  value: T;
  from: "repo" | "project" | "default";
}

/** One start of an agent of the loop's own: a quality-scan, a faux-nico or the morning agent. */
export interface Run {
  /** Its herdr agent, the name to take it over with. */
  agent: string;
  /** While herdr reports it blocked, since when; none once it is closed. */
  blocked_since?: string;
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

/**
 * How the map of a Project of `repos` names a node's Repo `slug`: its slug's
 * name, or the whole slug when another Repo of the Project shares it; none
 * while the Project has one Repo, or for a Blocker outside it.
 */
export function repoName(slug: string | null, repos: string[]): string | null {
  if (!slug || repos.length < 2) return null;
  const name = slug.slice(slug.indexOf("/") + 1);
  return repos.filter((r) => r.slice(r.indexOf("/") + 1) === name).length > 1 ? slug : name;
}

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
  /** Where the review of its open PR stands, while it is PR draft or Verified. */
  review: Review | null;
  /** Its last faux-nico's Run, while it is live. */
  faux_nico?: Run;
  verdict: { result: "pass" | "fail"; sha: string; at: string } | null;
  updated_at: string;
  closed_at: string | null;
}

/** Where the review of a Dispatch's PR stands for its head; serve derives it, first match wins. */
export interface Review {
  state: "off" | "passed" | "failed" | "reviewing" | "stopped" | "retrying" | "gave_up" | "waiting";
  /** The PR head it is about. */
  sha: string;
  /** Its latest Reviewer's Harness; null before one was started. */
  harness: string | null;
  /** The starts for the head that failed, or whose Reviewer left herdr before a Verdict, as the next tick counts them. */
  attempts: number;
  /** How many of those are tried again before it gives up. */
  cap: number;
}
