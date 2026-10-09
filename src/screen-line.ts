/** The box-drawing characters, and spaces, at either end of a line: the edges of a harness's panes and input box. */
const BOX_EDGES = /^[\s\u2500-\u257f]+|[\s\u2500-\u257f]+$/g;

/** An empty prompt: its marker with nothing typed after it. */
const PROMPT = /^[>›❯$%#]$/;

/**
 * A spinner: a frame of braille dots or circle quarters, a star or dot beside
 * its one word ("✻ Thinking…"), or the hint a working harness shows beside one.
 */
const SPINNER = /^[\u2800-\u28ff◐◓◑◒]\s|^[✻✽✶✳✢·*]\s+\S+…|\besc to interrupt\b/;

/** A harness's own footer under its input box, not work: its hints, its mode line, the context it has left. */
const HINT = /^\? for shortcuts\b|^⏵|\(shift\+tab to cycle\)|^Context left until auto-compact\b/;

/**
 * The last line of an agent's screen that says what it is doing: trimmed of
 * the box drawn around it, skipping blank lines, empty prompts, spinners and
 * the harness's hints. None when the screen has no such line.
 */
export function meaningfulLine(screen: string): string | undefined {
  return screen
    .split("\n")
    .map((l) => l.replace(BOX_EDGES, ""))
    .findLast((l) => l !== "" && !PROMPT.test(l) && !SPINNER.test(l) && !HINT.test(l));
}
