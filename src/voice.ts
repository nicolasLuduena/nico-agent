// A 2.5s WAV, 16kHz mono, of "Dispatch the next issue on the Board."
import sample from "./voice-sample.wav" with { type: "file" };
import { VOICE_DOC, VOICE_SERVICES, type VoiceConfig, type VoiceEndpoint, type VoiceService } from "./config";
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
  scribe: {
    async request(endpoint, headers) {
      headers.set("content-type", "application/json");
      const body = {
        model: endpoint.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Clean up this dictated text: drop the disfluencies, fix the punctuation, spell these terms as written: " +
              `${VOCABULARY.join(", ")}. Keep the meaning. Reply with the text only.`,
          },
          { role: "user", content: RAW_TRANSCRIPT },
        ],
      };
      return new Request(`${base(endpoint)}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
    },
    async read(response) {
      const choices = (await responseJson(response))?.choices;
      const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
      if (typeof content !== "string") throw new ProbeFailed("answered without a message");
      return content.trim();
    },
  },
};

/** The sentence `speak` is asked to read. */
const SPOKEN_TEXT = "The Board has two Ready issues.";

/** A raw transcript of the sample, as a transcription service might hear it, for the Scribe to clean. */
const RAW_TRANSCRIPT = "um dispatch the uh next issue on the bored";

/** Domain terms the Scribe is told to spell as written, as the real one gets the glossary's and the Board's. */
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
    const check = await checkService(world, service, voice[service]);
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
  const failed = (error: string, help: string) => ({ error, help });
  const headers = new Headers();
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
  const request = await probe.request(endpoint, headers);
  const started = world.now().getTime();
  let response: Response;
  try {
    response = await world.http(request);
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    return failed(e.message, `Start the ${service} service (see ${VOICE_DOC}) or fix voice.${service}.url`);
  }
  const checkSettings = `Check voice.${service}.url and voice.${service}.model`;
  if (!response.ok) return failed(`answered ${response.status}: ${await errorMessage(response)}`, checkSettings);
  let returned: string;
  try {
    returned = await probe.read(response);
  } catch (e) {
    if (!(e instanceof ProbeFailed)) throw e;
    return failed(e.message, checkSettings);
  }
  // Up to the whole answer read: a streamed one's headers come long before its audio.
  return { ms: world.now().getTime() - started, returned };
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
