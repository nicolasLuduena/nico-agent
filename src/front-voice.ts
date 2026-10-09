import { sayArgs } from "./app/lead";
import { ConfigError, VOICE_DOC, frontVoiceEndpoint, loadConfig } from "./config";
import { type Ask, type Authored, type Entry, append, isCorrection, loadConversation, orient } from "./conversation";
import type { CliRunner } from "./mcp";
import { describeProposed } from "./proposals";
import { frontVoiceReply } from "./voice";
import type { World } from "./world";

/** What the Front voice says the moment it hands a message to the Lead. */
export const ASKING_THE_LEAD = "I'll ask the Lead.";

/** How much of the Board, as `board --json` prints it, the Front voice reads: enough for a busy Board, short of a slow request. */
const BOARD_CHARS = 16_000;

/** A warning about the Front voice for the app to show: what went wrong and what to do. */
export interface FrontVoiceWarning {
  error: string;
  help: string[];
}

/** What the Front voice tells of one thing the user said, as it goes. */
export interface Hearing {
  /** It could not answer: the message went to the Lead as heard, and why. */
  warn(warning: FrontVoiceWarning): void;
  /** It is about to hand `message` to the Lead (`cleaned` false when sent as heard). */
  handing(message: { text: string; raw: string }, cleaned: boolean): void;
}

/** What the Front voice runs with in `serve`: the world, the config directory, the CLI it writes and reads the Board through, and the speaker. */
interface FrontVoiceContext {
  world: World;
  configDir: string;
  runCli: CliRunner;
  /** Read a line aloud, after what waits to be spoken (see `speaker`). */
  say(text: string): void;
}

/**
 * The Front voice (ADR-0013): it hears what the user said, as transcribed,
 * and either answers it from what it reads, sentence by sentence aloud, or
 * hands it to the Lead as the user's message, saying it will ask the Lead.
 * It reads the conversation, the Lead's orient packet and the Board; its
 * one tool is `hand_off`. Its lines go in the Conversation under its own
 * name. `hush` (the user talking over it) stops what it is saying and drops
 * the rest of its reply; a hand-off is still made.
 */
export function frontVoice(ctx: FrontVoiceContext) {
  /** The replies streaming now: a hush silences each, and stops the ones not yet handing off. */
  const replying = new Set<Reply>();

  /**
   * Answer `raw`, what the user said, primed with `vocabulary`, the words to
   * spell as written; resolves with whether it was handed to the Lead.
   */
  async function hear(raw: string, vocabulary: string, { warn, handing }: Hearing): Promise<boolean> {
    const question = asked(loadConversation(ctx.configDir), raw);
    const handOff = async (message: { text: string; raw: string }, cleaned: boolean) => {
      handing(message, cleaned);
      const { stdout, exitCode } = await ctx.runCli(["say", ...sayArgs(message.text, question?.id, message.raw)]);
      if (exitCode !== 0) console.error(`the Front voice's hand-off failed: ${stdout.trim()}`);
    };
    const asHeard = async (error: string, help: string) => {
      warn({ error, help: [`Sent to the Lead as heard. ${help}`] });
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
      const context = await readContext(vocabulary, question);
      const answer = await frontVoiceReply(ctx.world, endpoint, { heard: raw, context }, reply.stop.signal);
      // Talked over while it thought: nothing to say, and nothing it was handing off.
      if ("error" in answer && reply.stop.signal.aborted) return false;
      if ("error" in answer) return await asHeard(answer.error, answer.help);
      const said: string[] = [];
      /** Say a sentence, unless the user talked over it. */
      const line = (sentence: string) => {
        if (reply.hushed || !sentence) return;
        said.push(sentence);
        ctx.say(sentence);
      };
      let words = "";
      let handedOff = false;
      try {
        for await (const part of answer.parts) {
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
          line(ASKING_THE_LEAD);
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
      if (said.length) await append(ctx.configDir, { type: "front-voice", text: said.join(" "), ...(!handedOff && { heard: raw }) }, ctx.world.now());
      return handedOff;
    } finally {
      replying.delete(reply);
    }
  }

  /** What the Front voice reads besides what was said: the words to spell, the Lead's orient packet, the Board, and the question being answered. */
  async function readContext(vocabulary: string, question: Ask | null): Promise<string> {
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
