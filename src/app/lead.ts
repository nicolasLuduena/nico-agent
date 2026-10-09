import type { Authored } from "../conversation";
import type { ProposalStatus, SourceWrite } from "../proposals";
import { type HarnessesJson, type LaunchChoice, advanceReport, launchChoice } from "./actions";
import type { BoardJson } from "./board";

/**
 * A Proposal as `nico-agent proposals --all --json` lists it: its action as
 * the command line, or the write the Lead would make to a Repo's Source.
 */
export interface ProposalJson {
  id: number;
  at: string;
  action?: string;
  write?: SourceWrite;
  reason: string;
  status: ProposalStatus;
  decidedAt?: string;
  declineReason?: string;
  outcome?: Record<string, unknown>;
}

/** `nico-agent lead status --json`, as `/api/lead/status` answers it; only `lead` without a Lead. */
export interface LeadStatusJson {
  lead: string;
  harness?: string;
  model?: string;
  effort?: string;
  /** The Lead's Agent state as herdr reports it. */
  state?: string;
  workspace?: string;
  failure?: { step: string; error: string };
  warnings?: string[];
}

/** A message to the Lead, or an answer to its question `question`, shown before `serve` has it. */
export interface PendingSend {
  key: string;
  text: string;
  question?: number;
  /** What the transcription service heard, for a spoken message. */
  raw?: string;
  at: string;
  /** The entry `say` wrote, once it answered. */
  id?: number;
  /** Why it was not sent; it stays until sent again or dismissed. */
  error?: string;
}

/** What the Lead panel holds: the conversation and the Proposals as last fetched, and the sends not in them yet. */
export interface Conversation {
  entries: Authored[];
  proposals: ProposalJson[];
  sends: PendingSend[];
}

export type ConversationEvent =
  | { type: "log"; entries: Authored[] | undefined }
  | { type: "proposals"; proposals: ProposalJson[] | undefined }
  | { type: "send"; key: string; text: string; question?: number; raw?: string; at: string }
  | { type: "sent"; key: string; id: number }
  | { type: "failed"; key: string; error: string }
  | { type: "dismiss"; key: string };

/**
 * The panel's state after `event`. A send is kept until the fetched
 * conversation holds the entry it wrote, so a message never shows twice
 * nor blinks out between `say`'s answer and the refetch.
 */
export function reduce(state: Conversation, event: ConversationEvent): Conversation {
  const sends = (f: (s: PendingSend) => PendingSend | null) => state.sends.flatMap((s) => f(s) ?? []);
  switch (event.type) {
    case "log": {
      // A failed fetch keeps what was shown.
      if (!event.entries) return state;
      const ids = new Set(event.entries.map((e) => e.id));
      return { ...state, entries: event.entries, sends: sends((s) => (s.id !== undefined && ids.has(s.id) ? null : s)) };
    }
    case "proposals":
      return event.proposals ? { ...state, proposals: event.proposals } : state;
    case "send": {
      const { type: _, ...send } = event;
      return { ...state, sends: [...sends((s) => (s.key === event.key ? null : s)), send] };
    }
    case "sent": {
      // The log may hold the entry already, when its refetch beat `say`'s answer.
      const logged = state.entries.some((e) => e.id === event.id);
      return {
        ...state,
        sends: sends((s) => (s.key !== event.key ? s : logged ? null : { ...s, id: event.id })),
      };
    }
    case "failed":
      return { ...state, sends: sends((s) => (s.key === event.key ? { ...s, error: event.error } : s)) };
    case "dismiss":
      return { ...state, sends: sends((s) => (s.key === event.key ? null : s)) };
  }
}

/** An answer as its question's card shows it: given, on its way, or not sent; with what was heard, when it was spoken and differs. */
export interface ShownAnswer {
  text: string;
  raw?: string;
  sending?: boolean;
}

/** One card of the conversation, as the panel draws it. */
export type Card =
  | {
    kind: "message"; key: string; who: "user" | "lead"; text: string; at: string; spoken?: boolean; sending?: boolean; error?: string;
    /** What was heard of a spoken message, when the Scribe's text differs from it. */
    raw?: string;
    /** The id of the user's message this one corrects. */
    corrects?: number;
    /** Whether a later "No, I said …" corrects this message. */
    superseded?: boolean;
  }
  | {
    kind: "question"; key: string; id: number; text: string; choices: string[]; at: string;
    answer?: ShownAnswer;
    /** An answer that was not sent, with why. */
    failure?: { key: string; text: string; error: string };
  }
  | ({ kind: "proposal"; key: string } & ProposalJson);

