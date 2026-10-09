// A 2.5s WAV, 16kHz mono, of "Dispatch the next issue on the Board."
import sample from "./voice-sample.wav" with { type: "file" };
import { VOICE_DOC, VOICE_SERVICES, frontVoiceEndpoint, type VoiceConfig, type VoiceEndpoint, type VoiceService } from "./config";
import { VERSION } from "./version";
import { type World, WorldError } from "./world";

/** What `voice check` found of one voice service. */
type ServiceCheck =
  | { service: VoiceService; status: "not configured" }
  | { service: VoiceService; status: "ok"; url: string; model: string; ms: number; returned: string }
  | { service: VoiceService; status: "failed"; url: string; model: string; error: string; help: string };

/** A request that tests one service, and how to tell what it returned. */
interface Probe {
  request(endpoint: VoiceEndpoint, headers: Headers): Promise<Request>;
  /** What the service returned, in a line; throws a ProbeFailed when it isn't an answer. */
  read(response: Response): Promise<string>;
}

/** A service answered, but not with what was asked for. */
class ProbeFailed extends Error {}

const PROBES: Record<VoiceService, Probe> = {
  transcribe: {
    async request(endpoint, headers) {
      return transcriptionRequest(endpoint, headers, new File([await Bun.file(sample).arrayBuffer()], "sample.wav", { type: "audio/wav" }));
    },
    async read(response) {
      const text = (await responseJson(response))?.text;
      if (typeof text !== "string") throw new ProbeFailed("answered without a transcript");
      return text.trim();
    },
  },
  speak: {
    async request(endpoint, headers) {
      headers.set("content-type", "application/json");
      const body = { model: endpoint.model, input: SPOKEN_TEXT, voice: endpoint.voice ?? DEFAULT_VOICE, response_format: "wav" };
      return new Request(`${base(endpoint)}/audio/speech`, { method: "POST", headers, body: JSON.stringify(body) });
    },
    async read(response) {
      const audio = await response.arrayBuffer();
      const type = response.headers.get("content-type") ?? "";
      if (audio.byteLength === 0 || !type.startsWith("audio/")) throw new ProbeFailed("answered without audio");
      return `${audio.byteLength} bytes of ${type}`;
    },
  },
  front: {
    async request(endpoint, headers) {
      // A check is a conversation of its own.
      const turn = { heard: RAW_TRANSCRIPT, context: `Terms: ${VOCABULARY.join(", ")}.`, sessionId: crypto.randomUUID(), stream: false };
      return frontVoiceRequest(endpoint, headers, turn);
    },
    async read(response) {
      const choices = (await responseJson(response))?.choices;
      const message = Array.isArray(choices) ? choices[0]?.message : undefined;
      const call = Array.isArray(message?.tool_calls) ? message.tool_calls[0]?.function : undefined;
      if (typeof call?.name === "string") return `${call.name} ${String(call.arguments ?? "")}`.trim();
      if (typeof message?.content !== "string") throw new ProbeFailed("answered without a message");
      if (!message.content.trim()) throw new ProbeFailed("answered with an empty message");
      return message.content.trim();
    },
  },
};

/** The sentence `speak` is asked to read. */
const SPOKEN_TEXT = "The Board has two Ready issues.";

/** A raw transcript of the sample, as a transcription service might hear it, for the Front voice to hand off. */
const RAW_TRANSCRIPT = "um dispatch the uh next issue on the bored";

/** Domain terms the Front voice is told to spell as written, as the real one gets the glossary's and the Board's. */
const VOCABULARY = ["Board", "Lead", "Dispatch", "Spec", "herdr"];

/** The voice `speak` reads in when voice.speak.voice is unset: OpenAI's, which Kokoro-FastAPI maps too. */
const DEFAULT_VOICE = "alloy";

/** What `voice check` found: a row per service, and what to do about each failed one. */
export interface VoiceProbe {
  services: Record<string, unknown>[];
  help: string[];
}

/**
 * Send each configured voice service a short sample, timing its answer. One
 * at a time, so local services sharing the machine don't slow each other's.
 */
