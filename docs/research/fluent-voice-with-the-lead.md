# A fluent voice conversation with the Lead

Researched on 2026-10-09 for [issue #158](https://github.com/nicolasLuduena/nico-agent/issues/158),
alongside [#131](https://github.com/nicolasLuduena/nico-agent/issues/131) (the delay is still
unmeasured). These are findings and a proposal, not a change to the app.

The sources are this repo's code (paths at commit `8d60d8c`) and the first-party docs and
repositories linked inline, read on the date above. Prices are list prices. They change often,
and several vendors marked theirs as promotional or preview.

## Summary

- **Most of the wait is the Lead's turn, and nothing measures it yet.** Before the Lead says
  anything, a spoken message goes through about 0.8s of end-of-speech pause, about 1.2s of
  transcription, and 0.8 to 3s of Scribe. Then comes a Nudge, which waits up to 10s more
  whenever the Lead is busy. Last is a full harness turn: at least an `inbox` call and a `say`
  call before the acknowledgment.
- **Build a front voice in `serve`.** It is a chained pipeline: streaming speech-to-text, a fast
  small LLM that may only talk, read and hand off, and streamed speech. It sits in front of the
  unchanged Lead. It replaces the Scribe, answers chat itself, and passes anything that needs
  judgment or action to the Lead as the user's message. The audio can stay local, and it keeps
  the OpenAI-compatible endpoints in `docs/voice.md`.
- **OpenAI's GPT-Live, with client delegation, is the same design as a hosted service.** It
  costs $3.00 per hour and sends the audio to OpenAI. It is worth a cloud mode later, not a
  first build.
- **Cost per hour of talking**, not counting the Lead, which costs what it costs today:
  - about $0 fully local;
  - about $1 with a cloud front (Deepgram Flux, Claude Haiku 5.5 and Deepgram Aura-2);
  - $3.00 with GPT-Live;
  - about $1 to $3 at best with OpenAI Realtime, rising with session length.

## 1. Where the time goes today (#131)

The path of a spoken message, from the code:

| Step | Where | Time | Source |
| --- | --- | --- | --- |
| End-of-speech pause | `PAUSE_MS = 800` after speech is heard (`MIN_SPEECH_MS = 200`) | 0.8s | `src/app/talk.ts:129-168` |
| Final transcription | Waits for `end`, then transcribes **the whole utterance** again. Interims run separately, at most one second of audio apart, and are thrown away. | ~1.2s (small.en, CPU) | `src/transcription.ts` (`ask(utterance, "final")`), `docs/voice.md` "speaches" |
| Scribe | Runs after transcription, one step after the other | 0.8 to 3s (qwen2.5:3b, CPU) | `src/transcription.ts` `clean`, `docs/voice.md` "ollama" |
| Choice match | A second Scribe call, only when the message answers a question with choices | not measured | `src/transcription.ts` `answering` → `choose` |
| Nudge | Sent at once if herdr reports the Lead `idle`/`done`. Otherwise it is left pending, and `serve` retries **every 10s**. | 0 to 10s | `src/nudge.ts` (`NUDGE_INTERVAL_MS = 10_000`, `READY`) |
| Lead turn to first `say` | The skill calls `inbox` first, then `say`s the acknowledgment. That is at least two model round trips in a coding-agent harness. | not measured | `src/lead-skill.md` "Voice on" |
| Speech | Each Lead entry goes to `/audio/speech` as one request and plays as it streams | 0.3 to 0.5s for a short sentence (Kokoro, CPU, whole WAV) | `src/speech.ts`, `docs/voice.md` "Kokoro-FastAPI" |

Before the Lead's turn starts, about 3 to 5s have already passed even when it is idle. When it
is busy, add up to 10s for the Nudge. Then add the turn itself, which nobody has timed and which
is the only step that grows with the Lead's model and context. #131's first task, timestamping
each step, is still the first ticket. The table only sets the order in which to look at things.

What is worth cutting, roughly in order of payoff:

1. **The Lead's turn on the conversational path.** Chat should not need a coding agent's turn at
   all. That is the front voice below.
2. **The Nudge's 10s poll.** A message that arrives while the Lead is busy waits for the next
   tick. `serve` could Nudge as soon as herdr reports the Lead idle, or poll more often while a
   user message is pending. The fix is small, and it is independent of everything else here.
3. **The final transcription redoing work.** With streaming speech-to-text, the transcript is
   already there when speech ends, so this step becomes about 0s.
4. **The Scribe as a separate step.** A front LLM that reads the raw transcript takes over its
   job.
5. **The pause.** 800ms is already at the top of Google's recommended range (below). A semantic
   turn detector would let it drop safely, without cutting people off.

## 2. Architectures

### A. Stream the current pipeline (no front agent)

Keep every message going to the Lead, and shave each step: streaming STT, no Scribe, an
immediate Nudge, sentence-by-sentence TTS. This is cheap, and it changes no roles. It cannot fix
the main cost, though: every reply is still a full Lead turn. "Hm, what was that issue called?"
still costs a coding agent's turn. Do these steps anyway, because the front voice reuses them.

### B. A fast front voice that hands off to the Lead (chained STT → small LLM → TTS)

A new component in `serve` holds the spoken conversation:

- **Input:** streaming transcripts of the user, with the vocabulary hint, plus read-only
  context: the last conversation entries, the Lead's `orient`, and a Board snapshot.
- **What it may do:** answer conversationally, re-read what the Lead said ("say that again", "the
  second one?"), say "I'll ask the Lead", and **hand off**. A hand-off writes the user's message,
  cleaned, into the conversation through the path `say --raw` already uses. The Lead gets it in
  its Inbox and a Nudge, unchanged.
- **What it may not do:** anything the Lead's MCP tools do. It gets no shell and no MCP. nico-agent
  gives it exactly two tools, a read and a hand-off, so ADR-0010 still holds by construction: only
  the Lead acts, within the Standing orders. The front voice can't do anything else even by
  mistake.
- **Output:** the Lead's `say`/`ask` entries are still read aloud as they arrive (`src/speech.ts`).
  The front voice's own lines are spoken the same way. They are recorded in the conversation as a
  distinct author, so the Lead sees them in `orient`.

OpenAI documents this split as a first-class option. Its chained pipeline lets you "store
transcripts, run policy checks before the agent responds, and generate speech only after an
approved answer", at the price of "more stages to build and operate"
([Voice agents guide](https://developers.openai.com/api/docs/guides/voice-agents)). Every stage
is one of the three OpenAI-compatible endpoints nico-agent already speaks, plus streaming on
`/chat/completions`.

### C. Speech-to-speech (realtime) model as the front voice

One cloud model listens and speaks, and calls a hand-off function to reach the Lead.

- **OpenAI Realtime** (`gpt-realtime-2.1`, `-mini`). It connects over WebRTC in the browser or a
  WebSocket from a server. It recommends keeping "tool execution and session control on your
  server" ([Realtime guide](https://developers.openai.com/api/docs/guides/realtime)). Turn
  detection is `server_vad` (silence-based, the default) or `semantic_vad`, a classifier that
  "waits longer when the completion probability is low", with `eagerness` `low`/`medium`/`high`.
  Barge-in is `interrupt_response`
  ([VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad)).
- **OpenAI GPT-Live** (`gpt-live-1`). It is full duplex: it "can listen while speaking". It is
  built to delegate "reasoning and tool use to a separate backend", and users "can keep talking
  while backend work runs" ([Voice agents](https://developers.openai.com/api/docs/guides/voice-agents),
  [GPT-Live](https://developers.openai.com/api/docs/guides/live)). In **client delegation**
  (`delegation: {"type": "client"}`), the flow is:
  - GPT-Live sends `session.delegation.created` with a `delegation.id`, but without the request
    itself. Your app rebuilds the request from `session.input_transcript.delta`.
  - Your app runs any backend and answers with `session.commentary.append` (spoken, paraphrased)
    or `session.thinking.append` (quiet context), each up to 500 tokens.
  - Interrupting the conversation "does not stop backend work". The docs say "Enforce action
    blocks in application state", since instructions alone don't block anything
    ([Delegation](https://developers.openai.com/api/docs/guides/live-delegation)).

  This is architecture B, hosted. The Lead would be the client backend: a hand-off becomes the
  user's message, and the Lead's `say` becomes `session.commentary.append`.
- **Gemini Live API** (`gemini-3.8-live`, `gemini-3.1-flash-live-preview` and others). It runs
  over a stateful WebSocket, with 16kHz PCM in and 24kHz PCM out
  ([Live API](https://ai.google.dev/gemini-api/docs/live)), the same rates as `/api/voice` today
  (`src/app/talk.ts`, `src/voice.ts`).
  - **Function calls:** `NON_BLOCKING` functions run asynchronously. Their responses can be
    scheduled `INTERRUPT`, `WHEN_IDLE` or `SILENT`. However, "Asynchronous function calling is not
    yet supported in Gemini 3.1 Flash Live"
    ([Tools](https://ai.google.dev/gemini-api/docs/live-tools)). The page doesn't say which mode
    3.8 supports.
  - **Session limits:** audio sessions are "limited to 15 minutes" without context compression,
    and connections last about 10 minutes, unless session resumption is used
    ([Sessions](https://ai.google.dev/gemini-api/docs/live-session)).

**Trade-offs against B:**

- **What it does better:** the best turn-taking available, with full duplex and semantic VAD
  built in.
- **What it costs:** the audio always leaves the machine. It replaces the OpenAI-compatible
  endpoints with a new stateful protocol. It is a second conversational model whose context
  nico-agent must feed and keep in sync with the Lead's.
- **Local option:** speaches has an OpenAI-compatible Realtime API. However, `response.cancel` and
  `conversation.item.truncate` are not supported, its interruption handling "needs to be flushed
  out", and "Real-time performance can only be achieved when using CUDA"
  ([speaches Realtime API](https://speaches.ai/usage/realtime-api/)). This machine's GPU is AMD
  (`docs/voice.md`), so that rules it out here.

### Keeping context, and keeping roles apart

In both B and C, the conversation file in the config directory stays the one record
(ADR-0010, "its state lives in nico-agent"). The front voice reads it and writes to it. It is
never the source of truth. The Lead keeps its Inbox, its `orient` and its cursor exactly as
today. What protects ADR-0010 is not a prompt (GPT-Live's docs say outright that instructions
don't block actions). It is that the front voice has no tool that acts.

## 3. Candidate services and models

| Role | Service / model | Latency (first-party) | Cost | Audio local? | Fits `docs/voice.md` endpoints? |
| --- | --- | --- | --- | --- | --- |
| Speech-to-speech | OpenAI `gpt-live-1` | none published; the docs say to measure p50/p95 | $0.05/min, billed per second; backend separate ([model](https://developers.openai.com/api/docs/models/gpt-live-1)) | no | no (WebRTC/WebSocket events) |
| Speech-to-speech | OpenAI `gpt-realtime-2.1` / `-2.1-mini` | none published | audio $32 in / $64 out per MTok (mini $10 / $20); cached $0.40 (mini $0.30) ([pricing](https://developers.openai.com/api/docs/pricing)) | no | no |
| Speech-to-speech | Google `gemini-3.8-live` | none published | audio $0.005/min in, $0.018/min out ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) | no | no |
| Speech-to-speech | Kyutai Moshi (local, 7B) | "practical overall latency as low as 200ms on an L4 GPU" ([repo](https://github.com/kyutai-labs/moshi)) | free | yes | no; also it is its own dialogue model, with no hand-off |
| Streaming STT + turns | Deepgram Flux `flux-general-en` | "~260ms end-of-turn detection" ([Flux](https://developers.deepgram.com/docs/flux/quickstart)) | $0.0065/min (promotional) ([pricing](https://deepgram.com/pricing)) | no | no (`wss://…/v2/listen`) |
| Streaming STT | OpenAI `gpt-live-transcribe` / `gpt-realtime-whisper` | none published | $0.017/min | no | no (Realtime transcription session) |
| Batch STT | OpenAI `gpt-4o-mini-transcribe` | none published | $0.003/min | no | yes (`/audio/transcriptions`) |
| STT, local | speaches (faster-whisper), in use today | 1.2s for the 2.5s sample with small.en on CPU (`docs/voice.md`); it can stream transcripts over SSE ([repo](https://github.com/speaches-ai/speaches)) | free | yes | yes |
| STT+TTS, local | Kyutai Unmute | about 450 to 750ms TTS latency; needs "a GPU with CUDA support and at least 16 GB VRAM" ([repo](https://github.com/kyutai-labs/unmute)) | free | yes | no; and no CUDA here |
| TTS | ElevenLabs `eleven_flash_v2_5` | "~75 ms" model latency, without network ([models](https://elevenlabs.io/docs/models)) | no per-character price on that page | no | no (own API) |
| TTS | Deepgram Aura-2 | none on the pricing page | $0.030 per 1k characters | no | no |
| TTS | OpenAI `gpt-4o-mini-tts` | none published | $12/MTok audio out | no | yes (`/audio/speech`) |
| TTS, local | Kokoro-FastAPI, in use today | measured 0.3 to 0.5s for a short sentence on CPU (`docs/voice.md`); README: first token "~300ms (GPU)", "~3500ms (CPU) … (older i7)" ([repo](https://github.com/remsky/Kokoro-FastAPI)) | free | yes | yes |
| Front LLM | Claude Haiku 5.5 `claude-haiku-5-5` | "Fastest" in the lineup; text and images in, text out, no audio ([models](https://platform.claude.com/docs/en/about-claude/models/overview)) | $0.10 in / $0.50 out per MTok, cache read $0.01, for prompts up to 100k tokens ([Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)) | no | yes (`/chat/completions`, through Anthropic's OpenAI-compatible endpoint, as the Scribe already uses) |
| Front LLM | OpenAI `gpt-6-luna` / `gpt-5-nano` | none published | $0.10 / $0.50 and $0.05 / $0.40 per MTok | no | yes |
| Front LLM | Gemini `gemini-2.5-flash-lite` | none published | $0.10 / $0.40 per MTok | no | yes, via Google's OpenAI-compatible endpoint |
| Front LLM, local | ollama, `qwen2.5:3b` or similar, in use as the Scribe | 0.8 to 3s on CPU for the cleanup (`docs/voice.md`); the RX 7600 needs `ollama-rocm` | free | yes | yes |

Anthropic has no speech API: all current Claude models take text and images and output text
([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)). Claude can
be the front LLM in B, but never a speech-to-speech model.

`docs/voice.md` lists Groq as a cloud alternative. Its pricing page had no prices or model IDs
when this was written ([groq.com/pricing](https://groq.com/pricing)), so it is left out here.

## 4. Turn-taking

**End of speech.** Today the app ends a turn after 800ms of quiet, measured by loudness alone
(`src/app/talk.ts`). The options:

- **Google's guidance** is 500 to 800ms. Its server's "internal default is approximately 800ms".
  It warns that 100 to 200ms "split utterances into fragments" and that a client-side detector
  should use "at least 500ms"
  ([Live guide](https://ai.google.dev/gemini-api/docs/live-guide)).
- **Silero VAD** (local) processes a 30ms chunk in "less than 1ms" on one CPU thread. It has a
  browser build on ONNX Runtime Web ([repo](https://github.com/snakers4/silero-vad)). It would
  replace the loudness rule, which currently starts an utterance on a cough or a door
  (`docs/voice.md`).
- **Smart Turn v3** (local, BSD-2) is an audio-native turn model. It runs "in as little as 10ms on
  some CPUs" and is meant to run only during silences that Silero detects
  ([repo](https://github.com/pipecat-ai/smart-turn)). It lets the pause drop toward 500ms without
  cutting off "I can't seem to, um …".
- **Deepgram Flux** (cloud) does the same in the STT stream:
  - `EndOfTurn` fires at `eot_threshold` (0.7 by default), and `eot_timeout_ms` (5000 by default)
    forces one.
  - `EagerEndOfTurn` lets the LLM start a draft early, and `TurnResumed` cancels it. The docs warn
    this costs "50-70%" more LLM calls
    ([Flux](https://developers.deepgram.com/docs/flux/quickstart)).

**Barge-in.** The app already hushes the Lead when the user talks over it (`src/speech.ts` `hush`).
The front voice needs the same, extended upstream: talking over it cancels its streaming LLM
response and its TTS. Hand-offs are never cancelled. The Realtime APIs behave the same way. OpenAI
has `interrupt_response`. Gemini discards an interrupted generation, so "Only information already
sent to the client stays in session history", and drops pending function calls
([Live guide](https://ai.google.dev/gemini-api/docs/live-guide)). GPT-Live keeps backend work
running after an interruption.

**"I'll ask the Lead", and the answer later.**

1. On a hand-off, the front voice says one short line right away ("I'll ask the Lead."). That
   replaces the Lead's own Voice-on acknowledgment, which can then leave its skill.
2. The conversation goes on, and the front voice can keep chatting meanwhile.
3. When the Lead's `say` arrives, it is spoken at the next gap: never over the user, and never
   cutting off the front voice mid-sentence. That is Gemini's `WHEN_IDLE`, and GPT-Live's
   "commentary" spoken when coherent.
4. An `ask` with choices is read with its numbered list, as today. The front voice matches the
   spoken answer to a choice, which is the Scribe's `choose` job today.

## 5. Recommendation

**Build B, the chained front voice, local-first with cloud parts behind config.** It is the only
option that:

- keeps the audio on this machine;
- keeps the three OpenAI-compatible endpoints, adding only streaming;
- leaves the Lead, its skill, the Inbox and ADR-0010 untouched, except that the front voice
  writes the user's messages.

Every part has a cloud swap in the same config shape (`url`, `model`, `keyEnv`). GPT-Live's
client delegation maps onto the same hand-off seam, so it can be added later as an alternative
front voice without changing the Lead side.

### Candidate tickets, in order

1. **Measure each step (#131).** Log one line per utterance with timestamps for: end of speech,
   final transcript, Scribe text, entry written, Nudge sent, the Lead's first `say`, and first
   audio played. Do this before anything else; it confirms or overturns §1.
2. **Nudge without the 10s wait.** While a user message is pending, Nudge as soon as the Lead goes
   idle, by polling faster or watching herdr state. This is independent of the rest.
3. **Streaming final transcript.** Keep the interim transcription running so the final one doesn't
   re-transcribe the whole utterance, or use speaches' SSE streaming. This cuts most of the 1.2s.
4. **Silero VAD in the browser, then Smart Turn.** Replace the loudness rule with Silero first.
   Then add Smart Turn and lower `PAUSE_MS` toward 500ms, checking the result against the
   `test/fixtures/scribe/` utterances.
5. **ADR: the front voice talks, the Lead acts.** Record that the front voice has exactly two
   capabilities, read and hand-off, that it replaces the Scribe, and how its lines are recorded.
   This amends ADR-0010 and needs a GLOSSARY term.
6. **The front voice in `serve`.** Raw transcript plus context go to a streaming
   `/chat/completions` call, with a `hand_off` tool and sentence-by-sentence `/audio/speech`. It
   gets its own config block, local ollama by default, with Haiku 5.5 as the documented cloud
   swap. Barge-in cancels it.
7. **Speaking the Lead's reply at the next gap.** Queue Lead entries while the user or the front
   voice is talking. Drop the Lead skill's Voice-on acknowledgment.
8. **Optional: GPT-Live as a cloud front voice**, through client delegation, behind config.

### Cost per hour of talking

These are estimates from the list prices above, not measurements. They assume one hour of active
conversation with 18 minutes of user speech, 18 minutes of voice output, 120 turns, and the
microphone streaming throughout. The Lead's own cost is left out, because it is the same in
every option and only the hand-offs reach it.

| Design | Per hour | How |
| --- | --- | --- |
| B, all local | ~$0 | electricity only |
| B, cloud parts | ~$0.95 | Flux: 60 min × $0.0065 = $0.39. Haiku 5.5: 120 × ~6k input tokens at ≤$0.10/MTok ≈ $0.07, output ≈ $0.01. Aura-2: ~16k characters × $0.030/1k ≈ $0.49 |
| C, `gpt-live-1` | $3.00 | 60 min × $0.05, plus backend (the Lead) |
| C, `gemini-3.8-live` | ~$0.62 as listed | 60 min in × $0.005 + 18 min out × $0.018. The page doesn't say whether the context is billed again on each turn |
| C, `gpt-realtime-2.1-mini` | ≥ ~$1.20 | new audio: 10.8k tokens × $10 + 21.6k tokens × $20 per MTok ≈ $0.54. Context re-billed on each response: ~2.2M tokens at the $0.30 cached rate ≈ $0.67, and up to ~$22 if uncached. "The entire conversation is sent to the model for each Response" ([costs](https://developers.openai.com/api/docs/guides/realtime-costs)) |
| C, `gpt-realtime-2.1` | ≥ ~$2.60 | the same arithmetic at $32 / $64 per MTok, with a $0.40 cached rate |

Realtime token rates come from OpenAI's docs: user audio is "1 token per 100 ms", and assistant
audio is 1 token per 50ms ([costs](https://developers.openai.com/api/docs/guides/realtime-costs)).
