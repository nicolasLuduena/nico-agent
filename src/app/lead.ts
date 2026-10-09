import type { Authored } from "../conversation";
import type { ProposalStatus } from "../proposals";
import { type HarnessesJson, type LaunchChoice, advanceReport, launchChoice } from "./actions";

/** A Proposal as `nico-agent proposals --all --json` lists it: its action as the command line. */
export interface ProposalJson {
  id: number;
  at: string;
  action: string;
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
export interface Send {
  key: string;
  text: string;
  question?: number;
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
  sends: Send[];
}

export type ConversationEvent =
  | { type: "log"; entries: Authored[] | undefined }
  | { type: "proposals"; proposals: ProposalJson[] | undefined }
  | { type: "send"; key: string; text: string; question?: number; at: string }
  | { type: "sent"; key: string; id: number }
  | { type: "failed"; key: string; error: string }
  | { type: "dismiss"; key: string };

/**
 * The panel's state after `event`. A send is kept until the fetched
 * conversation holds the entry it wrote, so a message never shows twice
 * nor blinks out between `say`'s answer and the refetch.
 */
export function reduce(state: Conversation, event: ConversationEvent): Conversation {
  const sends = (f: (s: Send) => Send | null) => state.sends.flatMap((s) => f(s) ?? []);
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
    case "sent":
      return { ...state, sends: sends((s) => (s.key === event.key ? { key: s.key, text: s.text, at: s.at, id: event.id, ...(s.question !== undefined && { question: s.question }) } : s)) };
    case "failed":
      return { ...state, sends: sends((s) => (s.key === event.key ? { ...s, error: event.error } : s)) };
    case "dismiss":
      return { ...state, sends: sends((s) => (s.key === event.key ? null : s)) };
  }
}

/** An answer as its question's card shows it: given, on its way, or not sent. */
export interface ShownAnswer {
  text: string;
  sending?: boolean;
}

/** One card of the conversation, as the panel draws it. */
export type Card =
  | { kind: "message"; key: string; who: "user" | "lead"; text: string; at: string; sending?: boolean; error?: string }
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
  const answers = new Map(entries.flatMap((e) => (e.type === "answer" ? [[e.question, e.text] as const] : [])));
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
    if (e.type === "answer" || e.type === "decision") continue;
    proposalsUntil(e.at);
    const key = `entry-${e.id}`;
    if (e.type !== "ask") {
      timeline.push({ kind: "message", key, who: e.who, text: e.text, at: e.at });
      continue;
    }
    const given = answers.get(e.id);
    const send = answering(e.id);
    const answer = given !== undefined ? { text: given } : send && !send.error ? { text: send.text, sending: true } : undefined;
    timeline.push({
      kind: "question", key, id: e.id, text: e.text, choices: e.choices ?? [], at: e.at, answer,
      ...(!answer && send?.error && { failure: { key: send.key, text: send.text, error: send.error } }),
    });
  }
  proposalsUntil(null);
  for (const s of sends) {
    if (s.question !== undefined) continue;
    timeline.push({ kind: "message", key: s.key, who: "user", text: s.text, at: s.at, ...(s.error ? { error: s.error } : { sending: true }) });
  }
  return timeline;
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

/** `say`'s arguments: the text after `--`, so it is never read as a flag. */
export function sayArgs(text: string, question?: number): string[] {
  return [...(question !== undefined ? ["--answer", String(question)] : []), "--", text];
}

/** `proposals decline`'s arguments, the reason only when one was given. */
export function declineArgs(id: number, reason: string): string[] {
  return reason.trim() ? [String(id), "--", reason] : [String(id)];
}

/**
 * The Harness, model and Effort the Lead's pickers offer and show: those
 * chosen while valid, else the running Lead's, else the last launch's.
 */
export function leadChoice(harnesses: HarnessesJson, status: LeadStatusJson | null, chosen: { harness?: string; model?: string; effort?: string }): LaunchChoice | null {
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
 * launch, and Stop any Lead nico-agent has a record of.
 */
export function leadControl(status: LeadStatusJson | null, choice: LaunchChoice | null): { start: "Start" | "Restart" | null; stop: boolean } {
  const known = Boolean(status && status.lead !== "not running");
  if (!known || status!.lead !== "running") return { start: "Start", stop: known };
  const same = choice && choice.harness === status!.harness && choice.model === status!.model && choice.effort === status!.effort;
  return { start: same ? null : "Restart", stop: true };
}
