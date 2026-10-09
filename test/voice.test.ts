import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const LOCAL = {
  transcribe: { url: "http://127.0.0.1:8010/v1", model: "deepdml/faster-whisper-large-v3-turbo-ct2" },
  speak: { url: "http://127.0.0.1:8880/v1", model: "kokoro", voice: "af_heart" },
  front: { url: "http://127.0.0.1:11434/v1", model: "qwen2.5:3b" },
};

/** The Front voice's check when voice.front is left out: opencode go, without its key. */
const GO_WITHOUT_KEY = { service: "front", status: "failed", url: "https://opencode.ai/zen/go/v1", model: "deepseek-v4.1-flash", error: "OPENCODE_API_KEY is not set" };
const GO_KEY_HELP = "Set OPENCODE_API_KEY in the environment nico-agent runs in, or drop voice.front.keyEnv for a service that needs no key";

function writeVoice(configDir: string, voice: unknown) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ repos: [], voice }));
}

describe("voice check", () => {
  test("sends the sample to the transcription service and reports what it heard and how long it took", async () => {
    const { cli, configDir, world } = setup();
    writeVoice(configDir, { transcribe: LOCAL.transcribe });
    let sent: Awaited<ReturnType<Request["formData"]>> | undefined;
    world.endpoint("http://127.0.0.1:8010/v1/audio/transcriptions", async (request) => {
      sent = await request.formData();
      world.clock = new Date(world.clock.getTime() + 840);
      return Response.json({ text: " Dispatch the next issue on the Board." });
    });

    const { json, exitCode } = await cli("voice", "check", "--json");

    expect(exitCode).toBe(1);
    expect(json().services).toEqual([
      { service: "transcribe", status: "ok", url: LOCAL.transcribe.url, model: LOCAL.transcribe.model, ms: 840, returned: "Dispatch the next issue on the Board." },
      { service: "speak", status: "not configured" },
      GO_WITHOUT_KEY,
    ]);
    expect(json().help).toEqual([GO_KEY_HELP]);
    expect(sent!.get("model")).toBe(LOCAL.transcribe.model);
    const file = sent!.get("file") as File;
    expect(file.name).toBe("sample.wav");
    expect(new TextDecoder().decode((await file.arrayBuffer()).slice(0, 4))).toBe("RIFF");
  });

  test("asks speech for a sentence and the Front voice to hand off a message, sending the key from keyEnv", async () => {
    const { cli, configDir, world } = setup();
    writeVoice(configDir, { speak: LOCAL.speak });
    world.environment.set("OPENCODE_API_KEY", "sk-test");
    const bodies: Record<string, any> = {};
    world.endpoint("http://127.0.0.1:8880/v1/audio/speech", async (request) => {
      bodies.speak = await request.json();
      world.clock = new Date(world.clock.getTime() + 10);
      // Streamed: the headers come at once, the audio 300ms later.
      const audio = new ReadableStream({
        async pull(controller) {
          world.clock = new Date(world.clock.getTime() + 300);
          controller.enqueue(new Uint8Array(4800));
          controller.close();
        },
      });
      return new Response(audio, { headers: { "content-type": "audio/wav" } });
    });
    let authorization: string | null | undefined;
    world.endpoint("https://opencode.ai/zen/go/v1/chat/completions", async (request) => {
      authorization = request.headers.get("authorization");
      bodies.front = await request.json();
      world.clock = new Date(world.clock.getTime() + 1200);
      const call = { type: "function", function: { name: "hand_off", arguments: '{"message":"Dispatch the next issue on the Board."}' } };
      return Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls: [call] } }] });
    });

    const { stdout, exitCode } = await cli("voice", "check");

    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "services[3]:",
        "  - service: transcribe",
        "    status: not configured",
        "  - service: speak",
        "    status: ok",
        "    url: \"http://127.0.0.1:8880/v1\"",
        "    model: kokoro",
        "    ms: 310",
        "    returned: 4800 bytes of audio/wav",
        "  - service: front",
        "    status: ok",
        "    url: \"https://opencode.ai/zen/go/v1\"",
        "    model: deepseek-v4.1-flash",
        "    ms: 1200",
        "    returned: \"hand_off {\\\"message\\\":\\\"Dispatch the next issue on the Board.\\\"}\"",
        "",
      ].join("\n"),
    );
    expect(bodies.speak).toMatchObject({ model: "kokoro", voice: "af_heart", response_format: "wav" });
    expect(bodies.speak.input).toBeString();
    expect(authorization).toBe("Bearer sk-test");
    expect(bodies.front).toMatchObject({ model: "deepseek-v4.1-flash", stream: false });
    expect(bodies.front.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["hand_off"]);
    expect(bodies.front.messages.at(-1).content).toContain("um");
    expect(bodies.front.messages[0].content).toContain("Board");
  });

  test("a missing key, an unreachable URL and an error answer each fail their service with help, and the rest still run", async () => {
    const { cli, configDir, world } = setup();
    writeVoice(configDir, {
      transcribe: { ...LOCAL.transcribe, keyEnv: "OPENAI_API_KEY" },
      speak: LOCAL.speak,
      front: { url: "https://api.openai.com/v1", model: "gpt-nope" },
    });
    world.endpoint("https://api.openai.com/v1/chat/completions", () =>
      Response.json({ error: { message: "The model `gpt-nope` does not exist" } }, { status: 404 }),
    );

    const { stdout, exitCode } = await cli("voice", "check");

    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "services[3]{service,status,url,model,error}:",
        "  transcribe,failed,\"http://127.0.0.1:8010/v1\",deepdml/faster-whisper-large-v3-turbo-ct2,OPENAI_API_KEY is not set",
        "  speak,failed,\"http://127.0.0.1:8880/v1\",kokoro,\"could not reach http://127.0.0.1:8880/v1/audio/speech: connection refused\"",
        "  front,failed,\"https://api.openai.com/v1\",gpt-nope,\"answered 404: The model `gpt-nope` does not exist\"",
        "help[3]:",
        "  Set OPENAI_API_KEY in the environment nico-agent runs in, or drop voice.transcribe.keyEnv for a service that needs no key",
        "  Start the speak service (see docs/voice.md) or fix voice.speak.url",
        "  Check voice.front.url and voice.front.model",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual(["http POST http://127.0.0.1:8880/v1/audio/speech", "http POST https://api.openai.com/v1/chat/completions"]);
  });

  test("--json gives a failed service's error and the help", async () => {
    const { cli, configDir } = setup();
    writeVoice(configDir, { speak: LOCAL.speak });

    const { json, exitCode } = await cli("voice", "check", "--json");

    expect(exitCode).toBe(1);
    expect(json()).toEqual({
      services: [
        { service: "transcribe", status: "not configured" },
        { service: "speak", status: "failed", url: LOCAL.speak.url, model: "kokoro", error: "could not reach http://127.0.0.1:8880/v1/audio/speech: connection refused" },
        GO_WITHOUT_KEY,
      ],
      help: ["Start the speak service (see docs/voice.md) or fix voice.speak.url", GO_KEY_HELP],
    });
  });

  test("without voice services in config, refuses with where to set them up", async () => {
    const { cli, world } = setup();

    const { stdout, exitCode } = await cli("voice", "check");

    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: no voice services in config",
        "help[1]:",
        "  See docs/voice.md to set up transcribe, speak and front under voice in config.json",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });
});