export async function probeVoice(world: World, voice: VoiceConfig): Promise<VoiceProbe> {
  const probe: VoiceProbe = { services: [], help: [] };
  for (const service of VOICE_SERVICES) {
    // The Front voice always runs: on opencode go when voice.front is left out.
    const check = await checkService(world, service, service === "front" ? frontVoiceEndpoint(voice) : voice[service]);
    if (check.status === "failed") {
      const { help, ...row } = check;
      probe.services.push(row);
      probe.help.push(help);
    } else {
      probe.services.push(check);
    }
  }
  return probe;
}

async function checkService(world: World, service: VoiceService, endpoint: VoiceEndpoint | undefined): Promise<ServiceCheck> {
  if (!endpoint) return { service, status: "not configured" };
  const { url, model } = endpoint;
  const answer = await ask(world, service, endpoint, PROBES[service]);
  return "error" in answer ? { service, status: "failed", url, model, ...answer } : { service, status: "ok", url, model, ...answer };
}

/** What a voice service answered, and how long it took; or why it did not, and what to do. */
export type Answered = { ms: number; returned: string } | { error: string; help: string };

/** Send `probe`'s request to `endpoint`, with its key, and read the answer. */
async function ask(world: World, service: VoiceService, endpoint: VoiceEndpoint, probe: Probe): Promise<Answered> {
  const started = world.now().getTime();
  const reached = await reach(world, service, endpoint, probe.request);
  if (!("response" in reached)) return reached;
  const { response } = reached;
  let returned: string;
  try {
    returned = await probe.read(response);
  } catch (e) {
    if (!(e instanceof ProbeFailed)) throw e;
    return { error: e.message, help: checkSettings(service) };
  }
  // Up to the whole answer read: a streamed one's headers come long before its audio.
  return { ms: world.now().getTime() - started, returned };
}

/**
 * Send the request `build` makes to `endpoint`, with its key, and resolve with
 * the service's answer when it is a success; else why not, and what to do.
 */
async function reach(
  world: World,
  service: VoiceService,
  endpoint: VoiceEndpoint,
  build: Probe["request"],
): Promise<{ response: Response } | { error: string; help: string }> {
  const failed = (error: string, help: string) => ({ error, help });
  // opencode go asks each client to name itself (https://opencode.ai/docs/go/#where-can-i-use-it).
  const headers = new Headers({ "user-agent": `nico-agent/${VERSION}` });
  if (endpoint.keyEnv) {
    const key = world.env(endpoint.keyEnv);
    if (!key) {
      return failed(
        `${endpoint.keyEnv} is not set`,
        `Set ${endpoint.keyEnv} in the environment nico-agent runs in, or drop voice.${service}.keyEnv for a service that needs no key`,
      );
    }
    headers.set("authorization", `Bearer ${key}`);
  }
  const request = await build(endpoint, headers);
  let response: Response;
  try {
    response = await world.http(request);
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    return failed(e.message, `Start the ${service} service (see ${VOICE_DOC}) or fix voice.${service}.url`);
  }
  if (!response.ok) {
    const message = await errorMessage(response);
    const header = missingHeader(message);
    const help = header
      ? `The ${service} service wants the ${header} header, which nico-agent did not send: update nico-agent, or set voice.${service} to another endpoint (see ${VOICE_DOC})`
      : checkSettings(service);
    return failed(`answered ${response.status}: ${message}`, help);
  }
  return { response };
}

/**
 * The header an error message says the request is missing: an `x-` header, as
 * opencode go's "Request is missing x-opencode-session", or one it calls a
 * header ("missing Authorization header"); else null.
 */
