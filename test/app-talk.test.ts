import { describe, expect, test } from "bun:test";
import { type Listening, type Talk, type TalkEvent, ASK_MS, LISTENING, LONGEST_PAUSE_MS, TURN_PAUSE_MS, bargesIn, ends, indicator, listen, pcmSamples, resampler, talk } from "../src/app/talk";

/** A talk button state as these tests name it: its mode, and "(session)" in a hands-free session. */
const named = (state: Talk) => ("session" in state && state.session ? `${state.mode} (session)` : state.mode);

/** The talk button's states after each of `events`, with what each told the socket to do. */
function run(events: TalkEvent[], from: Talk = { mode: "idle" }) {
  let state = from;
  return events.map((event) => {
    const next = talk(state, event);
    state = next.state;
    return [named(next.state), next.send ?? null];
  });
}

describe("the talk button", () => {
  test("held, it records until released, then sends", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 1200 }, { type: "final" }])).toEqual([
      ["holding", "start"],
      ["transcribing", "end"],
      ["idle", null],
    ]);
  });

  test("tapped, it starts a hands-free session: a pause sends the utterance, and it keeps listening", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 150 }, { type: "pause" }, { type: "final" }])).toEqual([
      ["holding", "start"],
      ["hands-free (session)", null],
      ["transcribing (session)", "end"],
      ["watching (session)", null],
    ]);
  });

  test("hands-free, a second tap sends at once, and its release does nothing", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 150 }, { type: "press", at: 3000 }, { type: "release", at: 3100 }])).toEqual([
      ["holding", "start"],
      ["hands-free (session)", null],
      ["transcribing (session)", "end"],
      ["transcribing (session)", null],
    ]);
  });

  test("hands-free with nothing said, it drops the utterance without sending and keeps listening", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 100 }, { type: "nothing" }])).toEqual([
      ["holding", "start"],
      ["hands-free (session)", null],
      ["watching (session)", "cancel"],
    ]);
  });

  test("a pause while held does not end the utterance: the user is still holding", () => {
    expect(run([{ type: "press", at: 0 }, { type: "pause" }, { type: "release", at: 2000 }])).toEqual([
      ["holding", "start"],
      ["holding", null],
      ["transcribing", "end"],
    ]);
  });

  test("an utterance at the length limit is sent, held or hands-free", () => {
    expect(run([{ type: "press", at: 0 }, { type: "limit" }])).toEqual([["holding", "start"], ["transcribing", "end"]]);
    expect(run([{ type: "limit" }], { mode: "hands-free" })).toEqual([["transcribing", "end"]]);
  });

  test("a failure (no microphone, the socket gone, the service down) stops it, cancelling what was recording", () => {
    expect(run([{ type: "press", at: 0 }, { type: "failed" }])).toEqual([["holding", "start"], ["idle", "cancel"]]);
    expect(run([{ type: "failed" }], { mode: "transcribing" })).toEqual([["idle", null]]);
  });

  test("pressed while the last utterance is transcribed, it records the next one", () => {
    expect(run([{ type: "press", at: 0 }, { type: "final" }], { mode: "transcribing" })).toEqual([
      ["holding", "start"],
      ["holding", null],
    ]);
  });
});

describe("a hands-free session", () => {
  const SESSION: Talk = { mode: "watching", session: true };

  test("user speaks, the Lead answers, the user speaks again, touching nothing", () => {
    expect(run([
      { type: "lead-speaks" }, { type: "lead-done" },
      { type: "barge" }, { type: "pause" }, { type: "final" },
    ], SESSION)).toEqual([
      ["watching (session)", null],
      ["watching (session)", null],
      ["hands-free (session)", "start"],
      ["transcribing (session)", "end"],
      ["watching (session)", null],
    ]);
  });

  test("the user can talk over the Lead, or start again while the last utterance is transcribed", () => {
    expect(run([{ type: "lead-speaks" }, { type: "barge" }], SESSION)).toEqual([["watching (session)", null], ["hands-free (session)", "start"]]);
    expect(run([{ type: "barge" }], { mode: "transcribing", session: true })).toEqual([["hands-free (session)", "start"]]);
  });

  test("a tap while nobody talks ends it; once ended, the last transcript still comes, and the Lead's voice is only watched", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 100 }], SESSION)).toEqual([["idle", null], ["idle", null]]);
    expect(run([{ type: "press", at: 0 }, { type: "final" }], { mode: "transcribing", session: true })).toEqual([["transcribing", null], ["idle", null]]);
  });

  test("a tap ends it only while nobody talks", () => {
    expect(ends(SESSION)).toBe(true);
    expect(ends({ mode: "transcribing", session: true })).toBe(true);
    expect(ends({ mode: "hands-free", session: true })).toBe(false);
    expect(ends({ mode: "watching" })).toBe(false);
  });

  test("a failure ends it", () => {
    expect(run([{ type: "failed" }], SESSION)).toEqual([["idle", null]]);
  });

  test("talking over the Lead outside a session sends that one utterance, then stops", () => {
    expect(run([{ type: "lead-speaks" }, { type: "barge" }, { type: "pause" }, { type: "final" }])).toEqual([
      ["watching", null],
      ["hands-free", "start"],
      ["transcribing", "end"],
      ["idle", null],
    ]);
  });
});

