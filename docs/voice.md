# Voice: transcription, speech and the Front voice

Talking to the Lead takes three services, each an OpenAI-compatible HTTP
endpoint in `~/.config/nico-agent/config.json`:

- **transcribe** turns the user's audio into text (`POST /audio/transcriptions`).
- **speak** reads the Front voice's lines and the Lead's replies aloud with
  Voice on (`POST /audio/speech`).
- **front** is the Front voice's thinking (`POST /chat/completions`,
  streamed, with one tool): it answers what you said or hands it to the Lead;
  see **Front voice** in `GLOSSARY.md` and ADR-0013.

nico-agent runs none of them (ADR-0001). On this machine transcription and
speech are local services under systemd user units, so no audio leaves it;
the Front voice runs on opencode go, so the text of what you say does. Any of
the three moves elsewhere by changing its `url`, `model` and `keyEnv`.

## Config

```json
{
  "voice": {
    "transcribe": { "url": "http://127.0.0.1:8010/v1", "model": "Systran/faster-whisper-small.en" },
    "speak": { "url": "http://127.0.0.1:8880/v1", "model": "kokoro", "voice": "af_heart" },
    "front": { "url": "https://opencode.ai/zen/go/v1", "model": "deepseek-v4.1-flash", "keyEnv": "OPENCODE_API_KEY" }
  }
}
```

Leave `front` out to get exactly that block: the Front voice runs on opencode
go unless told otherwise, with the key of your opencode go subscription
(OpenCode Console) in `OPENCODE_API_KEY`. Any endpoint that streams
`/chat/completions` with tool calls will do; the models opencode go serves
there are its GLM, Kimi, DeepSeek and MiMo ones. The old `scribe` block is
refused: drop it.

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
uh next issue on the bored") to the Front voice, unstreamed, one service at a
time, and times each answer, the whole body included. The Front voice should
answer with its tool, `hand_off {"message":"Dispatch the next issue on the
Board."}`. A service left out of config shows as `not configured`, except the
Front voice, which is checked on opencode go. A missing key, an unreachable URL or an error answer fails
that service with what to fix, and the command exits 1.

## Talk in the app

The **Talk** button, beside the Lead panel's text field, records from the browser's microphone and
streams the audio to `serve` over a WebSocket (`/api/voice`, 16kHz 16-bit mono
PCM). `serve` sends it to `voice.transcribe` and shows what it heard as you
speak; the final transcript goes to the Front voice (below), which answers it
itself or sends it to the Lead as your message, cleaned, with the raw
transcript kept on the entry (`nico-agent say --raw <raw> -- <text>`). The
card shows the two side by side.

- **Hold** the button (or Space or Enter on it) to talk; release to send.
- **Tap** it to start a hands-free session (below): a pause of half a
  second once you finished a sentence sends it (two seconds while you are
  still thinking; see **Hearing speech** below), a second tap sends at once,
  and six seconds without speech drops it unsent. An utterance stops at one
  minute either way.

Every request carries a vocabulary hint as the transcription `prompt`, built
for each utterance: the terms each Repo's `GLOSSARY.md` defines (its
`**Term**:` lines), the Harness and Repo names, and every issue and Spec on
the Board by its identifier and title. Whisper reads only the last ~224
tokens of a prompt, so the Board comes last. The interim transcripts use the
last hint built rather than wait for the Board.

The final transcript is made before you finish, so it is ready almost as
soon as you stop. Once the audio has been quieter than any speech for about
a quarter of a second, `serve` transcribes everything you said, with this
utterance's hint and silence to make up the pause that ends a hands-free
utterance. When the utterance ends with nothing more said, that
transcript is the final one; when you talk again, it is only an interim, and
the whole utterance is transcribed at the end. An utterance's requests go one
at a time, and while you are quiet no other interim is asked for, since
requests to a local service on CPU at once only slow each other down.

A failure (no `voice.transcribe`, the service down or answering an error, the
microphone blocked) shows with the app's other warnings, above the
conversation; typing still works.

### Hands-free

A tap on **Talk**, or the key anywhere (below), starts a hands-free
session: the microphone stays open, between utterances as well, until you
end it. A walkthrough, with Voice on:

1. Press the key (or tap **Talk**). The strip above the composer reads
   **Listening**, with what it hears as you say "What is running?".
2. You stop talking; half a second later it is sent. **Thinking**:
   "Transcribing…", then, once the Lead has your message, "The Lead is
   working on it."
3. The Front voice says "I'll ask the Lead." as it hands your message on,
   and the Lead's answer follows. **Speaking**, with **Stop**. Small talk,
   or "say that again", the Front voice answers itself, at once.
