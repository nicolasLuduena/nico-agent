import { ConfigError, VOICE_DOC, loadConfig } from "./config";
import { type Entry, loadConversation } from "./conversation";
import { type Tab, loadPartners } from "./partner";
import { loadThread } from "./thread";
import { SPEECH_RATE, speak } from "./voice";
import { voiceOn } from "./voice-on";
import type { SocketPeer, World } from "./world";

/**
 * What `/api/voice` tells the app of the speech it plays, besides the audio
 * itself as binary messages between `speech` and `speech-end`: 16-bit
 * little-endian mono PCM at `rate`, whole samples each. The Lead's speech
 * names its `entry`; a Partner's replies and the Front voice's lines have none.
 */
export type Speech =
  | { type: "speech"; entry?: number; rate: number }
  | { type: "speech-end"; entry?: number }
  | { type: "speech-error"; entry?: number; error: string; help: string[] };

/**
 * Something to read aloud to the pages on `tab`: a reply (a Lead's entry,
 * naming it, or a Partner's), or a line of the Front voice's.
 */
type Spoken = { text: string; tab: Tab; reply: boolean; entry?: number };

/** What is said still reaches the user in writing, so every warning says so. */
const STILL_SHOWN = "replies still show in the panel";

/**
 * The Lead's and the Partners' voice in `serve`: with Voice on, each entry
 * the Lead writes (a reply, or a question with its choices numbered) and each
 * reply a Partner writes in its Thread is read by the speech service, one
 * after another, and its audio streamed as it is made to every page
 * listening on that tab: the Lead's on the Lead's tab, a Partner's on its
 * own (each page says which tab it shows; the Lead's until it does). Only
 * entries written after a page began listening are spoken, and none with no
 * page on its tab. The Front voice's lines are read in the same queue, to
 * the pages on the tab it talks in, so no two voices ever overlap. While
 * anything holds the speaker (the user talking, then the Front voice
 * answering), the replies wait, and are spoken at the next pause, after the
 * Front voice's last line. `hush` (the user talking over it, or a tap) stops
 * the speech at once and drops what waits to be spoken. Only a reply's own
 * speech, talked over, loses the replies behind it: the ones waiting behind
 * the Front voice's lines, or for a pause, were never cut off, and wait for
 * the next pause.
 */
