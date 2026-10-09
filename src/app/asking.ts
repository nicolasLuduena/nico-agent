import type { BoardJson } from "./board";

/** `answer`'s arguments: the issue, then the text after `--`, so it is never read as a flag. */
export function answerArgs(issue: string, text: string): string[] {
  return ["--", issue, text];
}

/** A numbered option an Asking Implementer's screen shows: a button sends its number. */
export interface Choice {
  number: string;
  label: string;
}

/** An option's line, out of any box: an optional cursor, its number, and its label. */
const OPTION = /^[❯›>]?\s*(\d{1,2})[.)]\s+(\S.*)$/;

/**
 * The numbered options a screen's question offers: the last list on it that
 * counts up from 1, other lines (an option's description, a rule) between its
 * options. None when the screen shows no list of two or more.
 */
export function screenChoices(screen: string): Choice[] {
  let last: Choice[] = [];
  let run: Choice[] = [];
  for (const line of screen.split("\n")) {
    const match = line.replace(/^\s*│/, "").replace(/│\s*$/, "").trim().match(OPTION);
    if (!match) continue;
    const [, number, label] = match as unknown as [string, string, string];
    if (number === "1") {
      run = [];
      last = run;
    }
    if (Number(number) === run.length + 1) run.push({ number, label: label.trim() });
  }
  return last.length >= 2 ? last : [];
}

/** An Asking Implementer as its toast shows it: its issue and question, and the choices its screen offers. */
export interface AskingItem {
  kind: "asking";
  key: string;
  issue: string;
  /** The issue's title, while the Board lists its Dispatch. */
  title?: string;
  /** The Spec the issue belongs to, unless it is a Spec of its own. */
  spec?: string;
  question: string;
  /** Why its screen could not be read; the question is then empty. */
  error?: string;
  choices: Choice[];
}

/**
 * Each Implementer the Board lists as Asking, as a toast; a Gardener's
 * question is not one. `answered` holds the question each issue was last
 * answered on from its toast: that toast hides until the Board shows the
 * Implementer stopped Asking or asking something else.
 */
export function askingItems(board: BoardJson | null, answered: Record<string, string> = {}): AskingItem[] {
  return (board?.asking ?? []).flatMap((a): AskingItem[] => {
    if (a.issue === undefined || answered[a.issue] === a.question) return [];
    const title = board?.dispatches?.find((d) => d.issue === a.issue)?.title;
    return [{
      kind: "asking", key: `asking-${a.issue}`, issue: a.issue, ...(title && { title }), ...(a.spec && { spec: a.spec }),
      question: a.question, ...(a.error && { error: a.error }), choices: screenChoices(a.question),
    }];
  });
}
