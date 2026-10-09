# Voice: transcription, speech and the Scribe

Talking to the Lead takes three services, each an OpenAI-compatible HTTP
endpoint in `~/.config/nico-agent/config.json`:

- **transcribe** turns the user's audio into text (`POST /audio/transcriptions`).
- **speak** reads the Lead's replies aloud with Voice on (`POST /audio/speech`).
- **scribe** cleans the raw transcript before the Lead reads it
  (`POST /chat/completions`); see **Scribe** in `GLOSSARY.md`.

nico-agent runs none of them (ADR-0001). On this machine they are local
services under systemd user units, so no audio leaves it; any of the three
moves to a cloud service by changing its `url`, `model` and `keyEnv`.

## Config

```json
{
  "voice": {
    "transcribe": { "url": "http://127.0.0.1:8010/v1", "model": "Systran/faster-whisper-small.en" },
    "speak": { "url": "http://127.0.0.1:8880/v1", "model": "kokoro", "voice": "af_heart" },
    "scribe": { "url": "http://127.0.0.1:11434/v1", "model": "qwen2.5:3b" }
  }
}
```

Each service takes:

- `url`: the base URL, up to and including `/v1`; nico-agent appends the
  path. Required.
- `model`: the model the service runs. Required.
- `keyEnv`: the name of the environment variable that holds the API key,
  sent as `Authorization: Bearer <key>`. Leave it out for a local service
  that needs no key. The key itself never goes in config.
- `voice` (speak only): the voice to read in; `alloy` when unset.