export function speaker({ world, configDir }: { world: World; configDir: string }) {
  /** Each page listening, with the tab it shows. */
  const peers = new Map<SocketPeer, Tab>();
  /** The last entry looked at; the ones after it are new. */
  let seen = 0;
  /** The last entry looked at in each Thread, by its file; a Thread begun since has all its entries new. */
  let seenThreads = new Map<string, number>();
  let waiting: Spoken[] = [];
  /** How many holds are on: the Lead's entries wait in `held` until none is. */
  let holds = 0;
  let held: Spoken[] = [];
  /** The speech streaming now: stop it to hush. */
  let streaming: { stop(): void } | null = null;
  let speaking = false;
  /** What is being read now, if anything. */
  let reading: Spoken | null = null;
  /** How many times the Lead was hushed: a speech asked for before the last hush is never played. */
  let hushes = 0;

  const lastId = () => loadConversation(configDir).at(-1)?.id ?? 0;
  const threads = () => Object.values(loadPartners(configDir)).map((p) => ({ tab: p.tab, file: p.thread, entries: loadThread(configDir, p.thread) }));
  const on = (tab: Tab) => [...peers].flatMap(([peer, shows]) => (shows === tab ? [peer] : []));
  const tell = (message: Speech, tab: Tab) => {
    for (const peer of on(tab)) peer.send(JSON.stringify(message));
  };
  const audio = (chunk: Uint8Array, tab: Tab) => {
    for (const peer of on(tab)) peer.send(chunk);
  };

  const read = async ({ text, tab, entry }: Spoken) => {
    // Nobody shows its tab any more: nothing is made for no one.
    if (!on(tab).length) return;
    const which = entry === undefined ? {} : { entry };
    const failed = (error: string, help: string) => tell({ type: "speech-error", ...which, error, help: [`${help}; ${STILL_SHOWN}`] }, tab);
    let endpoint;
    try {
      endpoint = loadConfig(configDir).voice?.speak;
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return failed(e.message, "Fix config.json");
    }
    if (!endpoint) return failed("no speech service is configured", `Add voice.speak to config.json (see ${VOICE_DOC})`);
    const asked = hushes;
    const made = await speak(world, endpoint, text);
    if ("error" in made) return failed(made.error, made.help);
    const reader = made.audio.getReader();
    if (hushes !== asked) return void reader.cancel().catch(() => {});
    let stopped = false;
    streaming = { stop: () => { stopped = true; void reader.cancel().catch(() => {}); } };
    tell({ type: "speech", ...which, rate: SPEECH_RATE }, tab);
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
        if (whole) audio(bytes.slice(0, whole), tab);
      }
    } catch (e) {
      if (!stopped) return failed(`stopped answering: ${e instanceof Error ? e.message : String(e)}`, "Check the speak service's log");
    } finally {
      streaming = null;
    }
    // Hushed too: every other page listening stops waiting on it.
    tell({ type: "speech-end", ...which }, tab);
  };

  const say = () => void speakWaiting().catch((e: unknown) => console.error(`speech failed: ${e instanceof Error ? e.message : String(e)}`));

  const speakWaiting = async () => {
    if (speaking) return;
    speaking = true;
    try {
      for (reading = waiting.shift() ?? null; reading; reading = waiting.shift() ?? null) await read(reading);
    } finally {
      reading = null;
      speaking = false;
    }
  };

  return {
    /** A page began listening, on the Lead's tab; what was written before it is not spoken. */
    join(peer: SocketPeer) {
      if (peers.size === 0) {
        seen = lastId();
        seenThreads = new Map(threads().map((t) => [t.file, t.entries.at(-1)?.id ?? 0]));
      }
      peers.set(peer, "lead");
    },
    /** The page now shows `tab`: it hears that tab's speech only, and stops hearing what it was hearing of the one it left. */
    tab(peer: SocketPeer, tab: Tab) {
      const left = peers.get(peer);
      if (left === undefined || left === tab) return;
      peers.set(peer, tab);
      if (reading?.tab !== left) return;
      peer.send(JSON.stringify({ type: "speech-end", ...(reading.entry !== undefined && { entry: reading.entry }) } satisfies Speech));
      if (!on(left).length) streaming?.stop();
    },
    /** A page stopped listening; with none left, the Lead falls silent. */
    leave(peer: SocketPeer) {
      peers.delete(peer);
      if (peers.size === 0) {
        this.hush();
        held = [];
      }
    },
    /**
     * The conversation or a Thread changed: speak what the Lead and the
     * Partners wrote since, with Voice on, each to the pages on its tab.
     */
    changed() {
      if (peers.size === 0) return;
      const fresh: Spoken[] = [];
      const entries = loadConversation(configDir).filter((e) => e.id > seen);
      if (entries.length) seen = entries.at(-1)!.id;
      fresh.push(...entries.filter((e) => e.type === "lead" || e.type === "ask").map((e) => ({ text: spoken(e), tab: "lead" as const, reply: true, entry: e.id })));
      for (const { tab, file, entries } of threads()) {
        const since = seenThreads.get(file) ?? 0;
        seenThreads.set(file, entries.at(-1)?.id ?? since);
        fresh.push(...entries.filter((e) => e.id > since && e.type === "partner").map((e) => ({ text: unmarked(e.text), tab, reply: true })));
      }
      const heard = fresh.filter((s) => on(s.tab).length);
      if (!heard.length || !voiceOn(configDir)) return;
      if (holds) return void held.push(...heard);
      waiting.push(...heard);
      say();
    },
    /**
     * Hold the Lead's entries back, the user talking or the Front voice
     * answering, until the returned release is called (more than once is
     * harmless); with no hold left, they are spoken after what waits.
     */
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--holds) return;
        // Voice turned off while they waited: they only show in the panel.
        if (voiceOn(configDir)) waiting.push(...held);
        held = [];
        say();
      };
    },
    /** Read a line of the Front voice's in `tab`, after what waits, with Voice on and a page on that tab. */
    line(text: string, tab: Tab = "lead") {
      if (!on(tab).length || !voiceOn(configDir)) return;
      waiting.push({ text: unmarked(text), tab, reply: false });
      say();
    },
    /** Stop speaking now, and drop what waits to be spoken; talking over the Front voice, the replies wait for the next pause. */
    hush() {
      hushes++;
      const frontVoiceTalkedOver = reading !== null && !reading.reply;
      held = [...(frontVoiceTalkedOver ? waiting.filter((s) => s.reply) : []), ...held];
      waiting = [];
      streaming?.stop();
    },
  };
}

/** `text` without the Markdown marks a voice would read out. */
function unmarked(text: string) {
  return text.replace(/[`*]/g, "");
}

/** What is read aloud of `entry`: its text, and a question's choices as a numbered list. */
function spoken(entry: Entry): string {
  const text = unmarked(entry.text);
  if (entry.type !== "ask" || !entry.choices?.length) return text;
  return [text, ...entry.choices.map((c, i) => `${i + 1}. ${c.replace(/[.!?\s]+$/, "")}.`)].join(" ");
}
