import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Tab } from "../partner-tabs";
import type { Speech } from "../speech";
import type { Transcript, VoiceCommand } from "../transcription";
import { Ears, HEARING_FILES, Models } from "./hearing";
import { usePageCommand } from "./stream";
import { type Indicator, type Talk, type TalkEvent, bargesIn, ends, indicator, pcmSamples, resampler, talk, watches } from "./talk";

/** A voice failure as the panel shows it: what went wrong and what to do. */
interface Warning {
  error: string;
  help: string[];
}

const LOST: Warning = { error: "Lost nico-agent serve while listening", help: ["Try again once it runs; typing still works"] };

/**
 * Hands the microphone's samples to the page in batches, off the audio
 * thread. Loaded from a Blob URL, so the page needs no file of its own for it.
 */
const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.batch = new Float32Array(2048); this.filled = 0; }
  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (samples) {
      for (const s of samples) {
        this.batch[this.filled++] = s;
        if (this.filled === this.batch.length) {
          this.port.postMessage(this.batch);
          this.batch = new Float32Array(2048);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("talk-tap", Tap);
`;

/** How long a microphone waits for the browser to let its audio run. */
const RESUME_MS = 1000;

/** The browser keeps the page's audio stopped until a click or key on it. */
class NeedsGesture extends Error {}

/** Silero VAD and Smart Turn could not be loaded from `serve`. */
class NoModels extends Error {}

let models: Promise<Models> | null = null;

/** Silero VAD and Smart Turn, loaded from `serve` when the microphone is first used, once for the page; again after a failure. */
function hearingModels() {
  models ??= import("onnxruntime-web/wasm").then((ort) => {
    ort.env.wasm.wasmPaths = { wasm: HEARING_FILES.wasm };
    return Models.load(ort, HEARING_FILES);
  });
  models.catch(() => {
    models = null;
  });
  return models;
}

/** The microphone, recording one utterance: each batch resampled to 16kHz PCM, and heard by its Ears. */
class Microphone {
  private context: AudioContext;
  private stream: MediaStream | null = null;
  private stopped = false;
  private readonly models = hearingModels();
  readonly ears = new Ears(this.models);

  /** Created in the press itself: Safari lets audio start only in a user gesture. */
  constructor() {
    this.context = new AudioContext();
    void this.context.resume();
  }

  async start(onBatch: (pcm: Int16Array) => void) {
    // Started without a gesture (the key anywhere), audio runs only if the page had one since it loaded.
    await Promise.race([this.context.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_MS))]);
    if (this.context.state !== "running") throw new NeedsGesture();
    await this.models.catch((e: unknown) => {
      throw new NoModels(e instanceof Error ? e.message : String(e));
    });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (this.stopped) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.stopped) return;
    const toPcm = resampler(this.context.sampleRate);
    const tap = new AudioWorkletNode(this.context, "talk-tap");
    tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (!this.stopped) onBatch(toPcm(data));
    };
    // Connected through to the output, which it leaves silent, so the browser runs it.
    this.context.createMediaStreamSource(stream).connect(tap).connect(this.context.destination);
  }

  stop() {
    this.stopped = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context.close();
  }
}

/**
 * `/api/voice` on the server the page came from, opened when first needed,
 * its sends queued until it opens; each time it opens, it first tells
 * `serve` the tab the page shows, as `shownTab` says it.
 */
class VoiceSocket {
  private socket: WebSocket | null = null;
  private queue: (string | ArrayBuffer)[] = [];

  constructor(
    private readonly heard: (message: Transcript | Speech) => void,
    private readonly audio: (pcm: ArrayBuffer) => void,
    private readonly lost: () => void,
    private readonly shownTab: () => VoiceCommand,
  ) {}

  /** Tell `serve` the tab the page shows, when open; one opening tells it anyway. */
  tellTab() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(this.shownTab()));
  }

  /** Tell `/api/voice` what the utterance does, or to hush the Lead. */
  command(command: VoiceCommand) {
    this.send(JSON.stringify(command));
  }

  send(message: string | ArrayBuffer) {
    const socket = this.open();
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
    else this.queue.push(message);
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  /** Open it, if it isn't: with Voice on it stays open, to hear the Lead. */
  open() {
    if (this.socket) return this.socket;
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      socket.send(JSON.stringify(this.shownTab()));
      for (const message of this.queue.splice(0)) socket.send(message);
    };
    socket.onmessage = ({ data }) => {
      if (typeof data === "string") this.heard(JSON.parse(data) as Transcript | Speech);
      else this.audio(data as ArrayBuffer);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.queue = [];
      this.lost();
    };
    this.socket = socket;
    return socket;
  }
}

/** How far ahead of now the first chunk of the Lead's speech is scheduled, so the next arrives before it ends. */
const PLAY_AHEAD_S = 0.05;

/** What a speech played was, for the timing log: the Lead's entry, or a line of the Front voice's. */
type Played = { entry: number } | { line: number };

/** The Lead's voice: each chunk of its speech played right after the one before, all stopped at once by `stop`. */
class Player {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  /** When the last chunk scheduled ends, in the context's time. */
  private until = 0;
  private rate = 0;
  /** Whether the speech that began has ended (or none began), so once its chunks play out, the Lead is done. */
  private ended = true;
  /** The Lead's entry, or the Front voice's line, whose speech began, until its first chunk is scheduled. */
  private first: Played | null = null;

  /** `done` once the Lead is done speaking; `played` when an entry's or a line's first audio is due to play, in epoch ms. */
  constructor(
    private readonly done: () => void,
    private readonly played: (which: Played, at: number) => void,
  ) {}

  /** Created and resumed in a user gesture, as browsers let audio start only then; a browser without audio stays silent. */
  wake() {
    try {
      this.context ??= new AudioContext();
    } catch {
      return;
    }
    this.context.resume().catch(() => {});
  }

  /** Whether the Lead is speaking: a speech not ended, or chunks still playing. */
  get speaking() {
    return !this.ended || this.sources.size > 0;
  }

  /** A speech begins, the Lead's `entry` or the Front voice's `line`, its chunks at `rate`. */
  begin({ entry, line }: { entry?: number; line?: number }, rate: number) {
    this.wake();
    this.rate = rate;
    this.ended = false;
    this.first = entry !== undefined ? { entry } : line !== undefined ? { line } : null;
  }

  /** Play a chunk of the speech right after the last one, or as soon as it can when none is playing. */
  play(pcm: ArrayBuffer) {
    const context = this.context;
    const samples = pcmSamples(pcm);
    if (!context || this.ended || samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, this.rate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const at = Math.max(this.until, context.currentTime + PLAY_AHEAD_S);
    source.start(at);
    if (this.first !== null) this.played(this.first, Date.now() + (at - context.currentTime) * 1000);
    this.first = null;
    this.until = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.settle();
    };
  }

  /** The speech ended: the Lead is done once what is scheduled has played. */
  end() {
    this.ended = true;
    this.settle();
  }

  /** Stop speaking now. */
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
    }
    this.sources.clear();
    this.until = 0;
    this.end();
  }

  /** Stop, and let the audio device go. */
  close() {
    this.stop();
    this.context?.close().catch(() => {});
  }

  /** Tell `done` once the speech ended and its chunks have played. */
  private settle() {
    if (!this.speaking) this.done();
  }
}

/** How many of the microphone's last batches a watch keeps, about half a second: the start of the words that broke in. */
const EARLY_BATCHES = 12;

/**
 * The talk button: hold it to talk, release to send; tap it (or press the key
 * anywhere, `nico-agent voice talk`) to start a hands-free session, where a
 * pause or another tap sends, and the microphone keeps watching for the next
 * utterance, through the Lead's reply, until a tap while nobody talks ends it.
 * Interim transcripts show while the user speaks; `serve`'s Front voice
 * answers the final one or hands it to the Lead, and its lines and the
 * Lead's show in the conversation. With `voice` on, both are spoken as they
 * come; a press, or the user talking over them (the microphone watches
 * while they speak, once the page may use it), stops them at once. One for
 * the page, whichever `tab` it shows (ADR-0014): what is said goes to that
 * tab's Front voice, and only that tab's replies are spoken; leaving a tab
 * stops its speech.
 */
export function useTalk(voice: boolean, tab: Tab) {
  const [state, setState] = useState<Talk>({ mode: "idle" });
  const [interim, setInterim] = useState("");
  const [warning, setWarning] = useState<Warning | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const current = useRef(state);
  const microphone = useRef<Microphone | null>(null);
  /** When the user stopped talking, by the pause that ended the utterance. */
  const pauseBegan = useRef(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const socket = useRef<VoiceSocket | null>(null);
  /** The number of the utterance last started; answers about an older one never change the button. */
  const utterance = useRef(0);
  /** What the microphone heard last while watching, so words that break in are sent from their start. */
  const early = useRef<Int16Array[]>([]);

  const stopMicrophone = () => {
    microphone.current?.stop();
    microphone.current = null;
  };

  const dispatch = (event: TalkEvent) => {
    const before = current.current;
    const { state: next, send } = talk(current.current, event);
    current.current = next;
    setState(next);
    if (next.mode === "idle" || (next.mode === "transcribing" && !watches(next))) stopMicrophone();
    if (watches(next) && !watches(before)) void watch();
    if (send === "start") start(event.type === "barge");
    // A pause ends the utterance once the quiet has lasted; the user stopped talking when it began.
    else if (send === "end") socket.current?.command({ type: "end", spokeAt: event.type === "pause" ? pauseBegan.current : Date.now() });
    else if (send) socket.current?.command({ type: send });
  };

  const playerRef = useRef<Player | null>(null);
  playerRef.current ??= new Player(() => {
    setSpeaking(false);
    dispatch({ type: "lead-done" });
  }, (which, at) => socket.current?.command({ type: "played", ...which, at }));
  const player = playerRef.current;

  /** Stop the Lead speaking, here and at `serve`, which drops what waits to be spoken. */
  const hush = () => {
    if (!player.speaking) return;
    player.stop();
    socket.current?.command({ type: "hush" });
  };

  socket.current ??= new VoiceSocket(
    (message) => {
      if (message.type === "speech") {
        if (!voiceRef.current) return;
        player.begin(message, message.rate);
        setSpeaking(true);
        dispatch({ type: "lead-speaks" });
        return;
      }
      if (message.type === "speech-end") return player.end();
      if (message.type === "speech-error") {
        // The Lead's reply still shows; only its voice is missing.
        player.end();
        setWarning(message);
        return;
      }
      const latest = message.utterance === utterance.current;
      if (message.type === "interim") {
        if (latest) setInterim(message.text);
        return;
      }
      if (message.type === "error") {
        setWarning(message);
        if (latest) dispatch({ type: "failed" });
        return;
      }
      // The Front voice could not answer it: sent to the Lead as heard, saying why.
      if (message.type === "warning") return setWarning(message);
      const text = message.text.trim();
      if (!latest) return;
      setInterim("");
      if (!text) setNote("Heard nothing; try again.");
      dispatch({ type: "final" });
    },
    (pcm) => player.play(pcm),
    () => {
      player.stop();
      if (current.current.mode === "idle") return;
      setWarning(LOST);
      dispatch({ type: "failed" });
    },
    () => ({ type: "tab", tab: tabRef.current }),
  );

  // Another tab: serve hears of it, and what this one was saying stops here at once.
  useEffect(() => {
    socket.current!.tellTab();
    if (player.speaking) player.stop();
  }, [tab]);

  /**
   * Each batch `mic` hears: while watching, kept, and heard for the user
   * talking over the Lead; else sent, and heard for the end of the utterance.
   */
  const onBatch = (mic: Microphone, pcm: Int16Array) => {
    if (watches(current.current)) early.current = [...early.current.slice(1 - EARLY_BATCHES), pcm];
    else socket.current!.send(pcm.buffer as ArrayBuffer);
    mic.ears.hear(pcm).then(({ listening, at, ended }) => {
      if (microphone.current !== mic) return;
      if (watches(current.current)) {
        if (!bargesIn(listening)) return;
        dispatch({ type: "barge" });
        return hush();
      }
      if (!ended) return;
      pauseBegan.current = at - listening.quiet;
      dispatch({ type: ended });
    }, (e: unknown) => {
      if (microphone.current !== mic) return;
      setWarning({ error: `Could not tell speech from silence: ${e instanceof Error ? e.message : String(e)}`, help: ["Typing still works"] });
      dispatch({ type: "failed" });
    });
  };

  /**
   * While the Lead speaks, or all through a session, listen for the user
   * talking; a session keeps the microphone it recorded on, and the Lead's
   * voice is watched only once the page may use the microphone, never prompting.
   */
  const watch = async () => {
    try {
      if ((await navigator.permissions.query({ name: "microphone" as PermissionName })).state !== "granted") return;
    } catch {
      // A browser that cannot tell (Safari) leaves barge-in to a tap.
      return;
    }
    if (!watches(current.current) || microphone.current) return;
    const mic = new Microphone();
    microphone.current = mic;
    early.current = [];
    mic.start((pcm) => onBatch(mic, pcm)).catch(() => {
      if (microphone.current === mic) dispatch({ type: "failed" });
    });
  };

  /** Start an utterance: on the microphone that was watching, if any, from the words that broke in when `barged`. */
  const start = (barged: boolean) => {
    setWarning(null);
    setNote(null);
    setInterim("");
    const watched = microphone.current;
    if (watched) {
      socket.current!.command({ type: "start", utterance: ++utterance.current });
      const words = early.current.splice(0);
      if (barged) for (const pcm of words) socket.current!.send(pcm.buffer as ArrayBuffer);
      watched.ears.begin(barged);
      return;
    }
    let mic: Microphone;
    try {
      mic = new Microphone();
    } catch {
      setWarning({ error: "This browser cannot record audio here", help: ["Open the app over HTTPS (see docs/voice.md); typing still works"] });
      return dispatch({ type: "failed" });
    }
    microphone.current = mic;
    socket.current!.command({ type: "start", utterance: ++utterance.current });
    mic.ears.begin(false);
    mic.start((pcm) => onBatch(mic, pcm)).catch((e: unknown) => {
      if (microphone.current !== mic) return;
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setWarning(e instanceof NeedsGesture
        ? { error: "The browser lets this page record only after a click on it", help: ["Click once anywhere on the page, then talk or press the key again"] }
        : e instanceof NoModels
        ? { error: `Could not load the models that hear speech: ${e.message}`, help: ["Check that nico-agent serve runs, then try again; typing still works"] }
        : {
          error: denied ? "The microphone is blocked for this page" : `Could not record: ${e instanceof Error ? e.message : String(e)}`,
          help: [denied ? "Allow the microphone in the browser's site settings; typing still works" : "Typing still works"],
        });
      dispatch({ type: "failed" });
    });
  };

  // With Voice on the socket stays open to hear the Lead, and any gesture lets its audio play;
  // off, the Lead falls silent and the socket closes, unless the user is talking.
  useEffect(() => {
    if (!voice) {
      hush();
      if (current.current.mode === "idle") socket.current!.close();
      return;
    }
    socket.current!.open();
    const wake = () => player.wake();
    document.addEventListener("pointerdown", wake);
    document.addEventListener("keydown", wake);
    return () => {
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
    };
  }, [voice]);

  useEffect(() => () => {
    microphone.current?.stop();
    player.close();
    socket.current?.close();
  }, []);

  /** In a session, a tap or the key while the Lead speaks only stops it; the session goes on. */
  const stopsLead = () => player.speaking && ends(current.current);
  const press = () => {
    player.wake();
    if (!stopsLead()) dispatch({ type: "press", at: performance.now() });
    hush();
  };
  const release = () => dispatch({ type: "release", at: performance.now() });
  // The key anywhere: a tap from wherever the user is, heard by the page that connected last.
  usePageCommand("listen", () => {
    player.wake();
    if (!stopsLead()) dispatch({ type: "key" });
    hush();
  });
  return { state, interim, warning, note, speaking, press, release, hush };
}

/** The button's label: in a session, a tap stops the Lead speaking, or else ends it while nobody talks. */
function label(state: Talk, speaking: boolean) {
  if (state.mode === "holding") return "Release to send";
  if (state.mode === "hands-free") return "Tap to send";
  if (!ends(state)) return "Talk";
  return speaking ? "Stop" : "End";
}

/** The button itself: pointer and keyboard both hold it, Space or Enter as the key. */
export function TalkButton({ talk: { state, speaking, press, release } }: { talk: ReturnType<typeof useTalk> }) {
  const key = (e: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && !e.repeat) press();
    if (!down) release();
  };
  const recording = state.mode === "holding" || state.mode === "hands-free";
  return (
    <button
      type="button"
      className={`talk ${state.mode}`}
      aria-pressed={recording}
      title={ends(state) ? (speaking ? "Stop the speech" : "End the hands-free session") : "Hold to talk, or tap to talk hands-free"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      // A key held while focus leaves never comes up.
      onBlur={() => { if (state.mode === "holding") release(); }}
      onKeyDown={(e) => key(e, true)}
      onKeyUp={(e) => key(e, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.5" /></svg>
      <span>{label(state, speaking)}</span>
    </button>
  );
}

const SAYS: Record<Indicator, string> = { listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

/** The indicator's note: what is heard, or what the user waits on: `who`, the tab's agent. */
function detailOf(kind: Indicator, state: Talk, interim: string, who: string) {
  if (kind === "listening") return interim || (state.mode === "watching" ? "Talk when you are ready." : "");
  if (kind === "thinking") return state.mode === "transcribing" ? "Transcribing…" : `${who} is working on it.`;
  return "Talk over it or tap to stop.";
}

/**
 * Where the conversation by voice stands, while there is one: listening
 * (with what is heard), thinking (transcribing, or the tab's agent, `who`,
 * `working`) or speaking, with Stop; a session's End; or a note. Nothing while
 * idle. Why voice failed shows with the page's other warnings, not here.
 */
export function TalkStatus({ talk: { state, interim, warning, note, speaking, press, hush }, working, who = "The Lead" }: {
  talk: ReturnType<typeof useTalk>; working: boolean; who?: string;
}) {
  const kind = indicator(state, { speaking, working });
  const line = kind && (
    <p className={`indicator ${kind}`}>
      <i aria-hidden="true" />
      <b>{SAYS[kind]}</b>
      <span className={kind === "listening" && interim ? "interim" : undefined}>{detailOf(kind, state, interim, who)}</span>
      {kind === "speaking" && <button type="button" onClick={hush}>Stop</button>}
      {ends(state) && kind !== "speaking" && <button type="button" onClick={press}>End</button>}
    </p>
  );
  if (!line && !(note && !warning)) return null;
  return (
    <div className="talk-status" role="status" aria-live="polite">
      {!warning && note && <p className="help">{note}</p>}
      {line}
    </div>
  );
}
