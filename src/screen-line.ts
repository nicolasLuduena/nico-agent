/** Box-drawing characters a harness draws its panes and input box with. */
const BOX = /^[\s\u2500-\u257f]+|[\s\u2500-\u257f]+$/g;

/** An empty prompt: its marker with nothing typed after it. */
const PROMPT = /^[>›❯$%#]$/;

/** A spinner: a frame of braille dots or Claude Code's stars, or the hint a working harness shows beside one. */
const SPINNER = /^[\u2800-\u28ff✻✽✶✳✢·◐◓◑◒]\s|\besc to interrupt\b/;

/** A harness's own footer hints under its input box, not work. */
const HINT = /^\? for shortcuts\b/;

/**
 * The last line of an agent's screen that says what it is doing: trimmed of
 * the box drawn around it, skipping blank lines, empty prompts, spinners and
 * the harness's hints. None when the screen has no such line.
 */
export function meaningfulLine(screen: string): string | undefined {
  return screen
    .split("\n")
    .map((l) => l.replace(BOX, ""))
    .findLast((l) => l !== "" && !PROMPT.test(l) && !SPINNER.test(l) && !HINT.test(l));
}
