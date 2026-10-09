import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Speech } from "../speech";
import type { Transcript, VoiceCommand } from "../transcription";
import { type Listening, type Talk, type TalkEvent, LISTENING, bargesIn, level, listen, pcmSamples, resampler, talk } from "./talk";

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

/** The microphone, recording one utterance: each batch resampled to 16kHz PCM and measured. */
class Microphone {
  private context: AudioContext;
  private stream: MediaStream | null = null;
  private stopped = false;

  /** Created in the press itself: Safari lets audio start only in a user gesture. */
  constructor() {
    this.context = new AudioContext();
    void this.context.resume();
  }

  async start(onBatch: (pcm: Int16Array, level: number, ms: number) => void) {
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
      if (!this.stopped) onBatch(toPcm(data), level(data), (data.length / this.context.sampleRate) * 1000);
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

/** `/api/voice` on the server the page came from, opened when first needed, its sends queued until it opens. */
class VoiceSocket {
  private socket: WebSocket | null = null;
  private queue: (string | ArrayBuffer)[] = [];

  constructor(
    private readonly heard: (message: Transcript | Speech) => void,
    private readonly audio: (pcm: ArrayBuffer) => void,
    private readonly lost: () => void,
  ) {}

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

/** The Lead's voice: each chunk of its speech played right after the one before, all stopped at once by `stop`. */
class Player {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  /** When the last chunk scheduled ends, in the context's time. */
  private until = 0;
  private rate = 0;
  /** Whether the speech that began has ended (or none began), so once its chunks play out, the Lead is done. */
  private ended = true;

  constructor(private readonly done: () => void) {}

  /** Created and resumed in a user gesture, as browsers let audio start only then. */
  wake() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  /** Whether the Lead is speaking: a speech not ended, or chunks still playing. */
  get speaking() {
    return !this.ended || this.sources.size > 0;
  }

  begin(rate: number) {
    this.wake();
    this.rate = rate;
    this.ended = false;
  }

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

  close() {
    this.stop();
    void this.context?.close();
  }

  private settle() {
    if (!this.speaking) this.done();
  }
}

/** How many of the microphone's last batches a watch keeps, about half a second: the start of the words that broke in. */
const EARLY_BATCHES = 12;

/**
 * The talk button: hold it to talk, release to send; tap it to talk
 * hands-free until a pause, or tap again to send. Interim transcripts show
 * while the user speaks; the final one, the Scribe's text and what was
 * heard, is handed to `onFinal`, with the question it answers when it was
 * said right after the Lead asked. With `voice` on, the Lead's replies are
 * spoken as they come; a press, or the user talking over it (the microphone
 * watches while it speaks, once the page may use it), stops it at once.
 */
export function useTalk(onFinal: (text: string, raw: string, answers?: number) => void, voice: boolean) {
  const [state, setState] = useState<Talk>({ mode: "idle" });
  const [interim, setInterim] = useState("");
  const [warning, setWarning] = useState<Warning | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const current = useRef(state);
  const microphone = useRef<Microphone | null>(null);
  const listening = useRef<Listening>(LISTENING);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
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
    const before = current.current.mode;
    const { state: next, send } = talk(current.current, event);
    current.current = next;
    setState(next);
    if (next.mode === "idle" || next.mode === "transcribing") stopMicrophone();
    if (next.mode === "watching" && before !== "watching") void watch();
    if (send === "start") start(event.type === "barge");
    else if (send) socket.current?.command({ type: send });
  };

  const player = useRef<Player | null>(null);
  player.current ??= new Player(() => {
    setSpeaking(false);
    dispatch({ type: "lead-done" });
  });

  /** Stop the Lead speaking, here and at `serve`, which drops what waits to be spoken. */
  const hush = () => {
    if (!player.current!.speaking) return;
    player.current!.stop();
    socket.current?.command({ type: "hush" });
  };

  socket.current ??= new VoiceSocket(
    (message) => {
      if (message.type === "speech") {
        if (!voiceRef.current) return;
        player.current!.begin(message.rate);
        setSpeaking(true);
        dispatch({ type: "lead-speaks" });
        return;
      }
      if (message.type === "speech-end") return player.current!.end();
      if (message.type === "speech-error") {
        // The Lead's reply still shows; only its voice is missing.
        player.current!.end();
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
      // The last utterance's final is still sent while the next one records.
      const text = message.text.trim();
      if (text) onFinalRef.current(text, message.raw.trim(), message.answers);
      // The Scribe could not clean it: sent as heard, saying why.
      if (message.warning) setWarning(message.warning);
      if (!latest) return;
      setInterim("");
      if (!text) setNote("Heard nothing; try again.");
      dispatch({ type: "final" });
    },
    (pcm) => player.current!.play(pcm),
    () => {
      player.current!.stop();
      if (current.current.mode === "idle") return;
      setWarning(LOST);
      dispatch({ type: "failed" });
    },
  );

  /** Each batch the microphone hears: while watching, kept and checked for the user talking over the Lead; else sent. */
  const heard = (pcm: Int16Array, loudness: number, ms: number) => {
    const next = listen(listening.current, loudness, ms);
    listening.current = next.state;
    if (current.current.mode === "watching") {
      early.current = [...early.current.slice(1 - EARLY_BATCHES), pcm];
      if (!bargesIn(next.state)) return;
      dispatch({ type: "barge" });
      return hush();
    }
    socket.current!.send(pcm.buffer as ArrayBuffer);
    if (next.ended) dispatch({ type: next.ended });
  };

  /** While the Lead speaks, listen for the user talking over it; only once the page may use the microphone, never prompting. */
  const watch = async () => {
    try {
      if ((await navigator.permissions.query({ name: "microphone" as PermissionName })).state !== "granted") return;
    } catch {
      // A browser that cannot tell (Safari) leaves barge-in to a tap.
      return;
    }
    if (current.current.mode !== "watching" || microphone.current) return;
    const mic = new Microphone();
    microphone.current = mic;
    listening.current = LISTENING;
    early.current = [];
    mic.start(heard).catch(() => {
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
      if (barged) {
        for (const pcm of words) socket.current!.send(pcm.buffer as ArrayBuffer);
        // The utterance is as long as the words that broke in.
        listening.current = { ...listening.current, elapsed: listening.current.voiced };
      } else {
        listening.current = LISTENING;
      }
      return;
    }
    listening.current = LISTENING;
    let mic: Microphone;
    try {
      mic = new Microphone();
    } catch {
      setWarning({ error: "This browser cannot record audio here", help: ["Open the app over HTTPS (see docs/voice.md); typing still works"] });
      return dispatch({ type: "failed" });
    }
    microphone.current = mic;
    socket.current!.command({ type: "start", utterance: ++utterance.current });
    mic.start(heard).catch((e: unknown) => {
      if (microphone.current !== mic) return;
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setWarning({
        error: denied ? "The microphone is blocked for this page" : `Could not record: ${e instanceof Error ? e.message : String(e)}`,
        help: [denied ? "Allow the microphone in the browser's site settings; typing still works" : "Typing still works"],
      });
      dispatch({ type: "failed" });
    });
  };

  // With Voice on the socket stays open to hear the Lead, and any gesture lets its audio play; off, it falls silent.
  useEffect(() => {
    if (!voice) {
      hush();
      return;
    }
    socket.current!.open();
    const wake = () => player.current!.wake();
    document.addEventListener("pointerdown", wake);
    document.addEventListener("keydown", wake);
    return () => {
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
    };
  }, [voice]);

  useEffect(() => () => {
    microphone.current?.stop();
    player.current?.close();
    socket.current?.close();
  }, []);

  const press = () => {
    player.current!.wake();
    dispatch({ type: "press", at: performance.now() });
    hush();
  };
  const release = () => dispatch({ type: "release", at: performance.now() });
  return { state, interim, warning, note, speaking, press, release, hush };
}

const LABEL: Record<Talk["mode"], string> = { idle: "Talk", holding: "Release to send", "hands-free": "Tap to send", transcribing: "Talk", watching: "Talk" };

/** The button itself: pointer and keyboard both hold it, Space or Enter as the key. */
export function TalkButton({ talk: { state, press, release } }: { talk: ReturnType<typeof useTalk> }) {
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
      title="Hold to talk, or tap to talk hands-free"
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
      <span>{LABEL[state.mode]}</span>
    </button>
  );
}

/** What the user is saying as it is heard, the Lead speaking, or why voice failed; nothing while idle and fine. */
export function TalkStatus({ talk: { state, interim, warning, note, speaking, hush } }: { talk: ReturnType<typeof useTalk> }) {
  const stop = speaking && (
    <p className="speaking">
      <span>The Lead is speaking; talk over it or tap to stop.</span>
      <button type="button" onClick={hush}>Stop</button>
    </p>
  );
  if (warning) {
    return (
      <div className="talk-status" role="status">
        <p className="warning">{warning.error}</p>
        {warning.help.map((h) => <p key={h} className="help">{h}</p>)}
        {stop}
      </div>
    );
  }
  if (state.mode === "idle" || state.mode === "watching") {
    if (stop) return <div className="talk-status" role="status">{stop}</div>;
    return note ? <div className="talk-status" role="status"><p className="help">{note}</p></div> : null;
  }
  return (
    <div className="talk-status" role="status" aria-live="polite">
      <p className={interim ? "interim" : "help"}>{interim || (state.mode === "transcribing" ? "Transcribing…" : "Listening…")}</p>
    </div>
  );
}
