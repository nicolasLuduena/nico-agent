import { sameSlug } from "../slug";
import { sameSpec } from "../spec";

/** An In-flight Dispatch as `nico-agent board --json` lists it under `dispatches`. */
export interface InFlightDispatch {
  issue: string;
  title: string;
  repo: string;
  url: string;
  stage: string;
  pr: string;
  prError?: string;
  implementer: string;
  reviewer: string;
  harness: string;
  model: string;
  effort: string;
  base: string;
  workspace: string;
  /** Why its launch or its Reviewer's Failed. */
  failure?: string;
  warnings?: string[];
  /** A failed launch's own CLI arguments, which resume it from its failed step. */
  retry?: string[];
}

interface JsonIssue {
  issue: string;
  title: string;
  repo: string;
  url: string;
}

interface JsonSpec {
  spec: string;
  title: string;
  url: string;
  repo: string;
  issues: string[];
  running: boolean;
  held?: { issue: string; reason: string };
  next?: { issue: string; reason: string };
  waiting?: { issue: string; reason: string };
  reason?: string;
}

/** A Repo's room as `board --json` lists it under `rooms`. */
export interface JsonRoom {
  repo: string;
  running: string[];
  room: number;
  candidates: { spec: string }[];
  /** Its Queue, head first. */
  queue: string[];
}

/** The parts of `nico-agent board --json` the app reads. */
export interface BoardJson {
  /** Every configured Repo, in config order; unset when none is. */
  configured?: string[];
  issues?: (JsonIssue & { base?: string })[];
  stackable?: (JsonIssue & { blockers: { issue: string; pr: string; base: string }[] })[];
  prOpen?: (JsonIssue & { pr: string; state: string })[];
  specs?: JsonSpec[];
  rooms?: JsonRoom[];
  /** origin's branches of each Repo with Ready issues, for the dispatch form's Base. */
  bases?: { repo: string; branches: string[] }[];
  inFlight?: string;
  dispatches?: InFlightDispatch[];
  errors?: { repo: string; error: string; source?: string }[];
  error?: string;
}

/** A Stage's colour, one per Stage (DESIGN.md): every Failed Stage shares Failed's; one without its own reads as unknown. */
export type StageClass = "implementing" | "pr-ready" | "review-launched" | "failed" | "unknown";

const STAGE_CLASSES: Record<string, StageClass> = { Implementing: "implementing", "PR ready": "pr-ready", "Review launched": "review-launched" };

export function stageClass(stage: string): StageClass {
  if (stage.startsWith("Failed")) return "failed";
  return STAGE_CLASSES[stage] ?? "unknown";
}

/** The Agent states the Board draws apart; any other reads as unknown. */
export function agentClass(state: string) {
  return ["working", "idle", "done", "blocked"].includes(state) ? state : "unknown";
}

/** A PR by its URL, numbered as GitHub numbers it. */
export function prOf(url: string) {
  return { url, number: Number(url.match(/\/pull\/(\d+)/)?.[1] ?? 0) };
}

/** Where a candidate Spec stands in its Repo's Queue: `place` from 0 at the head, -1 while not queued. */
export interface QueueStatus {
  place: number;
  of: number;
}

/** An issue's row in a Repo section, keyed as the CLI names it and labelled as the section does. */
export type IssueRow = { key: string; label: string; title: string; url: string } & (
  | { kind: "ready"; base?: string; queue?: QueueStatus }
  | { kind: "stackable" }
  | { kind: "pr-open"; pr: { url: string; number: number } }
  /** In flight, so read-only here: its row to read is In flight. */
  | { kind: "in-flight"; stage: string; pr?: { url: string; number: number } }
);

export type ReadyRow = Extract<IssueRow, { kind: "ready" }>;

export type SpecState = "held" | "running" | "candidate" | "waiting" | "not-startable";

export const SPEC_STATES: Record<SpecState, string> = { held: "Held", running: "Running", candidate: "Candidate", waiting: "Waiting", "not-startable": "Not startable" };

/** A Spec's group: its state, what it does next or why not, and its issues' rows in sub-issue order. */
export interface SpecGroup {
  spec: string;
  state: SpecState;
  label: string;
  title: string;
  url: string;
  note?: { text: string; error: boolean };
  /** A Spec of one In flight is its own issue, so its Stage sits in its heading. */
  stage?: string;
  /** Set for a candidate Spec. */
  queue?: QueueStatus;
  rows: IssueRow[];
}

/** The Repo's Specs as the Scheduler sees them. */
export interface RoomReadout {
  /** A slot per Spec that may run, true while one does. */
  slots: boolean[];
  figures: [string, number][];
  /** The Queue in start order, named as the section names its Specs. */
  queue: string[];
}

export interface RepoSection {
  repo: string;
  /** Its Ready and Stackable issues. */
  count: number;
  errors: string[];
  /** It loaded and has nothing Ready. */
  empty: boolean;
  room?: RoomReadout;
  specs: SpecGroup[];
  /** Ready issues of no Spec but their own, with nothing to group. */
  specsOfOne: ReadyRow[];
  stackable: IssueRow[];
  prOpen: IssueRow[];
}

