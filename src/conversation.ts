import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Proposal, type ProposalStatus, type Proposed, openProposals } from "./proposals";
import { recordOrNone } from "./records";
import { withFileLock, writeJsonAtomic } from "./state";

/**
 * One entry of the conversation between the user and the Lead (ADR-0010),
 * kept append-only. Each kind has the same shape: an id, a type, a time.
 */
export type Entry = { id: number; at: string } & (
  /**
   * A message from the user; `raw` is what the transcription service heard
   * when it was spoken, and `supersedes` the user's message it corrects.
   */
  | { type: "user"; text: string; raw?: string; supersedes?: number }
  | { type: "lead"; text: string }
  /** A question from the Lead, open until an `answer` names it. */
  | { type: "ask"; text: string; choices?: string[] }
  /** The user's answer to the `ask` entry `question`; `raw` is what was heard when it was spoken. */
  | { type: "answer"; question: number; text: string; raw?: string }
  /**
   * The user's decision on the Proposal `proposal`, with its action or write,
   * the Lead's `reason` for it, and what running the action printed; `text`
   * is why it was declined or failed, if known.
   */
  | ({ type: "decision"; proposal: number; decision: Exclude<ProposalStatus, "open">; reason: string; text: string; outcome?: Record<string, unknown> } & Proposed)
  /**
   * What the Front voice said aloud (ADR-0013); `heard` is what the user said
   * that it answered itself, never handed to the Lead.
   */
  | { type: "front-voice"; text: string; heard?: string }
  /** A change nico-agent saw on the PR `pr` (the URL) of the issue `issue`, summed up in one line. */
  | { type: "event"; pr: string; issue: string; change: PrChange; text: string }
);

/** What changed on a PR: a comment, a review, a check's result, a merge conflict, or its state. */
export type PrChange = "comment" | "review" | "check" | "conflict" | "ready" | "merged" | "closed";

type Body = Entry extends infer E ? (E extends Entry ? Omit<E, "id" | "at"> : never) : never;

/**
 * An Inbox entry; an answer carries the text of the question it answers, a
 * correction the text it supersedes, and a message corrected since the id of
 * the correction.
 */
export type InboxEntry = Entry | (Answer & { asked: string }) | (User & { superseded?: string; supersededBy?: number });

/**
 * What the Lead needs to know where it stands after a restart or a compacted
 * context, handed over with every Inbox: the Intent and Notes, its open
 * questions and Proposals, and the last exchanges. nico-agent keeps them, not the Harness.
 */
export interface Orient {
  /** The Intent's Markdown, or a line saying there is none yet. */
  intent: string;
  /** The Notes' Markdown, or a line saying there are none yet. */
  notes: string;
  /** The Lead's questions not answered yet, oldest first. */
  open: Entry[];
  /** The Lead's Proposals the user has not decided yet, oldest first. */
  proposals: Proposal[];
  /** The last entries, oldest first, with who wrote each. */
  last: Authored[];
}

/** Who wrote an entry: the user, the Lead, the Front voice, or nico-agent itself (an event). */
export type Author = "user" | "lead" | "front-voice" | "nico-agent";

/** An entry with who wrote it, as the user and the Lead read the conversation. */
export type Authored = Entry & { who: Author };

const FILE = "conversation.jsonl";
/** How many of the last entries the orient packet carries. */
const LAST = 10;
/** The id of the last entry the Lead read with `inbox`. */
const CURSOR_FILE = "lead-cursor.json";

/** Who wrote `entry`: the Lead's own entries never come back in its Inbox, nor the Front voice's, which it reads in its orient packet. */
function author(entry: Entry): Author {
  switch (entry.type) {
    case "user":
    case "answer":
    case "decision":
      return "user";
    case "lead":
    case "ask":
      return "lead";
    case "front-voice":
      return "front-voice";
    case "event":
      return "nico-agent";
  }
}

/** Why an answer was refused: no `ask` entry has the id, or it was answered already. */
export class AnswerRefused extends Error {
  constructor(
    message: string,
    readonly open: number[],
  ) {
    super(message);
  }
}