/**
 * The conversation as cards, oldest first: messages, questions with their
 * answers, and Proposals in their place in time with how they were decided.
 * Answers and decisions are shown on what they answer, never as cards of
 * their own. Sends not in the conversation yet come last.
 */
export function cards({ entries, proposals, sends }: Conversation): Card[] {
  const superseded = new Set(entries.flatMap((e) => (e.type === "user" && e.supersedes !== undefined ? [e.supersedes] : [])));
  const answers = new Map(entries.flatMap((e) => (e.type === "answer" ? [[e.question, e] as const] : [])));
  const answering = (question: number) => sends.find((s) => s.question === question);
  const timeline: Card[] = [];
  let next = 0;
  /** The Proposals made before `at`, in their place. */
  const proposalsUntil = (at: string | null) => {
    for (; next < proposals.length && (at === null || proposals[next]!.at < at); next++) {
      timeline.push({ kind: "proposal", key: `proposal-${proposals[next]!.id}`, ...proposals[next]! });
    }
  };
  for (const e of entries) {
    // Events are the Lead's to read in its Inbox; the user sees what it makes of them.
    if (e.type === "answer" || e.type === "decision" || e.type === "event") continue;
    proposalsUntil(e.at);
    const key = `entry-${e.id}`;
    if (e.type !== "ask") {
      const marks = e.type === "user" && {
        ...spoken(e.text, e.raw),
        ...(e.supersedes !== undefined && { corrects: e.supersedes }),
        ...(superseded.has(e.id) && { superseded: true }),
      };
      timeline.push({ kind: "message", key, who: e.type === "user" ? "user" : "lead", text: e.text, at: e.at, ...marks });
      continue;
    }
    const given = answers.get(e.id);
    const send = answering(e.id);
    const shown = ({ text, raw }: { text: string; raw?: string | undefined }) => ({ text, ...(raw !== undefined && raw !== text && { raw }) });
    const answer = given ? shown(given) : send && !send.error ? { ...shown(send), sending: true } : undefined;
    timeline.push({
      kind: "question", key, id: e.id, text: e.text, choices: e.choices ?? [], at: e.at, answer,
      ...(!answer && send?.error && { failure: { key: send.key, text: send.text, error: send.error } }),
    });
  }
  proposalsUntil(null);
  for (const s of sends) {
    if (s.question !== undefined) continue;
    timeline.push({ kind: "message", key: s.key, who: "user", text: s.text, at: s.at, ...spoken(s.text, s.raw), ...(s.error ? { error: s.error } : { sending: true }) });
  }
  return timeline;
}

/** An item of the Questions list: a question of the Lead's or one of its Proposals, as its card in the conversation. */
export type OpenItem = Extract<Card, { kind: "question" | "proposal" }>;

/**
 * The Questions list: every question of the Lead's not answered yet and
 * every Proposal not decided, oldest first. An answer on its way takes its
 * question off the list at once; one not sent puts it back.
 */
export function openItems(conversation: Conversation): OpenItem[] {
  return cards(conversation).filter((c): c is OpenItem =>
    (c.kind === "question" && !c.answer) || (c.kind === "proposal" && c.status === "open"));
}

/** A message's marks when it was spoken: that it was, and what was heard when the Scribe changed it. */
function spoken(text: string, raw: string | undefined) {
  if (raw === undefined) return {};
  return { spoken: true as const, ...(raw !== text && { raw }) };
}

/** What a decided Proposal's action did, a line each, or why it failed. */
export function proposalLines({ outcome }: Pick<ProposalJson, "outcome">): { text: string; error: boolean }[] {
  if (!outcome) return [];
  if (typeof outcome.error === "string") return [{ text: outcome.error, error: true }];
  if (Array.isArray(outcome.results)) {
    return (outcome.results as { issue: string; result: string; error?: string }[]).map((r) =>
      ({ text: `${r.issue}: ${r.error ? `${r.result}, ${r.error}` : r.result}`, error: Boolean(r.error) }));
  }
  // `advance`'s report, a line per Spec, as Advance now shows it.
  if (Array.isArray(outcome.specs)) {
    return advanceReport(outcome).lines.map((l) => ({ text: l.text, error: ["failed", "error", "warning"].includes(l.result) }));
  }
  return Object.entries(outcome).flatMap(([key, value]) => (typeof value === "string" ? [{ text: `${key}: ${value}`, error: false }] : []));
}