4. You answer back, without touching anything: the microphone was
   listening the whole time. Talking over the Lead stops it (barge-in), as
   does talking while your last message is still being transcribed: either
   starts the next utterance from its first words.
5. When the Lead is done and nobody talks, the strip reads **Listening**:
   "Talk when you are ready.", with **End**; the talk button reads **End**
   too.

End the session with **End**, a tap on the talk button or the key, while
nobody talks; a tap or the key while you talk sends what you said, and while
the Lead speaks it stops the Lead (the talk button reads **Stop**); either
way the session goes on. A failure ends it too: the microphone, `serve` or
the transcription service, shown as a warning.

The microphone watches for a fifth of a second of unbroken speech all
through a session; a cough, a door or a knock is not speech, and starts
nothing. "Heard nothing; try again." shows when transcription hears nothing
in what was sent. Holding the button to talk is never a session: it sends
one utterance and stops, as does talking over the Lead outside a session.

### Hearing speech

The page tells speech from silence and noise itself, with two small models
that `serve` embeds and serves at `/voice/` (the page loads them, about 11MB
and onnxruntime-web's 14MB of WebAssembly, the first time it uses the
microphone):

- **[Silero VAD](https://github.com/snakers4/silero-vad)** (MIT) hears each
  32ms of audio and says how likely it is speech. Speech starts at 0.5 and
  goes on down to 0.35, so a word's quiet end stays in it; a fifth of a second
  of it starts an utterance, or talks over the Lead.
- **[Smart Turn v3](https://github.com/pipecat-ai/smart-turn)** (BSD-2) hears
  the utterance so far, from its tone and its words, and says whether you
  finished it. The page asks it 0.2s into each pause; it answers within the
  pause (about 0.3s). Said finished, the utterance ends at half a second of
  pause; not finished ("I can't seem to, um …"), it waits for more, up to two
  seconds of pause.

The half second is also why a pause mid-sentence of under half a second
(Kokoro's comma or colon in the fixture set) is never cut, however Smart
Turn judges it. When Smart Turn fails to answer, the half-second pause ends
the utterance as before. When the models cannot load, the microphone fails
with a warning, and typing still works.

The models are `src/app/models/silero-vad.onnx` (Silero VAD v5, from its
repo's `src/silero_vad/data/`) and `src/app/models/smart-turn-v3.2-cpu.onnx`
(the int8 model, from [`pipecat-ai/smart-turn-v3`](https://huggingface.co/pipecat-ai/smart-turn-v3)
on Hugging Face). Smart Turn hears Whisper's log-mel features of the last 8
seconds, which `src/app/hearing.ts` makes as its own Python code does;
`test/app-hearing.test.ts` checks them against that code's output, and plays
the fixture set and some noise through both models.

Without Voice on, a session works the same, and the Lead's replies only
show.

### A key anywhere

`nico-agent voice talk` asks `serve` (`--port`, 42069 by default) to press
the talk button of the app for you: `serve` sends a `listen` event on the
app's SSE stream to the page that connected to it last, and that page acts on it as a tap,
so the first press starts a hands-free session, a press while you talk sends
it, and a press while nobody talks ends the session. Bound to a key, it
starts talking to the Lead from any window.

With no page open it is refused (exit 1) with what to open; with `serve`
down, with how to start it.

The page needs the microphone allowed and, since it was loaded, one click or
key on it: browsers start audio only after a gesture on the page. Without
one, the page shows a warning asking for a click and stops listening.

Opening the app on the phone after the desktop makes the phone the page
that connected last, and so does a page reconnecting (after `serve`
restarts, or the phone waking); reload the desktop tab to bring the key back
to it. A page closed a moment ago may still count as open, so the key can
go unheard once.

On Hyprland, in `~/.config/hypr/hyprland.conf` (on Omarchy,
`~/.config/hypr/bindings.conf`):

```ini
# Talk to the Lead from anywhere; a notification says why when nothing listens.
bind = SUPER ALT, T, exec, nico-agent voice talk || notify-send "nico-agent" "No app is open to listen"
```

Hyprland runs it through `sh` with its own `PATH`; if `nico-agent` is not
found, write its full path (`~/.local/bin/nico-agent`). Reload with
`hyprctl reload`.

### The Front voice

The Front voice (`voice.front`, ADR-0013) hears the final transcript, as
heard, and reads, for context:

- the words to spell as written: the vocabulary the transcription had;
- the Lead's orient packet: its Intent and Notes, open questions and
  Proposals, and the conversation's last ten entries;
- the Board, as `board --json` prints it.

Its one tool is `hand_off`; it has no shell, no MCP and nothing that acts.
It answers small talk, "say that again" and what it can read itself, a
sentence at a time aloud as the reply streams in. Anything that needs
judgment, a decision or an action it hands off: it says "I'll ask the
Lead." and writes your message, cleaned (fillers out, terms spelled as
written, punctuation fixed), into the Conversation through the path
`say --raw` uses, so the Lead gets it in its Inbox with a Nudge.

Its own lines go in the Conversation under its own author, `front-voice`
in `lead log --json`; one it answered without the Lead keeps what you said
as `heard`. The Lead reads them in its orient packet, never in its Inbox,
and they never Nudge it. The panel shows them under **Front voice**.

Talk over it (or tap **Stop**) and it stops at once: its speech, and its
reply, whose request is dropped, so what you say next is heard without
waiting on it. What it said stays recorded; a hand-off it had begun is read
to its end, silently, and still reaches the Lead. "I'll ask the Lead." is
said the moment the hand-off is whole, not at the end of the reply.

When it is unreachable, its key is not set, it answers an error, or it
answers nothing, what you said goes to the Lead as heard, with a warning
above the composer: the conversation never waits on it.

Say (or type) "No, I said …" to correct your last message: the new entry
supersedes it (`supersedes` in `lead log --json`), the old card is struck,
and the Lead's Inbox hands it the correction with the text it replaces.

Said right after the Lead's question, with nothing but the Front voice's
lines between, what you say and the Front voice hands off is the answer to
it. For a question with choices, it is told the choices and names the one
your answer picks ("the second one", "the Linear one"), and the answer
recorded is that choice, with what was heard kept beside it; when it picks
none clearly, the answer is what you said, cleaned. Asking it "what were the
choices?" is answered by the Front voice and leaves the question open.

To measure an endpoint's time to first token on requests like the Front
voice's:

```bash
OPENCODE_API_KEY=… bun scripts/front-voice-ttft.ts [model …]
```

### The Lead speaks

With Voice on (`nico-agent voice on|off`, or the **Voice** switch in the Lead
panel's bar), each line of the Front voice's, and every reply and question the Lead writes, is read by
`voice.speak` and streamed to the app over the same `/api/voice` socket as it
is made, as 24kHz 16-bit mono PCM (`response_format: "pcm"`, OpenAI's format,
which Kokoro-FastAPI shares). A question is read with its choices as a
numbered list. With Voice on, the page keeps the socket open, and every open
page hears the Lead.

The Lead never talks over you or the Front voice. A reply or question it
writes while you are talking (from the moment the page starts an utterance)
or while the Front voice is answering what you said waits for the next
pause: it is read once the Front voice has finished, or handed off to the
Lead, after the Front voice's last line. One written while the Front voice's
lines are still being read follows them.

The Nudge carries it too: the Lead is prompted "Read your Inbox (voice on)",
then the local time, and its skill then talks for the ear: short sentences,
issues by title, choices left to the numbered list. It gives no
acknowledgment of its own: the Front voice already said it would ask the
Lead.

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
reply shows in the Lead panel as ever, with a warning above the conversation.

### Timing each step

`serve` logs every spoken message to `voice-timing.jsonl` in the config
directory (`~/.config/nico-agent/`), one JSON line each, to tell where the
wait between talking and hearing the Lead goes. A line has eight times, in
order:

| Field | When | Taken by |
| --- | --- | --- |
| `spoke` | you stopped talking: the release, the tap, or where the pause began | the page |
| `ended` | the page ended the utterance: at once on a release or a tap, after the pause (see **Hearing speech**) hands-free | `serve`, on hearing it |
| `transcribed` | `voice.transcribe` returned the final transcript | `serve` |
| `handed` | the Front voice handed it to the Lead (cleaned, and its choice, answering a question) | `serve` |
| `written` | the message's entry was written to the conversation | the entry's `at` |
| `nudged` | herdr took the Nudge: the first one sent after the entry, whatever sent it | `nudges-sent.json` |
| `said` | the Lead wrote its first `say` or `ask` after the entry, whatever it answers | that entry's `at` |
| `played` | the page began playing that entry's audio: speech made, and any earlier speech played out | the page |

Each is an ISO time, or `null` for a step that did not happen: the Front
voice failed and it was sent as heard (`handed`), the Lead not running
(`nudged`), Voice off (`played`), or the transcription failing (all after
`ended`). A step that did not happen leaves its time to the next: with the
Front voice failing, its wait shows in `written`. A message the Front voice
answers itself is logged at once, with no step after `transcribed`; lines
logged before the Front voice name the step `scribed`. `took` is
how long each step took after the last one that happened, in ms; `total` is
`spoke` to `played`; `slowest` names the step with the longest `took`. The
page and `serve` share a clock, being on one machine (on the phone the
phone's clock takes `spoke` and `played`, so `ended` is off by the
difference between the clocks).

A line is written once the page plays the Lead's reply; with Voice off, once
the Lead first says something; for a failed or empty transcript, at once;
and otherwise after five minutes, with what happened by then. `utterance` is
the page's number for it and `text` what was sent. A typed message is not
logged.

```bash
tail -n 20 ~/.config/nico-agent/voice-timing.jsonl | jq -c '{text, took, total, slowest}'
# The median of each step over the log:
jq -s 'def median: sort | .[length/2|floor]; [.[].took] as $t
  | ($t[0] | keys_unsorted) | map({(.): ([$t[][.] // empty] | median)}) | add' ~/.config/nico-agent/voice-timing.jsonl
```

### The fixture set

`test/fixtures/scribe/` holds twenty utterances to the Lead with Board
vocabulary, voiced by Kokoro, and each one's raw transcript and cleanup
(the Scribe's, recorded before the Front voice replaced it). To try another
model or prompt, rerun them through the services in
`config.json` (or the local ones below) and read the table it prints:

```bash
bun scripts/scribe-fixtures.ts           # transcribe each WAV again and hand it to the Front voice
bun scripts/scribe-fixtures.ts --speak   # voice them again first
```

With `Systran/faster-whisper-small.en` and `qwen2.5:3b` on the CPU, in 2
to 3s each with transcription, the Scribe answered or invented nothing and
kept every sentence. It fixed issues said aloud ("acme API 15" to
`acme/api#15`) more often than not, but left some as heard ("ACME API 7"),
spelled one wrong ("acme/web3"), and kept an "Um" once.

### On the phone

Safari only allows the microphone over HTTPS. `serve` listens on 127.0.0.1
over plain HTTP; `tailscale serve` publishes it to your tailnet over HTTPS,
with a valid certificate for the machine's tailnet name:

```bash
tailscale serve --bg 42069     # https://<machine>.<tailnet>.ts.net/ → http://127.0.0.1:42069
tailscale serve status         # what is published
tailscale serve reset          # stop publishing (all of this machine's serve config)
```

Then open `https://<machine>.<tailnet>.ts.net/` on the iPhone. The page and
its WebSocket go through the same address; iOS stops capture when the screen
locks.

- **Tailnet only.** `tailscale serve` is reachable from devices on your
  tailnet, as its ACLs allow, and never from the internet. Never use
  `tailscale funnel` for it: that publishes it to the internet, and `serve`
  has no login.
- **Every path is exposed**, as on 127.0.0.1: `/` (the app and its
  assets), `/api/*` (the Board and its actions, `say`, Voice on and off,
  `/api/voice/talk`), `/api/events` (the SSE stream), `/api/voice` (the
  WebSocket: your audio and the Lead's speech), `/preview` (issue cards),
  and `/mcp` (the Lead's tools). Any device on the tailnet can act on the
  Board as the app does.
- **HTTPS** ends at Tailscale on this machine, which proxies to `serve` over
  loopback.

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

### ollama (a local Front voice, optional)

ollama ships an OpenAI-compatible API under `/v1`, tool calls included, and
can serve `voice.front` without opencode go: `{ "url":
"http://127.0.0.1:11434/v1", "model": "qwen2.5:3b" }`. A 3B model on the CPU
is slow and weak at choosing when to hand off; it was the Scribe's.

The `ollama` package's system unit is disabled here; a user unit runs it as
you, with your models in `~/.ollama`.

`~/.config/systemd/user/ollama.service`:

```ini
[Unit]
Description=ollama: OpenAI-compatible chat on 127.0.0.1:11434

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

Measured as the Scribe: 0.8 to 3s for a cleanup, on the CPU (the `ollama` package has no
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
with large-v3-turbo on int8, before the Front voice replaced the Scribe:

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
| front      | `https://opencode.ai/zen/go/v1` | the default: `deepseek-v4.1-flash`, or `glm-5.3-flash`, `mimo-v2.6-flash`, `kimi-k2.6` | `OPENCODE_API_KEY` |
| front      | `https://api.openai.com/v1`    | a small model, e.g. `gpt-4o-mini`           | `OPENAI_API_KEY`    | A cloud service sends the audio or the text off this machine.