function missingHeader(message: string): string | null {
  const said = /\bmissing (?:the )?["'`]?(x-[\w-]+|[\w-]+(?=["'`]? header\b))/i.exec(message);
  return said?.[1] ?? null;
}

/** The rate of the audio `speak` streams: 16-bit mono PCM at 24kHz, OpenAI's `pcm` format, which Kokoro-FastAPI shares. */
export const SPEECH_RATE = 24_000;

/**
 * `text` read aloud by the speech service, as a stream of 16-bit
 * little-endian mono PCM at SPEECH_RATE, read as it is made.
 */
export async function speak(world: World, endpoint: VoiceEndpoint, text: string): Promise<{ audio: ReadableStream<Uint8Array> } | { error: string; help: string }> {
  const reached = await reach(world, "speak", endpoint, async (endpoint, headers) => {
    headers.set("content-type", "application/json");
    const body = { model: endpoint.model, input: text, voice: endpoint.voice ?? DEFAULT_VOICE, response_format: "pcm" };
    return new Request(`${base(endpoint)}/audio/speech`, { method: "POST", headers, body: JSON.stringify(body) });
  });
  if (!("response" in reached)) return reached;
  const audio = reached.response.body;
  return audio ? { audio } : { error: "answered without audio", help: checkSettings("speak") };
}

/** What to do when a service answers, but not with what was asked for. */
function checkSettings(service: VoiceService) {
  return `Check voice.${service}.url and voice.${service}.model`;
}

/**
 * What the transcription service hears in `audio`, a WAV, told to expect the
 * words of `prompt` (the vocabulary hint).
 */
export function transcribe(world: World, endpoint: VoiceEndpoint, audio: Uint8Array<ArrayBuffer>, prompt: string): Promise<Answered> {
  return ask(world, "transcribe", endpoint, {
    request: async (endpoint, headers) => transcriptionRequest(endpoint, headers, new File([audio], "utterance.wav", { type: "audio/wav" }), prompt),
    read: PROBES.transcribe.read,
  });
}

/**
 * Who a Front voice hands off to (ADR-0014): the Lead in the Lead's tab, the
 * tab's Partner in a Partner's; by name ("the Lead"), and what it is, as the
 * Front voice is told.
 */
export interface HandOffTarget {
  name: string;
  is: string;
}

/** The Lead, as the Front voice in its tab is told of it. */
export const THE_LEAD: HandOffTarget = { name: "the Lead", is: "an agent that runs coding agents on a Board of issues" };

/**
 * What the Front voice is sent for one thing the user said: `heard`, the raw
 * transcript, and `context`, what it reads (see `readContext` in front-voice.ts),
 * in the Conversation `sessionId` names; streamed as it is made, or whole for
 * `voice check`. It hands off `to` its tab's agent, the Lead unless told otherwise.
 */
export interface FrontVoiceTurn {
  heard: string;
  context: string;
  /** The Conversation's stable id, sent as `x-opencode-session` for opencode go to route and cache by; other endpoints ignore it. */
  sessionId: string;
  stream: boolean;
  to?: HandOffTarget;
}

/** The Front voice's one tool (ADR-0013): it hands the user's message `to` its tab's agent, and acts on nothing itself. */
export function handOffTool(to: HandOffTarget = THE_LEAD) {
  const thread = to === THE_LEAD ? "the Conversation" : "the Thread";
  return {
    type: "function",
    function: {
      name: "hand_off",
      description: `Write the user's message into ${thread} for ${to.name}, as the user's own words, cleaned. ` +
        "For anything that needs judgment, a decision or an action.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "What the user said, cleaned: fillers and repeated words dropped, terms spelled as written, punctuation fixed, the meaning unchanged" },
          choice: { type: "integer", minimum: 1, description: `Answering ${to.name}'s question with choices: the number of the choice the answer picks; left out when it picks none clearly` },
        },
        required: ["message"],
      },
    },
  } as const;
}

/** What the Front voice is told it is and does, before what it reads: handing off `to` its tab's agent. */
function frontVoiceRules({ name, is }: HandOffTarget) {
  return [
    `You are the Front voice of nico-agent. You hold a spoken conversation with the user in front of ${name}, ${is}. ` +
    "The user hears what you write, read aloud.",
    `You can do two things only: answer from what you read below, and hand the user's message to ${name} with hand_off.`,
    "- Answer yourself small talk, a request to say something again, and questions that what you read below answers.",
    "- Hand off anything that needs judgment, a decision or an action (dispatching, answering, approving, merging, changing anything), " +
    `an answer to ${name}'s question, and any question you cannot answer from what you read. Never act, never promise an action, never say ${name} did what you cannot read.`,
    `- When you hand off, write nothing yourself: the user is told you asked ${name}.`,
    "- hand_off's message is the user's words cleaned: drop fillers (um, uh) and words said twice, spell the terms below exactly as written, fix punctuation. Never answer or change the message.",
    "- Talk for the ear: one to three short sentences, no lists, no Markdown, issues by their title.",
  ].join("\n");
}

