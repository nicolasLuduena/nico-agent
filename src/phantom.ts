/**
 * Whisper invents text from silence and noise: a phrase looped over and
 * over, a line from the end of a video, or the app's own voice heard back
 * through the microphone. `screen` drops those before the Front voice or the
 * Lead hears them (see docs/voice.md, "Phantom transcripts").
 */

/** A stretch of a transcript, as speaches tells of it (`verbose_json`): where it lies, in seconds, and how likely it is not speech. */
export interface Segment {
  start: number;
  end: number;
  noSpeech: number;
}

/** What a transcript was, as heard: its text and, where the service tells of them, its segments. */
export interface Heard {
  text: string;
  segments?: Segment[];
}

/** Why a transcript was dropped. */
export type Phantom = "phantom phrase" | "no speech" | "echo";

/** How likely, over the whole transcript, it is not speech when dropped: Whisper's own no_speech_threshold. */
const NO_SPEECH = 0.6;

/** How many times in a row a phrase is said before it is taken for Whisper looping. */
const REPEATS = 3;

/** The longest run of words looped within a clause ("no no no", "thank you thank you thank you"). */
const LOOPED_WORDS = 3;

/** The longest clause, in words, taken for a looped phrase: a long one said again is meant. */
const SHORT_PHRASE = 12;

/** How alike two clauses are, as words in order, to be the same phrase looped ("This is not …", "it is not …"). */
const ALIKE = 0.7;

/** The fewest words heard taken for an echo: a shorter answer ("yes", "the second one") is the user's. */
const ECHO_WORDS = 3;

/** How much of what was heard, in order, is in what the app said, to be its echo. */
const ECHOED = 0.8;

/**
 * What the Front voice is to hear of `heard`, a final transcript: its text,
 * with a phrase Whisper looped said once; or why it is dropped: mostly not
 * speech, only one of Whisper's silence phrases, or an echo of `playing`,
 * what the app was saying aloud when the utterance began.
 */
export function screen(heard: Heard, playing: string[] = []): { text: string } | { dropped: Phantom } {
  if (noSpeech(heard.segments ?? []) > NO_SPEECH) return { dropped: "no speech" };
  const text = unlooped(heard.text);
  if (heard.text.trim() && isPhantomPhrase(text)) return { dropped: "phantom phrase" };
  if (isEcho(text, playing)) return { dropped: "echo" };
  return { text };
}

/** Whether `text` is mostly words of `playing`, in the order said: the app heard itself. */
function isEcho(text: string, playing: string[]) {
  const heard = words(text);
  if (heard.length < ECHO_WORDS || !playing.length) return false;
  return common(heard, playing.flatMap(words)) / heard.length >= ECHOED;
}

/**
 * What Whisper says of silence, music or a room's noise, learnt from the
 * captions of videos: a transcript that is only one of these, or no words at
 * all, is dropped. Matched on its words, lower case, without punctuation.
 */
const PHANTOM_PHRASES: RegExp[] = [
  /^(thanks|thank you)( (so|very) much)?( for watching| for listening)?$/,
  /^(please )?(like and )?subscribe( to (my|the|our) channel)?$/,
  /^(subtitles|captions|transcription|transcribed|translated|translation|subtitled) by\b/,
  /^(you|bye|bye bye)$/,
];

/** Whether `text` is only one of Whisper's silence phrases, or has no words. */
function isPhantomPhrase(text: string) {
  const said = words(text).join(" ");
  return !said || PHANTOM_PHRASES.some((phrase) => phrase.test(said));
}

/** How likely `segments` are not speech, on average over their length; 0 without any. */
function noSpeech(segments: Segment[]): number {
  const length = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  if (!length) return 0;
  return segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start) * s.noSpeech, 0) / length;
}

/** `text` with each phrase repeated REPEATS times or more in a row said once, ended as a sentence. */
function unlooped(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  const kept = collapse(tokens, LOOPED_WORDS);
  // A clause ends at punctuation before a space, never at a decimal point ("0.5s").
  const clauses = kept.join(" ").match(/.+?(?:[.,!?;:]+(?=\s|$)|$)/g)?.map((c) => c.trim()).filter(Boolean) ?? [];
  let looped = kept.length < tokens.length;
  const said: string[] = [];
  for (let i = 0; i < clauses.length;) {
    const phrase = words(clauses[i]!);
    let j = i + 1;
    if (phrase.length <= SHORT_PHRASE) while (j < clauses.length && alike(phrase, words(clauses[j]!)) >= ALIKE) j++;
    if (j - i < REPEATS) {
      said.push(clauses[i++]!);
      continue;
    }
    // Cut off mid-phrase at the end: the loop's last, partial turn.
    const last = j === clauses.length - 1 ? words(clauses[j]!) : null;
    if (last && last.length && common(phrase, last) / last.length >= 0.75) j++;
    said.push(clauses[i]!);
    i = j;
    looped = true;
  }
  if (!looped) return text.trim();
  return said.join(" ").replace(/[,;:\s]*$/, "").replace(/[^.!?]$/, "$&.");
}

/** `tokens` with each run of up to `longest` tokens repeated REPEATS times or more in a row kept once. */
function collapse(tokens: string[], longest: number): string[] {
  const plain = tokens.map((t) => words(t).join(" "));
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    let skip = 0;
    for (let n = 1; n <= longest && !skip; n++) {
      let k = 1;
      while (i + (k + 1) * n <= tokens.length && plain.slice(i + k * n, i + (k + 1) * n).join(" ") === plain.slice(i, i + n).join(" ")) k++;
      if (k >= REPEATS && plain[i]) skip = k * n;
      if (skip) out.push(...tokens.slice(i, i + n));
    }
    if (skip) i += skip;
    else out.push(tokens[i++]!);
  }
  return out;
}

/** The words of `text`, lower case, without punctuation. */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** How many words `a` and `b` have in common, in order (their longest common subsequence). */
function common(a: string[], b: string[]): number {
  let row = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const next = [0];
    for (let j = 0; j < b.length; j++) next.push(word === b[j] ? row[j]! + 1 : Math.max(row[j + 1]!, next[j]!));
    row = next;
  }
  return row[b.length]!;
}

/** How alike `a` and `b` are, as the share of the longer one they have in common, in order. */
function alike(a: string[], b: string[]): number {
  return common(a, b) / Math.max(a.length, b.length, 1);
}