/** `say`'s arguments: the text after `--`, so it is never read as a flag; a spoken message or answer keeps what was heard. */
export function sayArgs(text: string, question?: number, raw?: string): string[] {
  return [...(question !== undefined ? ["--answer", String(question)] : []), ...(raw !== undefined ? ["--raw", raw] : []), "--", text];
}

/** `proposals decline`'s arguments, the reason only when one was given. */
export function declineArgs(id: number, reason: string): string[] {
  return reason.trim() ? [String(id), "--", reason] : [String(id)];
}

/** What the user picked in the Lead's pickers so far; anything unset or no longer valid falls back. */
export type LeadPicks = Partial<Pick<LaunchChoice, "harness" | "model" | "effort">>;

/**
 * The Harness, model and Effort the Lead's pickers offer and show: those
 * chosen while valid, else the running Lead's, else the last launch's.
 */
export function leadChoice(harnesses: HarnessesJson, status: LeadStatusJson | null, chosen: LeadPicks): LaunchChoice | null {
  const { harness, model, effort } = status ?? {};
  // The running Lead's model is its Harness's; another Harness picked starts on that Harness's own.
  const current = chosen.harness === undefined || chosen.harness === harness ? { harness, model, effort } : {};
  return launchChoice(harnesses, { ...current, ...chosen });
}

/**
 * `lead start`'s arguments: the launch picked, and the port the page came
 * from, so the Lead reaches this `serve`'s MCP server. No port means the
 * scheme's default, which `serve` never listens on, so the CLI's default stands.
 */
export function leadStartArgs({ harness, model, effort }: LaunchChoice, port: string): string[] {
  return ["--harness", harness, "--model", model, "--effort", effort, ...(port ? ["--port", port] : [])];
}

/**
 * What the Lead's controls offer: Start a Lead that does not run (resuming
 * one that failed or is gone from herdr), Restart a running one on another
 * launch, and Stop any Lead nico-agent has a record of. One still starting
 * can only be stopped.
 */
export function leadControl(status: LeadStatusJson | null, choice: LaunchChoice | null): { start: "Start" | "Restart" | null; stop: boolean } {
  const known = Boolean(status && status.lead !== "not running");
  // A Lead still starting is left to finish: another start would race it.
  if (status?.lead === "starting") return { start: null, stop: true };
  if (!known || status!.lead !== "running") return { start: "Start", stop: known };
  const same = choice && choice.harness === status!.harness && choice.model === status!.model && choice.effort === status!.effort;
  return { start: same ? null : "Restart", stop: true };
}

/** A warning in the page's one quiet place: what is wrong, and what to do. */
export interface Notice {
  key: string;
  text: string;
  help: string[];
}

/**
 * Everything wrong at once, in the one quiet place above the conversation: `serve`
 * lost (`failure`), the Board unreadable or GitHub rate limited, the Lead not
 * running or failed and its launch's warnings, and voice failing (`talk`).
 * Nothing while the Lead's status is still loading.
 */
export function notices({ failure, status, talk, board }: {
  failure: string | null | undefined;
  status: LeadStatusJson | null;
  talk: { error: string; help: string[] } | null;
  /** The Board the Repos pane reads; a Repo's own failure shows on its row instead. */
  board?: BoardJson | null;
}): Notice[] {
  const shown: Notice[] = [];
  if (failure) shown.push({ key: "serve", text: failure, help: [] });
  if (board?.error) shown.push({ key: "board", text: `The Repos could not be read: ${board.error}`, help: board.help ?? [] });
  if (board?.warning) shown.push({ key: "board-warning", text: board.warning, help: [] });
  if (status?.failure) {
    shown.push({ key: "lead", text: `The Lead failed at ${status.failure.step}: ${status.failure.error}`, help: ["Start it again from Lead in the header"] });
  } else if (status && status.lead !== "running" && status.lead !== "starting") {
    shown.push({ key: "lead", text: "The Lead is not running", help: ["Start it from Lead in the header"] });
  }
  status?.warnings?.forEach((w, i) => shown.push({ key: `lead-warning-${i}`, text: w, help: [] }));
  if (talk) shown.push({ key: "voice", text: talk.error, help: talk.help });
  return shown;
}

/** How close to its end, in pixels, the chat counts as at its end. */
const END_SLACK = 40;

/** Whether the conversation, scrolled as it is, follows new entries: only while the user is at its end, never while reading back. */
export function followsNewEntries({ scrollHeight, scrollTop, clientHeight }: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  return scrollHeight - scrollTop - clientHeight < END_SLACK;
}
