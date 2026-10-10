import type { BoardJson } from "./app/board";

/** How many issues of one list the Front voice reads, before "and N more". */
const LIST_LIMIT = 20;

/** How much of an Asking agent's question the Front voice reads: its end, where the question is. */
const QUESTION_CHARS = 300;

/**
 * The Board, as `board --json` prints it, as the Front voice reads it (ADR-0013):
 * what is In flight with its Stage and PR, what is Asking, what is Ready,
 * Stackable or has a PR outside a Dispatch, what is Held, each Repo's Queue,
 * and why the Board, or a Repo, could not be loaded. A line each, short
 * enough for a quick first token, and never the raw JSON.
 */
export function boardSummary(board: BoardJson): string {
  if (board.error) return `The Board could not be read: ${board.error}`;
  const lines: string[] = [];
  const dispatches = board.dispatches ?? [];
  if (dispatches.length) {
    lines.push(`In flight (${dispatches.length}):`);
    for (const d of dispatches) {
      const asking = [d.implementer === "blocked" && "its Implementer", d.reviewer === "blocked" && "its Reviewer"].filter(Boolean);
      const details = [d.stage, d.pr, asking.length && `${asking.join(" and ")} ${asking.length > 1 ? "are" : "is"} Asking`].filter(Boolean);
      lines.push(`- ${named(d.issue, d.title)}: ${details.join(", ")}`);
    }
  }
  const asking = board.asking ?? [];
  if (asking.length) {
    lines.push("Asking the user:");
    for (const a of asking) {
      const who = a.gardener !== undefined ? `the Gardener of ${a.gardener}` : a.issue;
      const question = a.question.trim() || `(its question could not be read${a.error ? `: ${a.error}` : ""})`;
      lines.push(`- ${who}: ${tail(question)}`);
    }
  }
  /** One line of a list of issues, `label` and its count first, cut short after `LIST_LIMIT`. */
  const list = <T>(label: string, all: T[] | undefined, line: (row: T) => string) => {
    if (!all?.length) return;
    const shown = all.slice(0, LIST_LIMIT).map(line);
    if (all.length > LIST_LIMIT) shown.push(`and ${all.length - LIST_LIMIT} more`);
    lines.push(`${label} (${all.length}): ${shown.join("; ")}`);
  };
  list("Ready", board.issues, (i) => named(i.issue, i.title));
  list("Stackable", board.stackable, (i) => named(i.issue, i.title));
  list("PR open outside a Dispatch", board.prOpen, (i) => `${named(i.issue, i.title)}, ${i.pr}`);
  if (!lines.length) lines.push("Nothing is Ready or In flight.");
  const held = (board.specs ?? []).filter((s) => s.held);
  if (held.length) lines.push(`Held: ${held.map((s) => `${named(s.spec, s.title)} (${s.held!.reason})`).join("; ")}`);
  for (const room of board.rooms ?? []) {
    if (room.queue?.length) lines.push(`Queue of ${room.repo}: ${room.queue.join(", ")}`);
  }
  if (board.warning) lines.push(`Warning: ${board.warning}`);
  if (board.errors?.length) lines.push(`Could not load: ${board.errors.map((e) => `${e.repo}: ${e.error}`).join("; ")}`);
  return lines.join("\n");
}

/** An issue or Spec as its id and title. */
function named(id: string, title: string | undefined) {
  return [id, title].filter(Boolean).join(" ");
}

/** The end of a long question, where an agent's screen asks it. */
function tail(text: string) {
  return text.length > QUESTION_CHARS ? `…${text.slice(-QUESTION_CHARS)}` : text;
}
