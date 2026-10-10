import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sayArgs } from "./app/lead";
import { partnerSayArgs } from "./app/partner";
import { ConfigError, VOICE_DOC, frontVoiceEndpoint, loadConfig } from "./config";
import { type Ask, type Authored, type Entry, append, isCorrection, loadConversation, orient } from "./conversation";
import type { CliRunner } from "./mcp";
import { PARTNER_NAMES, type PartnerTab, type Tab, loadPartners, partnerWork } from "./partner";
import { PARTNER_IS } from "./partner-tabs";
import { describeProposed } from "./proposals";
import { withFileLock, writeJsonAtomic } from "./state";
import { appendThread, loadThread, type ThreadEntry } from "./thread";
import { type HandOffTarget, THE_LEAD, frontVoiceReply } from "./voice";
import type { World } from "./world";

/** What the Front voice says the moment it hands a message to `to`. */
export function asking(to: HandOffTarget) {
  return `I'll ask ${to.name}.`;
}

/** What the Front voice in the Lead's tab says the moment it hands a message to the Lead. */
export const ASKING_THE_LEAD = asking(THE_LEAD);

/** How much of the Board, as `board --json` prints it, the Front voice reads: enough for a busy Board, short of a slow request. */
const BOARD_CHARS = 16_000;

/** The id the Front voice's endpoint keeps its requests together by (`x-opencode-session`), beside the Conversation it belongs to. */
const SESSION_FILE = "front-voice-session.json";

/** How much of a PR's diff the Review tab's Front voice reads: as much as the Lead's tab reads of the Board. */
const DIFF_CHARS = 16_000;

/** A warning about the Front voice for the app to show: what went wrong and what to do. */
export interface FrontVoiceWarning {
  error: string;
  help: string[];
}

/** What the Front voice tells of one thing the user said, as it goes. */
export interface Hearing {
  /** It could not answer: the message went to its tab's agent as heard, or nowhere, and why. */
  warn(warning: FrontVoiceWarning): void;
  /** It is about to hand `message` to its tab's agent (`cleaned` false when sent as heard). */
  handing(message: { text: string; raw: string }, cleaned: boolean): void;
  /** It sends its request to its endpoint (for the timing log, as are the two below). */
  asked(): void;
  /** Its first token came: the first text or tool call it streamed. */
  firstToken(): void;
  /** Its first sentence went to speech, as the speaker's `line`; none when it will not be played. */
  firstSentence(line: number | undefined): void;
}

/** What the Front voice runs with in `serve`: the world, the config directory, the CLI it writes and reads the Board through, and the speaker. */
interface FrontVoiceContext {
  world: World;
  configDir: string;
  runCli: CliRunner;
  /** Read a line aloud to the pages on `tab`, after what waits to be spoken (see `speaker`); the speaker's number for it, none when it will not be. */
  say(text: string, tab: Tab): number | undefined;
}

/**
 * The Front voice of one tab (ADR-0014): who it hands off to and the
 * question being answered, if any; what it reads; how it hands a message off
 * and where its own lines are recorded.
 */
interface TabVoice {
  to: HandOffTarget;
  question: Ask | null;
  read(vocabulary: string): Promise<string>;
  handOff(message: { text: string; raw: string }): Promise<void>;
  record(said: string, heard?: string): Promise<void>;
}

/**
 * The Front voice (ADR-0013): it hears what the user said, as transcribed,
 * and either answers it from what it reads, sentence by sentence aloud, or
 * hands it to its tab's agent as the user's message, saying it will ask. In
 * the Lead's tab it reads the conversation, the Lead's orient packet and the
 * Board, and its lines go in the Conversation under its own name; in a
 * Partner's tab (ADR-0014), that Partner's Thread, where its lines go too.
 * Its one tool is `hand_off`. `hush` (the user talking over it) stops what
 * it is saying and drops the rest of its reply; a hand-off is still made.
 */