describe("voice config", () => {
  const cases: [string, unknown, string, string][] = [
    ["voice is not an object", ["transcribe"], "voice is not an object", "See docs/voice.md for the voice block"],
    ["an unknown service", { listen: LOCAL.transcribe }, "voice.listen is not a voice service", "Voice services: transcribe, speak, front"],
    ["the Scribe, which the Front voice replaced", { scribe: LOCAL.front }, "voice.scribe is gone: the Front voice replaces the Scribe", "Drop voice.scribe; the Front voice runs on opencode go unless voice.front says otherwise (see docs/voice.md)"],
    ["a service that isn't an object", { speak: "kokoro" }, "voice.speak is not an object", "See docs/voice.md for the voice block"],
    ["a missing url", { front: { model: "qwen2.5:3b" } }, "voice.front is missing url", "See docs/voice.md for the voice block"],
    ["a missing model", { front: { url: LOCAL.front.url } }, "voice.front is missing model", "See docs/voice.md for the voice block"],
    ["a url that isn't http", { transcribe: { ...LOCAL.transcribe, url: "127.0.0.1:8010" } }, "voice.transcribe.url is not an http(s) URL", "e.g. http://127.0.0.1:8880/v1"],
    ["a key that isn't a string", { front: { ...LOCAL.front, keyEnv: 42 } }, "voice.front.keyEnv is not a non-empty string", "See docs/voice.md for the voice block"],
    ["an unknown setting", { transcribe: { ...LOCAL.transcribe, voice: "af_heart" } }, "voice.transcribe.voice is not a transcribe setting", "transcribe settings: url, model, keyEnv"],
  ];

  for (const [name, voice, error, help] of cases) {
    test(`refuses ${name}, naming the key`, async () => {
      const { cli, configDir, world } = setup();
      writeVoice(configDir, voice);

      const { json, exitCode } = await cli("voice", "check", "--json");

      expect(exitCode).toBe(1);
      expect(json()).toEqual({ error: `${join(configDir, "config.json")}: ${error}`, help: [help] });
      expect(world.calls).toEqual([]);
    });
  }
});
