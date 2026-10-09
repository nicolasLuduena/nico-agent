import sample from "./voice-sample.wav" with { type: "file" };
import { VOICE_SERVICES, type VoiceConfig, type VoiceEndpoint, type VoiceService } from "./config";
import { type World, WorldError } from "./world";

/** What `voice check` found of one voice service. */
export type ServiceCheck =
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

/** What the sample WAV says, for a person comparing the transcript. */
export const SAMPLE_TEXT = "Dispatch the next issue on the Board.";

const PROBES: Record<VoiceService, Probe> = {
  transcribe: {
    async request(endpoint, headers) {
      const form = new FormData();
      form.set("file", new File([await Bun.file(sample).arrayBuffer()], "sample.wav", { type: "audio/wav" }));
      form.set("model", endpoint.model);
      form.set("response_format", "json");
      return new Request(`${base(endpoint)}/audio/transcriptions`, { method: "POST", headers, body: form });
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

/**
 * Send each configured voice service a short sample, timing its answer. One
 * at a time, so local services sharing the machine don't slow each other's.
 */
export async function checkVoice(world: World, voice: VoiceConfig): Promise<ServiceCheck[]> {
  const checks: ServiceCheck[] = [];
  for (const service of VOICE_SERVICES) checks.push(await checkService(world, service, voice[service]));
  return checks;
}

async function checkService(world: World, service: VoiceService, endpoint: VoiceEndpoint | undefined): Promise<ServiceCheck> {
  if (!endpoint) return { service, status: "not configured" };
  const { url, model } = endpoint;
  const failed = (error: string, help: string): ServiceCheck => ({ service, status: "failed", url, model, error, help });
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
  const probe = PROBES[service];
  const request = await probe.request(endpoint, headers);
  const started = world.now().getTime();
  let response: Response;
  try {
    response = await world.http(request);
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    return failed(e.message, `Start the ${service} service (see docs/voice.md) or fix voice.${service}.url`);
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
  return { service, status: "ok", url, model, ms: world.now().getTime() - started, returned };
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
