import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeTextAtomic } from "./state";

/**
 * The two Markdown records in the config directory that the user and the Lead
 * both edit: the Intent (what the user is working toward) and the Notes (their
 * standing preferences). Each is read and replaced whole.
 */
export const RECORDS = {
  intent: { file: "intent.md", name: "Intent", holds: "what the user is working toward and why" },
  notes: { file: "notes.md", name: "Notes", holds: "the user's standing preferences, recurring decisions with their reasons, and their names for things" },
} as const;
export type RecordName = keyof typeof RECORDS;

/** A record as read: its text (empty when there is none), the version a replace must carry, and its path. */
export interface RecordRead {
  text: string;
  version: string;
  path: string;
}

/** A replace carrying a version that is no longer the record's: someone changed it since it was read. */
export class StaleRecord extends Error {
  constructor(readonly current: RecordRead) {
    super(`the ${current.path} you read has changed since`);
  }
}

function recordPath(dir: string, record: RecordName) {
  return join(dir, RECORDS[record].file);
}

/** The record, or empty text when its file is missing. */
export function readRecord(dir: string, record: RecordName): RecordRead {
  const path = recordPath(dir, record);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return { text, version: versionOf(text), path };
}

/** The record's Markdown, or a line saying it is missing or empty, as the orient packet carries it. */
export function recordOrNone(dir: string, record: RecordName): string {
  const { text, path } = readRecord(dir, record);
  return text.trim() ? text : noneYet(path);
}

/** What stands for a record whose file is missing or empty. */
export function noneYet(path: string) {
  return `none yet: ${path} is missing or empty`;
}

/**
 * Replace the record with `text`. With `version`, only while the record is
 * still the one that version was read from (the user and the Lead both edit
 * it, by hand too); a stale one is refused with the current record.
 */
export function replaceRecord(dir: string, record: RecordName, text: string, version?: string): Promise<RecordRead> {
  return withFileLock(dir, RECORDS[record].file, () => {
    const current = readRecord(dir, record);
    if (version !== undefined && version !== current.version) throw new StaleRecord(current);
    writeTextAtomic(current.path, text);
    return { text, version: versionOf(text), path: current.path };
  });
}

/** A version that changes whenever the text does, however it was edited. */
function versionOf(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
