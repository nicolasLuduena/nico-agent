import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Transcript, VoiceCommand } from "../transcription";
import { type Listening, type Talk, type TalkEvent, LISTENING, level, listen, resampler, talk } from "./talk";

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

  constructor(private readonly heard: (message: Transcript) => void, private readonly lost: () => void) {}

  /** Tell `/api/voice` what the utterance does. */
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

  private open() {
    if (this.socket) return this.socket;
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/voice`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      for (const message of this.queue.splice(0)) socket.send(message);
    };
    socket.onmessage = ({ data }) => {
      if (typeof data === "string") this.heard(JSON.parse(data) as Transcript);
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

/**
 * The talk button: hold it to talk, release to send; tap it to talk
 * hands-free until a pause, or tap again to send. Interim transcripts show
 * while the user speaks; the final one, the Scribe's text and what was
 * heard, is handed to `onFinal`.
 */
export function useTalk(onFinal: (text: string, raw: string) => void) {
  const [state, setState] = useState<Talk>({ mode: "idle" });
  const [interim, setInterim] = useState("");
  const [warning, setWarning] = useState<Warning | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const current = useRef(state);
  const microphone = useRef<Microphone | null>(null);
  const listening = useRef<Listening>(LISTENING);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const socket = useRef<VoiceSocket | null>(null);
  /** The number of the utterance last started; answers about an older one never change the button. */
  const utterance = useRef(0);

  const stopMicrophone = () => {
    microphone.current?.stop();
    microphone.current = null;
  };

  const dispatch = (event: TalkEvent) => {
    const { state: next, send } = talk(current.current, event);
    current.current = next;
    setState(next);
    if (next.mode !== "holding" && next.mode !== "hands-free") stopMicrophone();
    if (send === "start") start();
    else if (send) socket.current?.command({ type: send });
  };

  socket.current ??= new VoiceSocket(
    (message) => {
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
      if (text) onFinalRef.current(text, message.raw.trim());
      // The Scribe could not clean it: sent as heard, saying why.
      if (message.warning) setWarning(message.warning);
      if (!latest) return;
      setInterim("");
      if (!text) setNote("Heard nothing; try again.");
      dispatch({ type: "final" });
    },
    () => {
      if (current.current.mode === "idle") return;
      setWarning(LOST);
      dispatch({ type: "failed" });
    },
  );

  const start = () => {
    setWarning(null);
    setNote(null);
    setInterim("");
    listening.current = LISTENING;
    stopMicrophone();
    let mic: Microphone;
    try {
      mic = new Microphone();
    } catch {
      setWarning({ error: "This browser cannot record audio here", help: ["Open the app over HTTPS (see docs/voice.md); typing still works"] });
      return dispatch({ type: "failed" });
    }
    microphone.current = mic;
    socket.current!.command({ type: "start", utterance: ++utterance.current });
    mic.start((pcm, loudness, ms) => {
      socket.current!.send(pcm.buffer as ArrayBuffer);
      const heard = listen(listening.current, loudness, ms);
      listening.current = heard.state;
      if (heard.ended) dispatch({ type: heard.ended });
    }).catch((e: unknown) => {
      if (microphone.current !== mic) return;
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setWarning({
        error: denied ? "The microphone is blocked for this page" : `Could not record: ${e instanceof Error ? e.message : String(e)}`,
        help: [denied ? "Allow the microphone in the browser's site settings; typing still works" : "Typing still works"],
      });
      dispatch({ type: "failed" });
    });
  };

  useEffect(() => () => {
    microphone.current?.stop();
    socket.current?.close();
  }, []);

  const press = () => dispatch({ type: "press", at: performance.now() });
  const release = () => dispatch({ type: "release", at: performance.now() });
  return { state, interim, warning, note, press, release };
}

const LABEL: Record<Talk["mode"], string> = { idle: "Talk", holding: "Release to send", "hands-free": "Tap to send", transcribing: "Talk" };

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

/** What the user is saying as it is heard, or why voice failed; nothing while idle and fine. */
export function TalkStatus({ talk: { state, interim, warning, note } }: { talk: ReturnType<typeof useTalk> }) {
  if (warning) {
    return (
      <div className="talk-status" role="status">
        <p className="warning">{warning.error}</p>
        {warning.help.map((h) => <p key={h} className="help">{h}</p>)}
      </div>
    );
  }
  if (state.mode === "idle") return note ? <div className="talk-status" role="status"><p className="help">{note}</p></div> : null;
  return (
    <div className="talk-status" role="status" aria-live="polite">
      <p className={interim ? "interim" : "help"}>{interim || (state.mode === "transcribing" ? "Transcribing…" : "Listening…")}</p>
    </div>
  );
}
