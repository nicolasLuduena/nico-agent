/** An option a pane shows: the digit that picks it, and what it says. */
export interface Option {
  key: string;
  label: string;
}

/** `1. Yes`, after any box edge and the `❯` marker; what it says ends at a gap of two spaces, where a preview or the box's edge starts. */
const NUMBERED = /^[\s│]*(?:[❯›>]\s*)?([1-9])\.\s+(.*?)(?:\s{2,}.*)?$/;

/**
 * The options of the dialog `pane` shows: its last run of lines numbered
 * from `1.` up, so a list the agent wrote above the dialog is not taken.
 */
export function options(pane: string): Option[] {
  let run: Option[] = [];
  for (const line of pane.split("\n")) {
    const [, key, label] = NUMBERED.exec(line) ?? [];
    if (key === "1") run = [];
    if (key && Number(key) === run.length + 1) run.push({ key, label: label.replace(/[\s│]+$/, "") });
  }
  return run;
}
