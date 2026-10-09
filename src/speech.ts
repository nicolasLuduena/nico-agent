import { ConfigError, VOICE_DOC, loadConfig } from "./config";
import { type Entry, loadConversation } from "./conversation";
import { SPEECH_RATE, speak } from "./voice";
import { voiceOn } from "./voice-on";
import type { SocketPeer, World } from "./world";

/**
 * What `/api/voice` tells the app of the Lead's speech, besides the audio
 * itself as binary messages between `speech` and `speech-end`: 16-bit
 * little-endian mono PCM at `rate`, whole samples each.
 */
export type Speech =
  | { type: "speech"; entry: number; rate: number }
  | { type: "speech-end"; entry: number }
  | { type: "speech-error"; entry: number; error: string; help: string[] };

/** The Lead's words still reach the user in writing, so every warning says so. */
const STILL_SHOWN = "the Lead's replies still show in the panel";

/**
 * The Lead's voice in `serve`: with Voice on, each entry the Lead writes (a
 * reply, or a question with its choices numbered) is read by the speech
 * service, one after another, and its audio streamed to every page listening
 * as it is made. Only entries written after a page began listening are
 * spoken. `hush` (the user talking over it, or a tap) stops the speech at
 * once and drops what waits to be spoken.
 */
export function speaker({ world, configDir }: { world: World; configDir: string }) {
  const peers = new Set<SocketPeer>();
  /** The last entry looked at; the ones after it are new. */
  let seen = 0;
  let waiting: Entry[] = [];
  /** The speech streaming now: stop it to hush. */
  let streaming: { stop(): void } | null = null;
  let speaking = false;
  /** How many times the Lead was hushed: a speech asked for before the last hush is never played. */
  let hushes = 0;

  const lastId = () => loadConversation(configDir).at(-1)?.id ?? 0;
  const tell = (message: Speech) => {
    for (const peer of peers) peer.send(JSON.stringify(message));
  };
  const audio = (chunk: Uint8Array) => {
    for (const peer of peers) peer.send(chunk);
  };

  const read = async (entry: Entry) => {
    const failed = (error: string, help: string) => tell({ type: "speech-error", entry: entry.id, error, help: [`${help}; ${STILL_SHOWN}`] });
    let endpoint;
    try {
      endpoint = loadConfig(configDir).voice?.speak;
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return failed(e.message, "Fix config.json");
    }
    if (!endpoint) return failed("no speech service is configured", `Add voice.speak to config.json (see ${VOICE_DOC})`);
    const asked = hushes;
    const made = await speak(world, endpoint, spoken(entry));
    if ("error" in made) return failed(made.error, made.help);
    const reader = made.audio.getReader();
    if (hushes !== asked) return void reader.cancel().catch(() => {});
    let stopped = false;
    streaming = { stop: () => { stopped = true; void reader.cancel().catch(() => {}); } };
    tell({ type: "speech", entry: entry.id, rate: SPEECH_RATE });
    // A chunk may end inside a sample; its odd byte starts the next one.
    let carry = new Uint8Array(0);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (stopped || done) break;
        const bytes = new Uint8Array(carry.byteLength + value.byteLength);
        bytes.set(carry);
        bytes.set(value, carry.byteLength);
        const whole = bytes.byteLength - (bytes.byteLength % 2);
        carry = bytes.slice(whole);
        if (whole) audio(bytes.slice(0, whole));
      }
    } catch (e) {
      if (!stopped) return failed(`stopped answering: ${e instanceof Error ? e.message : String(e)}`, "Check the speak service's log");
    } finally {
      streaming = null;
    }
    // Hushed too: every other page listening stops waiting on it.
    tell({ type: "speech-end", entry: entry.id });
  };

  const speakWaiting = async () => {
    if (speaking) return;
    speaking = true;
    try {
      for (let entry = waiting.shift(); entry; entry = waiting.shift()) await read(entry);
    } finally {
      speaking = false;
    }
  };

  return {
    /** A page began listening; what was written before it is not spoken. */
    join(peer: SocketPeer) {
      if (peers.size === 0) seen = lastId();
      peers.add(peer);
    },
    /** A page stopped listening; with none left, the Lead falls silent. */
    leave(peer: SocketPeer) {
      peers.delete(peer);
      if (peers.size === 0) this.hush();
    },
    /** The conversation changed: speak what the Lead wrote since, with Voice on and a page listening. */
    changed() {
      if (peers.size === 0) return;
      const fresh = loadConversation(configDir).filter((e) => e.id > seen);
      if (!fresh.length) return;
      seen = fresh.at(-1)!.id;
      if (!voiceOn(configDir)) return;
      waiting.push(...fresh.filter((e) => e.type === "lead" || e.type === "ask"));
      void speakWaiting().catch((e: unknown) => console.error(`speech failed: ${e instanceof Error ? e.message : String(e)}`));
    },
    /** Stop speaking now, and drop what waits to be spoken. */
    hush() {
      hushes++;
      waiting = [];
      streaming?.stop();
    },
  };
}

/** What is read aloud of `entry`: its text, and a question's choices as a numbered list. */
function spoken(entry: Entry): string {
  const text = entry.text.replace(/[`*]/g, "");
  if (entry.type !== "ask" || !entry.choices?.length) return text;
  return [text, ...entry.choices.map((c, i) => `${i + 1}. ${c.replace(/[.!?\s]+$/, "")}.`)].join(" ");
}