export function frontVoice(ctx: FrontVoiceContext) {
  /** The replies streaming now: a hush silences each, and stops the ones not yet handing off. */
  const replying = new Set<Reply>();

  /**
   * Answer `raw`, what the user said in `tab`, primed with `vocabulary`, the
   * words to spell as written; resolves with whether it was handed off.
   */
  async function hear(raw: string, vocabulary: string, hearing: Hearing, tab: Tab): Promise<boolean> {
    const { warn, handing } = hearing;
    const voice = tab === "lead" ? leadVoice(raw) : partnerVoice(tab);
    if (!voice) {
      const name = PARTNER_NAMES[tab as PartnerTab];
      warn({ error: `no ${name} runs to hear it`, help: [`Start the ${name} in its tab, then talk again`] });
      return false;
    }
    const { to, question } = voice;
    const handOff = async (message: { text: string; raw: string }, cleaned: boolean) => {
      handing(message, cleaned);
      await voice.handOff(message);
    };
    const asHeard = async (error: string, help: string) => {
      warn({ error, help: [`Sent to ${to.name} as heard. ${help}`] });
      await handOff({ text: raw, raw }, false);
      return true;
    };
    let endpoint;
    try {
      endpoint = frontVoiceEndpoint(loadConfig(ctx.configDir).voice);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return asHeard(e.message, "Fix config.json");
    }
    const reply: Reply = { hushed: false, calling: false, stop: new AbortController() };
    replying.add(reply);
    try {
      const turn = { heard: raw, context: await voice.read(vocabulary), sessionId: await sessionId(ctx.configDir), to };
      hearing.asked();
      const answer = await frontVoiceReply(ctx.world, endpoint, turn, reply.stop.signal);
      // Talked over while it thought: nothing to say, and nothing it was handing off.
      if ("error" in answer && reply.stop.signal.aborted) return false;
      if ("error" in answer) return await asHeard(answer.error, answer.help);
      const said: string[] = [];
      /** Say a sentence, unless the user talked over it. */
      const line = (sentence: string) => {
        if (reply.hushed || !sentence) return;
        said.push(sentence);
        const number = ctx.say(sentence, tab);
        if (said.length === 1) hearing.firstSentence(number);
      };
      let words = "";
      let handedOff = false;
      let streamed = false;
      try {
        for await (const part of answer.parts) {
          if (!streamed) hearing.firstToken();
          streamed = true;
          if ("text" in part) {
            words += part.text;
            const { whole, rest } = sentences(words);
            whole.forEach(line);
            words = rest;
            continue;
          }
          if ("calling" in part) {
            reply.calling ||= part.calling === "hand_off";
            continue;
          }
          if (part.call.name !== "hand_off" || handedOff) continue;
          const made = handedMessage(part.call.arguments, raw, question);
          if (!made) continue;
          line(words.trim());
          words = "";
          line(asking(to));
          handedOff = true;
          await handOff(made, true);
        }
      } catch (e) {
        // A reply cut off midway keeps what was said; with nothing said or handed off, the message still reaches the Lead.
        // Stopped by the user talking over it, it ends quietly.
        if (!reply.stop.signal.aborted) {
          const why = `stopped answering: ${e instanceof Error ? e.message : String(e)}`;
          if (!said.length && !handedOff) return await asHeard(why, `Check voice.front (see ${VOICE_DOC})`);
          warn({ error: `the Front voice ${why}`, help: [`Check voice.front (see ${VOICE_DOC})`] });
        }
      }
      line(words.trim());
      // Talked over before it said anything, it answered nothing the user would hear again.
      if (!said.length && !handedOff && !reply.hushed) return await asHeard("the Front voice answered nothing", "Check voice.front.model, or try another");
      if (said.length) await voice.record(said.join(" "), handedOff ? undefined : raw);
      return handedOff;
    } finally {
      replying.delete(reply);
    }
  }

  /** Hand a message off by running `argv`, the CLI command that writes it as the user's. */
  async function handOffThrough(argv: string[]) {
    const { stdout, exitCode } = await ctx.runCli(argv);
    if (exitCode !== 0) console.error(`the Front voice's hand-off failed: ${stdout.trim()}`);
  }

  /** The Front voice of the Lead's tab, hearing `raw`: it hands off to the Lead, into the Conversation, where its lines go too. */
  function leadVoice(raw: string): TabVoice {
    const question = asked(loadConversation(ctx.configDir), raw);
    return {
      to: THE_LEAD,
      question,
      read: (vocabulary) => readLeadContext(vocabulary, question),
      handOff: (message) => handOffThrough(["say", ...sayArgs(message.text, question?.id, message.raw)]),
      async record(said, heard) {
        await append(ctx.configDir, { type: "front-voice", text: said, ...(heard !== undefined && { heard }) }, ctx.world.now());
      },
    };
  }

  /**
   * The Front voice of a Partner's tab, while it has a Partner: it reads
   * that Partner's Thread, hands off into it as `partner say` does, and
   * records its lines there. It never reads the Board or the Lead's
   * Conversation, and never writes to them.
   */
  function partnerVoice(tab: PartnerTab): TabVoice | null {
    const partner = loadPartners(ctx.configDir)[tab];
    if (!partner) return null;
    return {
      to: { name: `the ${PARTNER_NAMES[tab]}`, is: PARTNER_IS[tab] },
      question: null,
      read: async (vocabulary) => [
        vocabulary && `Terms: ${vocabulary}`,
        ...await partnerWork(ctx.world, ctx.configDir, partner).then(({ brief, diff }) => [
          brief && `The PR the user reviews:\n${brief}`,
          diff && `Its diff against its base:\n${diff.length > DIFF_CHARS ? `${diff.slice(0, DIFF_CHARS)} …` : diff}`,
        ]),
        `The conversation so far, oldest first:\n${loadThread(ctx.configDir, partner.thread).slice(-LAST_ENTRIES).map((e) => threadLine(e, PARTNER_NAMES[tab])).join("\n") || "(nothing yet)"}`,
      ].filter(Boolean).join("\n\n"),
      handOff: (message) => handOffThrough(["partner", "say", ...partnerSayArgs(tab, message.text, message.raw)]),
      async record(said, heard) {
        await appendThread(ctx.configDir, partner.thread, { type: "front-voice", text: said, ...(heard !== undefined && { heard }) }, ctx.world.now());
      },
    };
  }

  /** What the Front voice reads in the Lead's tab besides what was said: the words to spell, the Lead's orient packet, the Board, and the question being answered. */
  async function readLeadContext(vocabulary: string, question: Ask | null): Promise<string> {
    const packet = orient(ctx.configDir);
    const board = await ctx.runCli(["board", "--json"]).then(({ stdout }) => stdout.trim(), () => "");
    const proposals = packet.proposals.map((p) => `- ${describeProposed(p).line}: ${p.reason}`);
    const asking = packet.open.map((q) => `- ${q.text}${q.type === "ask" && q.choices?.length ? ` (${q.choices.join("; ")})` : ""}`);
    return [
      vocabulary && `Terms: ${vocabulary}`,
      `The Lead's Intent:\n${packet.intent}`,
      `The Lead's Notes:\n${packet.notes}`,
      asking.length ? `The Lead's open questions:\n${asking.join("\n")}` : "",
      proposals.length ? `The Lead's Proposals waiting on the user:\n${proposals.join("\n")}` : "",
      board && `The Board (board --json):\n${board.length > BOARD_CHARS ? `${board.slice(0, BOARD_CHARS)} …` : board}`,
      `The conversation so far, oldest first:\n${packet.last.map(conversationLine).join("\n") || "(nothing yet)"}`,
      question && [
        `The Lead just asked the user: ${question.text}`,
        ...(question.choices ?? []).map((c, i) => `${i + 1}. ${c}`),
        "What the user says now answers it, unless it asks you something: hand an answer off, with choice set to the number of the choice it picks, when it has choices.",
      ].join("\n"),
    ].filter(Boolean).join("\n\n");
  }

  return {
    hear,
    /** The user talked over the Front voice: stop what it says, and say nothing more of the replies streaming now. */
    hush() {
      for (const reply of replying) {
        reply.hushed = true;
        // A hand-off on its way is read to its end, and made.
        if (!reply.calling) reply.stop.abort();
      }
    },
  };
}

