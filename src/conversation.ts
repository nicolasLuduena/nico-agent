import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeJsonAtomic } from "./state";

/**
 * One entry of the conversation between the user and the Lead (ADR-0010),
 * kept append-only. Later kinds (proposal, decision, event) join as new types
 * without changing the shape: an id, a type, a time.
 */
export type Entry = { id: number; at: string } & (
  | { type: "user"; text: string }
  | { type: "lead"; text: string }
  /** A question from the Lead, open until an `answer` names it. */
  | { type: "ask"; text: string; choices?: string[] }
  /** The user's answer to the `ask` entry `question`. */
  | { type: "answer"; question: number; text: string }
);

type Body = Entry extends infer E ? (E extends Entry ? Omit<E, "id" | "at"> : never) : never;

/** An Inbox entry; an answer carries the text of the question it answers. */
export type InboxEntry = Entry | (Answer & { asked: string });

const FILE = "conversation.jsonl";
/** The id of the last entry the Lead read with `inbox`. */
const CURSOR_FILE = "lead-cursor.json";

/** Who wrote `entry`: the Lead's own entries never come back in its Inbox. */
export function author(entry: Entry): "user" | "lead" {
  switch (entry.type) {
    case "user":
    case "answer":
      return "user";
    case "lead":
    case "ask":
      return "lead";
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
  const answered = new Set(entries.flatMap((e) => (e.type === "answer" ? [e.question] : [])));
  return entries.filter((e) => e.type === "ask" && !answered.has(e.id)).map((e) => e.id);
}

/** Append `body` as the next entry, at `at`. */
export function append(dir: string, body: Body, at: Date): Promise<Entry> {
  return withFileLock(dir, FILE, () => write(dir, loadConversation(dir), body, at));
}

type Answer = Extract<Entry, { type: "answer" }>;

/**
 * Append the user's answer to the open question with id `question`, as typed.
 * The same answer again returns the one written (`existing`); any other answer
 * to a question no longer open, or to an id that is not a question, is refused.
 */
export function answerQuestion(dir: string, question: string, text: string, at: Date): Promise<{ answer: Answer; existing: boolean }> {
  return withFileLock(dir, FILE, () => {
    const entries = loadConversation(dir);
    const open = openQuestions(entries);
    const id = open.find((q) => String(q) === question);
    if (id === undefined) {
      const same = entries.find((e): e is Answer => e.type === "answer" && String(e.question) === question && e.text === text);
      if (same) return { answer: same, existing: true };
      const asked = entries.some((e) => e.type === "ask" && String(e.id) === question);
      throw new AnswerRefused(asked ? `question ${question} was already answered` : `no question has id ${question}`, open);
    }
    return { answer: write(dir, entries, { type: "answer", question: id, text }, at) as Answer, existing: false };
  });
}

/**
 * The entries the Lead has not read, leaving out the ones it wrote, and move
 * its cursor past them, so each is returned once.
 */
export function readInbox(dir: string): Promise<InboxEntry[]> {
  return withFileLock(dir, FILE, () => {
    const entries = loadConversation(dir);
    const cursor = loadCursor(dir);
    const unread = entries.filter((e) => e.id > cursor);
    if (unread.length) writeJsonAtomic(join(dir, CURSOR_FILE), { cursor: unread.at(-1)!.id });
    return unread.filter((e) => author(e) === "user").map((e) => {
      if (e.type !== "answer") return e;
      const question = entries.find((q) => q.id === e.question);
      return { ...e, asked: question?.type === "ask" ? question.text : "" };
    });
  });
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