describe("the key anywhere (`nico-agent voice talk`)", () => {
  test("starts a hands-free session from idle, or over the Lead speaking", () => {
    expect(run([{ type: "key" }])).toEqual([["hands-free (session)", "start"]]);
    expect(run([{ type: "key" }], { mode: "watching" })).toEqual([["hands-free (session)", "start"]]);
    expect(run([{ type: "key" }], { mode: "transcribing" })).toEqual([["hands-free (session)", "start"]]);
  });

  test("again while the user talks, sends at once; held or hands-free", () => {
    expect(run([{ type: "key" }], { mode: "hands-free", session: true })).toEqual([["transcribing (session)", "end"]]);
    expect(run([{ type: "key" }], { mode: "holding", since: 0 })).toEqual([["transcribing", "end"]]);
  });

  test("again while nobody talks, ends the session", () => {
    expect(run([{ type: "key" }], { mode: "watching", session: true })).toEqual([["idle", null]]);
    expect(run([{ type: "key" }], { mode: "transcribing", session: true })).toEqual([["transcribing", null]]);
  });
});

describe("the indicator", () => {
  const quiet = { speaking: false, working: false };

  test("shows listening while the user is heard, in a session or recording", () => {
    expect(indicator({ mode: "holding", since: 0 }, quiet)).toBe("listening");
    expect(indicator({ mode: "hands-free" }, { speaking: true, working: true })).toBe("listening");
    expect(indicator({ mode: "watching", session: true }, quiet)).toBe("listening");
  });

  test("shows speaking while the Lead is heard, over its thinking", () => {
    expect(indicator({ mode: "watching", session: true }, { speaking: true, working: true })).toBe("speaking");
    expect(indicator({ mode: "watching" }, { speaking: true, working: false })).toBe("speaking");
  });

  test("shows thinking while what was said is transcribed or the Lead works on it", () => {
    expect(indicator({ mode: "transcribing" }, quiet)).toBe("thinking");
    expect(indicator({ mode: "watching", session: true }, { speaking: false, working: true })).toBe("thinking");
  });

  test("shows nothing outside a conversation by voice, however busy the Lead", () => {
    expect(indicator({ mode: "idle" }, { speaking: false, working: true })).toBeNull();
  });
});

describe("barge-in, while the Lead speaks", () => {
  test("the microphone watches for the user's voice, and speech onset starts a hands-free utterance", () => {
    expect(run([{ type: "lead-speaks" }, { type: "barge" }, { type: "pause" }])).toEqual([
      ["watching", null],
      ["hands-free", "start"],
      ["transcribing", "end"],
    ]);
  });

  test("once the Lead is done, or hushed by a tap, it stops watching", () => {
    expect(run([{ type: "lead-speaks" }, { type: "lead-done" }])).toEqual([["watching", null], ["idle", null]]);
  });

  test("a press while it watches records as from idle", () => {
    expect(run([{ type: "lead-speaks" }, { type: "press", at: 0 }, { type: "release", at: 100 }])).toEqual([
      ["watching", null],
      ["holding", "start"],
      ["hands-free (session)", null],
    ]);
  });

  test("while the user is recording or waiting on a transcript, the Lead speaking changes nothing", () => {
    for (const mode of ["holding", "hands-free", "transcribing"] as const) {
      const from = (mode === "holding" ? { mode, since: 0 } : { mode }) as Talk;
      expect(run([{ type: "lead-speaks" }, { type: "lead-done" }, { type: "barge" }], from)).toEqual([[mode, null], [mode, null], [mode, null]]);
    }
  });

  test("a microphone that fails while watching only stops watching", () => {
    expect(run([{ type: "failed" }], { mode: "watching" })).toEqual([["idle", null]]);
  });

  test("speech onset is a fifth of a second of unbroken voice; blips never add up", () => {
    const onset = (frames: [number, number][]) => {
      let state: Listening = LISTENING;
      return frames.map(([p, ms]) => bargesIn((state = listen(state, p, ms).state)));
    };
    expect(onset([[QUIET, 100], [SPEECH, 100], [SPEECH, 100]])).toEqual([false, false, true]);
    expect(onset([[QUIET, 100], [SPEECH, 100], [QUIET, 100], [SPEECH, 100]])).toEqual([false, false, false, false]);
  });
});

/**
 * `listen` over `frames` of [Silero's speech probability, ms], until it ends:
 * how it ended and after how long, with Smart Turn answering whether the user
 * `finished` (or not) `answerMs` after each time it is asked, and when it was asked.
 */
function hear(frames: [number, number][], finished = true, answerMs = 100) {
  let state: Listening = LISTENING;
  let elapsed = 0;
  const asked: number[] = [];
  let answers: number | null = null;
  for (const [p, ms] of frames) {
    const heard = listen(state, p, ms);
    state = heard.state;
    elapsed += ms;
    if (answers !== null && elapsed >= answers) {
      // As the page does: an answer that comes after speech resumed is dropped.
      if (!state.speaking) state = { ...state, finished };
      answers = null;
    }
    if (heard.ask) {
      asked.push(elapsed);
      answers = elapsed + answerMs;
    }
    if (heard.ended) return { ended: heard.ended, at: elapsed, asked };
  }
  return { ended: null, at: elapsed, asked };
}