/**
 * The id the Front voice's endpoint keeps its requests for the Conversation in
 * `dir` together by: one per Conversation, kept in a file so a restart keeps
 * it, and new once the Conversation is reset. It belongs to the Conversation
 * whose first entry was made at `firstEntryAt`; one made on an empty
 * Conversation takes the first entry made after it.
 */
function sessionId(dir: string): Promise<string> {
  return withFileLock(dir, SESSION_FILE, () => {
    const first = loadConversation(dir)[0]?.at ?? null;
    let kept: { id: string; firstEntryAt: string | null } | null = null;
    try {
      kept = JSON.parse(readFileSync(join(dir, SESSION_FILE), "utf8"));
    } catch (e) {
      // A file cut short only costs a new id: the Front voice still answers.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
    if (kept && kept.firstEntryAt === first) return kept.id;
    const id = kept && kept.firstEntryAt === null ? kept.id : crypto.randomUUID();
    writeJsonAtomic(join(dir, SESSION_FILE), { id, firstEntryAt: first });
    return id;
  });
}

/** How many of a Thread's last entries a Partner's Front voice reads. */
const LAST_ENTRIES = 20;

/** An entry as a Partner's Front voice reads the Thread, a line each, by who wrote it. */
function threadLine(entry: ThreadEntry, partner: string): string {
  switch (entry.type) {
    case "user":
      return `User: ${entry.text}`;
    case "partner":
      return `${partner}: ${entry.text}`;
    case "front-voice":
      return `${entry.heard ? `User (to you): ${entry.heard}\n` : ""}You (the Front voice): ${entry.text}`;
    case "draft":
      return `${partner}, drafting a hand-off to the Lead: ${entry.text}`;
    case "handoff":
      return `User handed this to the Lead: ${entry.text}`;
  }
}

/** A reply streaming: whether the user talked over it, whether it began a hand-off, and how to stop its request. */
interface Reply {
  hushed: boolean;
  calling: boolean;
  stop: AbortController;
}

/** The Front voice as `serve` runs it. */
export type FrontVoice = ReturnType<typeof frontVoice>;

/**
 * The question `said` answers: the Lead's question, when it is the last
 * entry besides the Front voice's, and `said` is no Correction.
 */
function asked(entries: Entry[], said: string): Ask | null {
  const last = entries.findLast((e) => e.type !== "front-voice");
  return last?.type === "ask" && !isCorrection({ text: said }) ? last : null;
}

/**
 * The message `hand_off`'s arguments carry, as the Lead gets it: answering a
 * question with choices, the choice it picks, by its number; null when the
 * arguments are not JSON with a message.
 */
function handedMessage(args: string, raw: string, question: Ask | null): { text: string; raw: string } | null {
  let parsed;
  try {
    parsed = JSON.parse(args || "{}") as { message?: unknown; choice?: unknown };
  } catch {
    return null;
  }
  const choices = question?.choices ?? [];
  const picked = typeof parsed.choice === "number" ? choices[parsed.choice - 1] : undefined;
  if (picked !== undefined) return { text: picked, raw };
  const text = typeof parsed.message === "string" ? parsed.message.trim() : "";
  return text ? { text, raw } : null;
}

/** `text` as its whole sentences, each ended by `.`, `!` or `?` and a space, or a line break; and what is left after the last. */
function sentences(text: string): { whole: string[]; rest: string } {
  const whole: string[] = [];
  let at = 0;
  for (const end of text.matchAll(/[.!?]+["')\]]*\s+|\n+/g)) {
    whole.push(text.slice(at, end.index + end[0].length).trim());
    at = end.index + end[0].length;
  }
  return { whole: whole.filter(Boolean), rest: text.slice(at) };
}

/** An entry as the Front voice reads the conversation, a line each, by who wrote it. */
function conversationLine(entry: Authored): string {
  const who = { user: "User", lead: "Lead", "front-voice": "You (the Front voice)", "nico-agent": "nico-agent" }[entry.who];
  const heard = entry.type === "front-voice" && entry.heard ? `User (to you): ${entry.heard}\n` : "";
  return `${heard}${who}: ${entry.text}`;
}