A malformed block (unknown service or setting, missing `url` or `model`, a
`url` that isn't http(s)) is refused by every command, naming the key.

## Check it

```bash
nico-agent voice check          # each service: ok or failed, latency, what it returned
nico-agent voice check --json
```

It sends a 2.5-second WAV of "Dispatch the next issue on the Board." to
transcription, a sentence to speech, and a messy transcript ("um dispatch the
uh next issue on the bored") to the Scribe, one service at a time, and times
each answer, the whole body included. A service left out of config shows as
`not configured`. A missing key, an unreachable URL or an error answer fails
that service with what to fix, and the command exits 1.

## Talk in the app

The Lead panel's **Talk** button records from the browser's microphone and
streams the audio to `serve` over a WebSocket (`/api/voice`, 16kHz 16-bit mono
PCM). `serve` sends it to `voice.transcribe` and shows what it heard as you
speak; the final transcript goes through the Scribe, and its text is sent to
the Lead as your message at once, with the raw transcript kept on the entry
(`nico-agent say --raw <raw> -- <text>`). The card shows the two side by side.

- **Hold** the button (or Space or Enter on it) to talk; release to send.
- **Tap** it to talk hands-free: a pause of about a second after you spoke
  sends it, a second tap sends at once, and six seconds of silence gives up.
  An utterance stops at one minute either way.

Every request carries a vocabulary hint as the transcription `prompt`, built
for each utterance: the terms each Repo's `GLOSSARY.md` defines (its
`**Term**:` lines), the Harness and Repo names, and every issue and Spec on
the Board by its identifier and title. Whisper reads only the last ~224
tokens of a prompt, so the Board comes last. The interim transcripts use the
last hint built rather than wait for the Board.

A failure (no `voice.transcribe`, the service down or answering an error, the
microphone blocked) shows as a warning above the composer; typing still works.

### The Scribe

The Scribe (`voice.scribe`) gets the final transcript with the same
vocabulary, all of it, and the conversation's last four entries, for
context. It is told to drop fillers, spell the vocabulary's terms as written,
fix punctuation, and change nothing else; a few generic examples go with it,
because a small model given only rules answers the question it was dictated
or repeats its prompt. An answer much longer than what was heard is refused
for the same reason.

When the Scribe is not configured, unreachable, answers an error, or is
refused, the raw transcript is sent as it is, with a warning above the
composer: the conversation never waits on it.

Say (or type) "No, I said …" to correct your last message: the new entry
supersedes it (`supersedes` in `lead log --json`), the old card is struck,
and the Lead's Inbox hands it the correction with the text it replaces.

Said right after the Lead's question, before anything else is said, what you
say is the answer to it. For a question with choices, the Scribe is asked
which choice it picks ("the second one", "the Linear one"), and the answer
recorded is that choice, with what was heard kept beside it; when it picks
none clearly, or there is no Scribe, the answer is what you said.

### The Lead speaks

With Voice on (`nico-agent voice on|off`, or the **Voice** switch in the Lead
panel's head), every reply and question the Lead writes is read by
`voice.speak` and streamed to the app over the same `/api/voice` socket as it
is made, as 24kHz 16-bit mono PCM (`response_format: "pcm"`, OpenAI's format,
which Kokoro-FastAPI shares). A question is read with its choices as a
numbered list. With Voice on, the page keeps the socket open, and every open
page hears the Lead.

The Nudge carries it too: the Lead is prompted "Read your Inbox (voice on)",
and its skill then talks for the ear: an acknowledgment before a slow answer,
short sentences, issues by title, choices left to the numbered list.

The Lead stops at once, and what it had still to say is dropped, when:

- you press **Talk**, or **Stop** beside "The Lead is speaking";
- you start talking over it: while it speaks, the page watches the
  microphone (only once you have allowed it for the page, so it never asks),
  and a fifth of a second of unbroken voice stops the Lead and starts a
  hands-free utterance from those first words.

The browser's echo cancellation keeps the Lead's own voice out of the
microphone; on loud speakers it may still leak and stop the Lead. Headphones
avoid it. Safari cannot tell the page whether the microphone is allowed, so
on the iPhone a tap stops the Lead.

A browser plays audio only after a gesture on the page: with Voice on from
the start, the first click or key on the page lets the Lead be heard.

When `voice.speak` is not configured, unreachable or answers an error, the
reply shows in the panel as ever, with a warning above the composer.

### The fixture set

`test/fixtures/scribe/` holds twenty utterances to the Lead with Board
vocabulary, voiced by Kokoro, and each one's raw transcript and Scribe
cleanup. To try another model or prompt, rerun them through the services in
`config.json` (or the local ones below) and read the table it prints:

```bash
bun scripts/scribe-fixtures.ts           # transcribe and clean each WAV again
bun scripts/scribe-fixtures.ts --speak   # voice them again first
```

With `Systran/faster-whisper-small.en` and `qwen2.5:3b` on the CPU, in 2
to 3s each with transcription, the Scribe answered or invented nothing and
kept every sentence. It fixed issues said aloud ("acme API 15" to
`acme/api#15`) more often than not, but left some as heard ("ACME API 7"),
spelled one wrong ("acme/web3"), and kept an "Um" once.

### On the phone

Safari only allows the microphone over HTTPS. Publish `serve` to your tailnet
with `tailscale serve`, which gives it a valid certificate:

```bash
tailscale serve --bg 42069
```

Then open `https://<machine>.<tailnet>.ts.net/` on the iPhone. The page and
its WebSocket go through the same address; iOS stops capture when the screen
locks.

## Local setup on this machine

This is an AMD Ryzen 9 7940HS with an RX 7600 (Navi 33) and a 780M, on Arch.
Port 8000 is taken by `workspace-mcp`, so speaches listens on 8010.

### speaches (Whisper)

[speaches](https://github.com/speaches-ai/speaches) serves faster-whisper
behind the OpenAI transcription API. It runs on CTranslate2, which has no ROCm
build, so it runs on the CPU here. int8 with 8 threads, and keeping the model
loaded (`WHISPER__TTL=-1`), roughly halves the default's latency.

```bash
docker pull ghcr.io/speaches-ai/speaches:latest-cpu
```

`~/.config/systemd/user/speaches.service`:

```ini
[Unit]
Description=speaches: OpenAI-compatible Whisper transcription on 127.0.0.1:8010

[Service]
ExecStartPre=-/usr/bin/docker rm -f speaches
ExecStart=/usr/bin/docker run --rm --name speaches \
  -p 127.0.0.1:8010:8000 \
  -v speaches-hf-cache:/home/ubuntu/.cache/huggingface/hub \
  -e WHISPER__COMPUTE_TYPE=int8 -e WHISPER__CPU_THREADS=8 -e WHISPER__TTL=-1 \
  ghcr.io/speaches-ai/speaches:latest-cpu
ExecStop=/usr/bin/docker stop speaches
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Once it runs, download the model into its cache volume (once):

```bash
curl -X POST http://127.0.0.1:8010/v1/models/deepdml/faster-whisper-large-v3-turbo-ct2
```

Measured on the sample: large-v3-turbo answers in 7 to 10s (15 to 20s with
the defaults), which is too slow for a conversation. `Systran/faster-whisper-small.en`
transcribes the same sample with the same words in about 1.2s, with the app's
full vocabulary hint too; download it the same way and set it as
`voice.transcribe.model` while there is no GPU path.

Avoid the distilled models (`Systran/faster-distil-whisper-small.en` and
kin) for the app: they are as fast, but past about thirty words of prompt
they lose the speech ("Dispatch the next issue on the board." came back as
"This,"), and the app's prompt is longer than that.

### Kokoro-FastAPI (speech)

[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) serves Kokoro
behind the OpenAI speech API, with its model in the image. `voice` takes any
id from `curl http://127.0.0.1:8880/v1/audio/voices`.

```bash
docker pull ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

`~/.config/systemd/user/kokoro.service`:

```ini
[Unit]
Description=Kokoro-FastAPI: OpenAI-compatible text-to-speech on 127.0.0.1:8880

[Service]
ExecStartPre=-/usr/bin/docker rm -f kokoro
ExecStart=/usr/bin/docker run --rm --name kokoro \
  -p 127.0.0.1:8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-cpu:latest
ExecStop=/usr/bin/docker stop kokoro
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Measured: 0.3 to 0.5s for a short sentence, the whole WAV read.

### ollama (the Scribe)

ollama ships an OpenAI-compatible API under `/v1`. The `ollama` package's
system unit is disabled here; a user unit runs it as you, with your models in
`~/.ollama`.

`~/.config/systemd/user/ollama.service`:

```ini
[Unit]
Description=ollama: OpenAI-compatible chat for the Scribe on 127.0.0.1:11434

[Service]
ExecStart=/usr/bin/ollama serve
Environment=OLLAMA_HOST=127.0.0.1:11434
Environment=OLLAMA_KEEP_ALIVE=30m
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
ollama pull qwen2.5:3b
```

Measured: 0.8 to 3s for the cleanup, on the CPU (the `ollama` package has no
GPU backend). For the RX 7600, `pacman -S ollama-rocm` instead; Navi 33
(gfx1102) may need `Environment=HSA_OVERRIDE_GFX_VERSION=11.0.0`.

### Start them

```bash
systemctl --user daemon-reload
systemctl --user enable --now speaches kokoro ollama
systemctl --user status speaches kokoro ollama
journalctl --user -u speaches -f
nico-agent voice check
```

Put the config block above in `config.json`. What `voice check` printed here,
with large-v3-turbo on int8:

```
services[3]{service,status,url,model,ms,returned}:
  transcribe,ok,"http://127.0.0.1:8010/v1",deepdml/faster-whisper-large-v3-turbo-ct2,7013,Dispatch the next issue on the board.
  speak,ok,"http://127.0.0.1:8880/v1",kokoro,336,90284 bytes of audio/wav
  scribe,ok,"http://127.0.0.1:11434/v1","qwen2.5:3b",2878,Dispatch the next issue on the Board.
```

## Cloud alternatives

Change the service's block; set the key in the environment `nico-agent serve`
runs in (for the Board service, its unit's `Environment=` or an
`EnvironmentFile=`).

| Service    | url                            | model                                       | keyEnv              |
| ---------- | ------------------------------ | ------------------------------------------- | ------------------- |
| transcribe | `https://api.openai.com/v1`    | `gpt-4o-mini-transcribe` or `whisper-1`     | `OPENAI_API_KEY`    |
| transcribe | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo`                  | `GROQ_API_KEY`      |
| speak      | `https://api.openai.com/v1`    | `gpt-4o-mini-tts` (`voice`: e.g. `alloy`)   | `OPENAI_API_KEY`    |
| scribe     | `https://api.anthropic.com/v1` | a Haiku model, e.g. `claude-haiku-5-5`      | `ANTHROPIC_API_KEY` |
| scribe     | `https://api.openai.com/v1`    | a small model, e.g. `gpt-4o-mini`           | `OPENAI_API_KEY`    |

Anthropic models reach the Scribe through Anthropic's OpenAI-compatible
endpoint. A cloud service sends the audio or the text off this machine.