/** `ms` of frames at `p`, 100ms each. */
const frames = (p: number, ms: number) => Array.from({ length: ms / 100 }, (): [number, number] => [p, 100]);

const QUIET = 0.02;
const SPEECH = 0.9;

describe("hands-free listening", () => {
  test("a pause after speech asks Smart Turn, and the user having finished ends the utterance once the pause is long enough", () => {
    expect(hear([...frames(QUIET, 500), ...frames(SPEECH, 1500), ...frames(QUIET, 3000)])).toEqual({ ended: "pause", at: 2000 + TURN_PAUSE_MS, asked: [2000 + ASK_MS] });
  });

  test("Smart Turn answering late ends the utterance with the next audio heard", () => {
    expect(hear([...frames(SPEECH, 1000), ...frames(QUIET, 3000)], true, 600)).toEqual({ ended: "pause", at: 1000 + ASK_MS + 600 + 100, asked: [1000 + ASK_MS] });
  });

  test("a pause the user has not finished waits for more, and Smart Turn is asked again at the next pause", () => {
    expect(hear([...frames(SPEECH, 1000), ...frames(QUIET, 1000), ...frames(SPEECH, 1000), ...frames(QUIET, 4000)], false)).toEqual({
      ended: "pause",
      at: 3000 + LONGEST_PAUSE_MS,
      asked: [1000 + ASK_MS, 3000 + ASK_MS],
    });
  });

  test("speech again makes Smart Turn's answer about the pause before it stale", () => {
    // Finished, said of the first pause, would end the second at TURN_PAUSE_MS; asked again, it is not finished.
    const said = [...frames(SPEECH, 1000), ...frames(QUIET, 400), ...frames(SPEECH, 1000), ...frames(QUIET, 4000)];
    let state: Listening = LISTENING;
    const endings: (string | undefined)[] = [];
    said.forEach(([p, ms], i) => {
      const heard = listen(state, p, ms);
      state = heard.state;
      if (i === 13) state = { ...state, finished: true };
      endings.push(heard.ended);
    });
    expect(endings.indexOf("pause")).toBe(24 + LONGEST_PAUSE_MS / 100 - 1);
  });

  test("a short breath between words asks nothing", () => {
    expect(hear([...frames(SPEECH, 1000), ...frames(QUIET, 100), ...frames(SPEECH, 1000), ...frames(QUIET, 100)])).toEqual({ ended: null, at: 2200, asked: [] });
  });

  test("speech that grows less certain at a word's end goes on until it is clearly not speech", () => {
    expect(hear([...frames(SPEECH, 1000), ...frames(0.4, 1000), ...frames(QUIET, 3000)])).toEqual({ ended: "pause", at: 2000 + TURN_PAUSE_MS, asked: [2000 + ASK_MS] });
  });

  test("a click is not speech: with nothing said, it gives up after a while", () => {
    expect(hear([...frames(QUIET, 500), [SPEECH, 100], ...frames(QUIET, 9000)])).toEqual({ ended: "nothing", at: 6000, asked: [] });
  });

  test("noise Silero does not hear as speech is nothing, however loud", () => {
    expect(hear(frames(0.3, 9000))).toEqual({ ended: "nothing", at: 6000, asked: [] });
  });

  test("an utterance that never pauses ends at the limit", () => {
    expect(hear(frames(SPEECH, 70_000))).toEqual({ ended: "limit", at: 60_000, asked: [] });
  });
});

describe("the audio sent", () => {
  test("is the microphone's samples at 16kHz, 16-bit, the batches joined without a seam", () => {
    const toPcm = resampler(48_000);
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
    const first = toPcm(ramp.subarray(0, 1000));
    const second = toPcm(ramp.subarray(1000));
    expect(first.length + second.length).toBe(1600);
    const all = Int16Array.from([...first, ...second]);
    // Each output sample averages three input ones, so the ramp stays a ramp.
    expect(all[0]).toBe(Math.round((1 / 4800) * 32767));
    expect(all[333]).toBe(Math.round((1000 / 4800) * 32767));
    expect(all[1599]).toBe(Math.round((4798 / 4800) * 32767));
  });

  test("clips what is out of range rather than wrapping", () => {
    expect([...resampler(16_000)(Float32Array.from([1.5, -2, 0.5]))]).toEqual([32767, -32768, Math.round(0.5 * 32767)]);
  });

  test("44.1kHz keeps the same duration", () => {
    expect(resampler(44_100)(new Float32Array(44_100)).length).toBe(16_000);
  });
});

describe("the Lead's voice as played", () => {
  test("its 16-bit little-endian PCM becomes samples from -1 to 1", () => {
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40]).buffer;
    expect([...pcmSamples(pcm)]).toEqual([0, 32767 / 32768, -1, 0.5]);
  });
});
