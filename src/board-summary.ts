/** How many issues of one list the Front voice reads, before "and N more". */
const LIST_LIMIT = 20;

/** How much of an Asking agent's question the Front voice reads: its end, where the question is. */
const QUESTION_CHARS = 300;

type Row = Record<string, unknown>;

/**
 * The Board, as `board --json` prints it, as the Front voice reads it (ADR-0013):
 * what is In flight with its Stage and PR, what is Asking, what is Ready,
 * Stackable or has a PR outside a Dispatch, what is Held, each Repo's Queue,
 * and why a Repo could not be loaded. A line each, short enough for a quick
 * first token, and never the raw JSON.
 */
export function boardSummary(board: Row): string {
  const dispatches = rows(board.dispatches);
  const lines: string[] = [];
  if (dispatches.length) {
    lines.push(`In flight (${dispatches.length}):`);
    for (const d of dispatches) {
      const asking = [d.implementer === "blocked" && "its Implementer", d.reviewer === "blocked" && "its Reviewer"].filter(Boolean);
      const details = [d.stage, d.pr, asking.length && `${asking.join(" and ")} ${asking.length > 1 ? "are" : "is"} Asking`].filter(Boolean);
      lines.push(`- ${named(d, "issue")}: ${details.join(", ")}`);
    }
  }
  const asking = rows(board.asking);
  if (asking.length) {
    lines.push("Asking the user:");
    for (const a of asking) {
      const who = typeof a.gardener === "string" ? `the Gardener of ${a.gardener}` : String(a.issue);
      lines.push(`- ${who}: ${tail(String(a.question ?? "").trim() || "(its question could not be read)")}`);
    }
  }
  const list = (label: string, key: string, line: (row: Row) => string) => {
    const all = rows(board[key]);
    if (!all.length) return;
    const shown = all.slice(0, LIST_LIMIT).map(line);
    if (all.length > LIST_LIMIT) shown.push(`and ${all.length - LIST_LIMIT} more`);
    lines.push(`${label} (${all.length}): ${shown.join("; ")}`);
  };
  list("Ready", "issues", (i) => named(i, "issue"));
  list("Stackable", "stackable", (i) => named(i, "issue"));
  list("PR open outside a Dispatch", "prOpen", (i) => `${named(i, "issue")}, ${i.pr}`);
  if (!lines.length) lines.push("Nothing is Ready or In flight.");
  const held = rows(board.specs).filter((s) => s.held);
  if (held.length) lines.push(`Held: ${held.map((s) => `${named(s, "spec")} (${s.held})`).join("; ")}`);
  for (const room of rows(board.rooms)) {
    const queue = Array.isArray(room.queue) ? room.queue : [];
    if (queue.length) lines.push(`Queue of ${room.repo}: ${queue.join(", ")}`);
  }
  if (typeof board.warning === "string") lines.push(`Warning: ${board.warning}`);
  const errors = rows(board.errors);
  if (errors.length) lines.push(`Could not load: ${errors.map((e) => `${e.repo}: ${e.error}`).join("; ")}`);
  return lines.join("\n");
}

/** `value` as a list of rows, or none. */
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((v): v is Row => v !== null && typeof v === "object") : [];
}

/** An issue or Spec as its id and title. */
function named(row: Row, id: string) {
  return [row[id], row.title].filter(Boolean).join(" ");
}

/** The end of a long question, where an agent's screen asks it. */
function tail(text: string) {
  return text.length > QUESTION_CHARS ? `…${text.slice(-QUESTION_CHARS)}` : text;
}