/** A section per configured Repo, as the Board lays it out. */
export function repoSections(board: BoardJson): RepoSection[] {
  return (board.configured ?? []).map((repo) => repoSection(board, repo));
}

function repoSection(board: BoardJson, repo: string): RepoSection {
  const mine = <T extends { repo: string }>(items: T[] = []) => items.filter((i) => i.repo === repo);
  const errors = mine(board.errors).map((e) => `Could not load: ${e.source ? `${e.source}: ` : ""}${e.error}`);
  const ready = mine(board.issues);
  const stackable = mine(board.stackable);
  const withPr = mine(board.prOpen);
  const specs = mine(board.specs);
  const room = board.rooms?.find((r) => r.repo === repo);
  const queue = room?.queue ?? [];
  const candidate = (spec: string) => room?.candidates.some((c) => sameSpec(c.spec, spec)) ?? false;
  const queueOf = (spec: string): QueueStatus => ({ place: queue.findIndex((s) => sameSpec(s, spec)), of: queue.length });
  const stateOf = (s: JsonSpec): SpecState =>
    s.held ? "held" : s.running ? "running" : candidate(s.spec) ? "candidate" : s.waiting ? "waiting" : "not-startable";
  const row = (i: JsonIssue) => ({ key: i.issue, label: repoKey(i.issue, repo), title: i.title, url: i.url });
  const readyRow = (i: JsonIssue & { base?: string }, queue?: QueueStatus): ReadyRow =>
    ({ kind: "ready", ...row(i), ...(i.base && { base: i.base }), ...(queue && { queue }) });
  const stackRow = (i: JsonIssue): IssueRow => ({ kind: "stackable", ...row(i) });
  const prRow = (i: JsonIssue & { pr: string }): IssueRow => ({ kind: "pr-open", ...row(i), pr: prOf(i.pr) });
  // A Linear issue several Repos claim is In flight only in the Repo it was dispatched in.
  const flightOf = (issue: string) => board.dispatches?.find((d) => sameSlug(d.repo, repo) && sameSlug(d.issue, issue));
  const rowsOf = (spec: JsonSpec) => spec.issues.flatMap((issue): IssueRow[] => {
    const flight = flightOf(issue);
    if (flight) return issue === spec.spec ? [] : [{ kind: "in-flight", ...row(flight), stage: flight.stage, ...(flight.pr && { pr: prOf(flight.pr) }) }];
    const r = ready.find((i) => i.issue === issue);
    if (r) return [readyRow(r)];
    const s = stackable.find((i) => i.issue === issue);
    if (s) return [stackRow(s)];
    const p = withPr.find((i) => i.issue === issue);
    return p ? [prRow(p)] : [];
  });
  // Running first, then Held, then candidates; a Spec of one neither running nor Held is a plain row, which says all there is.
  const order: SpecState[] = ["running", "held", "candidate", "waiting", "not-startable"];
  const grouping = specs.filter((s) => s.running || s.held || s.issues.length !== 1 || s.issues[0] !== s.spec);
  const grouped = new Set(grouping.flatMap((s) => s.issues));
  const groups = grouping
    .map((s, i) => ({ s, i, state: stateOf(s) }))
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.i - b.i)
    .map(({ s, state }): SpecGroup => {
      const note = s.held?.reason ?? s.waiting?.reason ?? s.next?.reason ?? s.reason ?? (state === "not-startable" ? "None of its issues is Ready" : undefined);
      const own = flightOf(s.spec);
      return {
        spec: s.spec, state, label: repoKey(s.spec, repo), title: s.title, url: s.url,
        ...(note && { note: { text: note, error: Boolean(s.held) } }),
        ...(own && { stage: own.stage }),
        ...(state === "candidate" && { queue: queueOf(s.spec) }),
        rows: rowsOf(s),
      };
    });
  const loose = <T extends JsonIssue>(items: T[]) => items.filter((i) => !grouped.has(i.issue));
  return {
    repo,
    count: ready.length + stackable.length,
    errors,
    empty: !errors.length && !ready.length,
    ...(room && { room: roomReadout(room) }),
    specs: groups,
    // A candidate Spec of one is its own row, so its Queue place sits there.
    specsOfOne: loose(ready).map((i) => readyRow(i, candidate(i.issue) ? queueOf(i.issue) : undefined)),
    stackable: loose(stackable).map(stackRow),
    prOpen: loose(withPr).map(prRow),
  };
}

/** A Repo's Specs as the Scheduler sees them: a slot per Spec that may run, filled while one does, and the Queue in start order. */
export function roomReadout({ repo, running, room, candidates, queue }: JsonRoom): RoomReadout {
  return {
    slots: [...running.map(() => true), ...Array<boolean>(room).fill(false)],
    figures: [["Running", running.length], ["Room", room], ["Candidates", candidates.length], ["Queue", queue.length]],
    queue: queue.map((spec) => repoKey(spec, repo)),
  };
}

/** An issue's key within the section of `repo`: `#N` for one of its GitHub issues; another Repo's and a Linear key in full. */
export function repoKey(issue: string, repo: string) {
  const hash = issue.lastIndexOf("#");
  return hash > 0 && sameSlug(issue.slice(0, hash), repo) ? issue.slice(hash) : issue;
}