/** A request for the Front voice's reply to `turn`, with hand_off its only tool. */
export function frontVoiceRequest(endpoint: VoiceEndpoint, headers: Headers, { heard, context, sessionId, stream, to = THE_LEAD }: FrontVoiceTurn) {
  headers.set("content-type", "application/json");
  headers.set("x-opencode-session", sessionId);
  const messages = [{ role: "system", content: `${frontVoiceRules(to)}\n\n${context}` }, { role: "user", content: heard }];
  const body = { model: endpoint.model, temperature: 0, stream, tools: [handOffTool(to)], messages };
  return new Request(`${base(endpoint)}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
}

/**
 * A piece of the Front voice's reply as it streams: words to say; that a
 * tool call began (`calling`, its name); or the call, once its arguments
 * are whole.
 */
export type ReplyPart = { text: string } | { calling: string } | { call: { name: string; arguments: string } };

/**
 * The Front voice's reply to `turn`, read as the endpoint streams it
 * (`stream: true`, OpenAI's server-sent events); `signal` stops it.
 */
export async function frontVoiceReply(world: World, endpoint: VoiceEndpoint, turn: Omit<FrontVoiceTurn, "stream">, signal?: AbortSignal):
  Promise<{ parts: AsyncGenerator<ReplyPart> } | { error: string; help: string }> {
  const reached = await reach(world, "front", endpoint, async (endpoint, headers) => {
    const request = frontVoiceRequest(endpoint, headers, { ...turn, stream: true });
    return signal ? new Request(request, { signal }) : request;
  });
  if (!("response" in reached)) return reached;
  const body = reached.response.body;
  return body ? { parts: replyParts(body) } : { error: "answered without a message", help: checkSettings("front") };
}

/**
 * The parts of a streamed chat completion: its content as it comes, and each
 * tool call as it begins and once whole: when the next one begins, the
 * choice finishes, or the stream ends.
 */
async function* replyParts(body: ReadableStream<Uint8Array>): AsyncGenerator<ReplyPart> {
  /** The tool call streaming now, by its index. */
  let open: { index: number; name: string; arguments: string } | null = null;
  const whole = function* (): Generator<ReplyPart> {
    if (open?.name) yield { call: { name: open.name, arguments: open.arguments } };
    open = null;
  };
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      const data = /^data:\s?(.*)$/.exec(line.trim())?.[1];
      if (data === undefined || data === "[DONE]") continue;
      let choice;
      try {
        choice = JSON.parse(data)?.choices?.[0];
      } catch {
        continue;
      }
      const delta = choice?.delta;
      if (typeof delta?.content === "string" && delta.content) yield { text: delta.content };
      for (const call of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
        const index: number = typeof call?.index === "number" ? call.index : (open?.index ?? 0);
        if (open && open.index !== index) yield* whole();
        open ??= { index, name: "", arguments: "" };
        const began = !open.name;
        if (typeof call?.function?.name === "string") open.name += call.function.name;
        if (began && open.name) yield { calling: open.name };
        if (typeof call?.function?.arguments === "string") open.arguments += call.function.arguments;
      }
      if (choice?.finish_reason) yield* whole();
    }
  }
  yield* whole();
}

/** A request to transcribe `file`, with `prompt` as the hint when given. */
function transcriptionRequest(endpoint: VoiceEndpoint, headers: Headers, file: File, prompt?: string) {
  const form = new FormData();
  form.set("file", file);
  form.set("model", endpoint.model);
  form.set("response_format", "json");
  if (prompt) form.set("prompt", prompt);
  return new Request(`${base(endpoint)}/audio/transcriptions`, { method: "POST", headers, body: form });
}

/** `pcm`, 16-bit little-endian mono samples at `rate`, as a WAV file. */
export function wav(pcm: Uint8Array, rate: number): Uint8Array<ArrayBuffer> {
  const file = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(file.buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  file.set(pcm, 44);
  return file;
}

/** The endpoint's base URL, without a trailing slash. */
function base(endpoint: VoiceEndpoint) {
  return endpoint.url.replace(/\/+$/, "");
}

/** The message of an OpenAI-style error answer, else the start of its body. */
async function errorMessage(response: Response) {
  const text = await response.text();
  try {
    const message = JSON.parse(text)?.error?.message;
    if (typeof message === "string") return message;
  } catch {}
  return text.trim().slice(0, 200) || response.statusText;
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
