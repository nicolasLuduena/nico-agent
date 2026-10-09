import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "./state";

/**
 * One entry of a Partner's Thread (ADR-0014), in the Conversation's entry
 * shape: an id, a type, a time; kept append-only.
 */
export type ThreadEntry = { id: number; at: string } & (
  /** A message from the user, typed into the Partner's pane. */
  | { type: "user"; text: string }
  /** The Partner's reply, through its `say`. */
  | { type: "partner"; text: string }
  /** A Hand-off the Partner drafted, open until the user hands it or a later draft replaces it. */
  | { type: "draft"; text: string }
  /** The draft `draft` the user handed to the Lead, as approved; the Lead's Conversation holds it as the user's message. */
  | { type: "handoff"; draft: number; text: string }
);

type ThreadBody = ThreadEntry extends infer E ? (E extends ThreadEntry ? Omit<E, "id" | "at"> : never) : never;

export type Draft = Extract<ThreadEntry, { type: "draft" }>;

/** The Thread in `file`, a path under the config directory, oldest first; empty before its first entry. */
export function loadThread(configDir: string, file: string): ThreadEntry[] {
  let text: string;
  try {
    text = readFileSync(join(configDir, file), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as ThreadEntry);
}

/** The Partner's last draft, while no Hand-off has sent it. */
export function openDraft(entries: ThreadEntry[]): Draft | null {
  const draft = entries.findLast((e): e is Draft => e.type === "draft");
  if (!draft || entries.some((e) => e.type === "handoff" && e.draft === draft.id)) return null;
  return draft;
}

/** Append `body` to the Thread in `file` as its next entry, at `at`. */
export function appendThread(configDir: string, file: string, body: ThreadBody, at: Date): Promise<ThreadEntry> {
  return withThread(configDir, file, (entries) => appendAfter(configDir, file, entries, body, at));
}

/** Run `fn` on the Thread in `file` holding its lock, so it can check the entries before appending. */
export function withThread<T>(configDir: string, file: string, fn: (entries: ThreadEntry[]) => T): Promise<T> {
  const path = join(configDir, file);
  mkdirSync(dirname(path), { recursive: true });
  return withFileLock(dirname(path), file.split("/").pop()!, () => fn(loadThread(configDir, file)));
}

/** Append `body` after `entries`, the Thread as read under its lock (see `withThread`). */
export function appendAfter(configDir: string, file: string, entries: ThreadEntry[], body: ThreadBody, at: Date): ThreadEntry {
  const entry = { id: (entries.at(-1)?.id ?? 0) + 1, at: at.toISOString(), ...body } as ThreadEntry;
  appendFileSync(join(configDir, file), `${JSON.stringify(entry)}\n`);
  return entry;
}