/** The whole conversation, oldest first. */
export function loadConversation(dir: string): Entry[] {
  let text: string;
  try {
    text = readFileSync(join(dir, FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Entry);
}

/** Ids of the Lead's questions not answered yet, oldest first. */
export function openQuestions(entries: Entry[]): number[] {
  return openAsks(entries).map((e) => e.id);
}

/** The Lead's questions not answered yet, oldest first. */
export function openAsks(entries: Entry[]): Ask[] {
  const answered = new Set(entries.flatMap((e) => (e.type === "answer" ? [e.question] : [])));
  return entries.filter((e): e is Ask => e.type === "ask" && !answered.has(e.id));
}

/**
 * The entries whose text, a question's choices, or a decision's reason
 * contain `query` ignoring case, written from `since` until `until` when
 * given, oldest first.
 */
export function recall(entries: Entry[], query: string, range: { since?: Date | undefined; until?: Date | undefined } = {}): Authored[] {
  const needle = query.toLowerCase();
  return entries
    .filter((e) => [e.text, ...(e.type === "ask" ? (e.choices ?? []) : []), ...(e.type === "decision" ? [e.reason] : [])].some((t) => t.toLowerCase().includes(needle)))
    .filter((e) => (!range.since || new Date(e.at) >= range.since) && (!range.until || new Date(e.at) <= range.until))
    .map(authored);
}

/** `entry` with who wrote it, right after its id. */
export function authored(entry: Entry): Authored {
  const { id, ...rest } = entry;
  return { id, who: author(entry), ...rest } as Authored;
}

/** Append `body` as the next entry, at `at`. */
export function append(dir: string, body: Body, at: Date): Promise<Entry> {
  return withFileLock(dir, FILE, () => write(dir, loadConversation(dir), body, at));
}

export type Ask = Extract<Entry, { type: "ask" }>;
type Answer = Extract<Entry, { type: "answer" }>;
type User = Extract<Entry, { type: "user" }>;

/** How the user takes back their last message, typed or spoken: "No, I said …". */
const CORRECTION = /^\s*(?:no\b[\s,.;:!—–-]*)+i said\b/i;

/** Whether the user's message, in its text or in what was heard, starts "No, I said": a Correction. */
export function isCorrection(message: { text: string; raw?: string | undefined }) {
  return [message.text, message.raw].some((t) => t !== undefined && CORRECTION.test(t));
}

/**
 * Append the user's message, as typed or, with `raw`, as spoken. One that
 * starts "No, I said", in its text or in what was heard, supersedes the
 * user's last message.
 */
export function sayToLead(dir: string, message: { text: string; raw?: string }, at: Date): Promise<User> {
  return withFileLock(dir, FILE, () => {
    const entries = loadConversation(dir);
    const last = entries.findLast((e) => e.type === "user");
    const corrects = last && isCorrection(message);
    return write(dir, entries, { type: "user", ...message, ...(corrects && { supersedes: last.id }) }, at) as User;
  });
}

/**
 * Append the user's answer to the open question with id `question`, as typed
 * or, with `raw`, as spoken. A question already answered, or an id that is
 * not a question, is refused.
 */
export function answerQuestion(dir: string, question: string, text: string, at: Date, raw?: string): Promise<Answer> {
  return withFileLock(dir, FILE, () => {
    const entries = loadConversation(dir);
    const open = openQuestions(entries);
    const id = open.find((q) => String(q) === question);
    if (id === undefined) {
      const asked = entries.some((e) => e.type === "ask" && String(e.id) === question);
      throw new AnswerRefused(asked ? `question ${question} was already answered` : `no question has id ${question}`, open);
    }
    return write(dir, entries, { type: "answer", question: id, text, ...(raw !== undefined && { raw }) }, at) as Answer;
  });
}

/**
 * The entries the Lead has not read, leaving out the ones it wrote, and move
 * its cursor past them, so each is returned once; with the orient packet.
 */
export function readInbox(dir: string): Promise<{ entries: InboxEntry[]; orient: Orient }> {
  return withFileLock(dir, FILE, () => {
    const entries = loadConversation(dir);
    const cursor = loadCursor(dir);
    const unread = entries.filter((e) => e.id > cursor);
    if (unread.length) writeJsonAtomic(join(dir, CURSOR_FILE), { cursor: unread.at(-1)!.id });
    const textOf = (id: number, type: Entry["type"]) => {
      const entry = entries.find((e) => e.id === id);
      return entry?.type === type ? entry.text : "";
    };
    const correction = new Map(entries.flatMap((e) => (e.type === "user" && e.supersedes !== undefined ? [[e.supersedes, e.id] as const] : [])));
    const inbox = unread.filter((e) => author(e) !== "lead" && author(e) !== "front-voice").map((e): InboxEntry => {
      if (e.type === "answer") return { ...e, asked: textOf(e.question, "ask") };
      if (e.type !== "user") return e;
      const supersededBy = correction.get(e.id);
      return {
        ...e,
        ...(e.supersedes !== undefined && { superseded: textOf(e.supersedes, "user") }),
        ...(supersededBy !== undefined && { supersededBy }),
      };
    });
    return { entries: inbox, orient: orientOf(dir, entries) };
  });
}

/** The orient packet, read without moving the Lead's cursor: what the Front voice reads of where the Lead stands. */
export function orient(dir: string): Orient {
  return orientOf(dir, loadConversation(dir));
}

function orientOf(dir: string, entries: Entry[]): Orient {
  return {
    intent: recordOrNone(dir, "intent"),
    notes: recordOrNone(dir, "notes"),
    open: openAsks(entries),
    proposals: openProposals(dir),
    last: entries.slice(-LAST).map(authored),
  };
}

function loadCursor(dir: string): number {
  try {
    return (JSON.parse(readFileSync(join(dir, CURSOR_FILE), "utf8")) as { cursor: number }).cursor;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
}

function write(dir: string, entries: Entry[], body: Body, at: Date): Entry {
  const entry = { id: (entries.at(-1)?.id ?? 0) + 1, at: at.toISOString(), ...body } as Entry;
  appendFileSync(join(dir, FILE), `${JSON.stringify(entry)}\n`);
  return entry;
}
