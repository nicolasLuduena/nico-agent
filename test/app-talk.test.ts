import { describe, expect, test } from "bun:test";
import { type Listening, type Talk, type TalkEvent, LISTENING, level, listen, resampler, talk } from "../src/app/talk";

/** The talk button's states after each of `events`, with what each told the socket to do. */
function run(events: TalkEvent[], from: Talk = { mode: "idle" }) {
  let state = from;
  return events.map((event) => {
    const next = talk(state, event);
    state = next.state;
    return [next.state.mode, next.send ?? null];
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

  test("tapped, it listens hands-free until a pause ends the utterance", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 150 }, { type: "pause" }, { type: "final" }])).toEqual([
      ["holding", "start"],
      ["hands-free", null],
      ["transcribing", "end"],
      ["idle", null],
    ]);
  });

  test("hands-free, a second tap sends at once, and its release does nothing", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 150 }, { type: "press", at: 3000 }, { type: "release", at: 3100 }])).toEqual([
      ["holding", "start"],
      ["hands-free", null],
      ["transcribing", "end"],
      ["transcribing", null],
    ]);
  });

  test("hands-free with nothing said, it gives up without sending", () => {
    expect(run([{ type: "press", at: 0 }, { type: "release", at: 100 }, { type: "nothing" }])).toEqual([
      ["holding", "start"],
      ["hands-free", null],
      ["idle", "cancel"],
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

/** `listen` over `frames` of [level, ms], until it ends: how it ended and after how long. */
function hear(frames: [number, number][]) {
  let state: Listening = LISTENING;
  let elapsed = 0;
  for (const [l, ms] of frames) {
    const heard = listen(state, l, ms);
    state = heard.state;
    elapsed += ms;
    if (heard.ended) return { ended: heard.ended, at: elapsed };
  }
  return { ended: null, at: elapsed };
}

/** `ms` of frames at `l`, 100ms each. */
const frames = (l: number, ms: number) => Array.from({ length: ms / 100 }, (): [number, number] => [l, 100]);

const QUIET = 0.002;
const SPEECH = 0.1;

describe("hands-free listening", () => {
  test("a pause after speech ends the utterance", () => {
    expect(hear([...frames(QUIET, 500), ...frames(SPEECH, 1500), ...frames(QUIET, 3000)])).toEqual({ ended: "pause", at: 2800 });
  });

  test("a short breath between words does not", () => {
    expect(hear([...frames(SPEECH, 1000), ...frames(QUIET, 400), ...frames(SPEECH, 1000), ...frames(QUIET, 400)])).toEqual({ ended: null, at: 2800 });
  });

  test("a click is not speech: with nothing said, it gives up after a while", () => {
    expect(hear([...frames(QUIET, 500), [SPEECH, 100], ...frames(QUIET, 9000)])).toEqual({ ended: "nothing", at: 6000 });
  });

  test("steady background noise becomes the floor, and speech over it still counts", () => {
    const noise = 0.03;
    expect(hear([...frames(noise, 3000), ...frames(0.3, 1000), ...frames(noise, 2000)])).toEqual({ ended: "pause", at: 4800 });
  });

  test("an utterance that never pauses ends at the limit", () => {
    expect(hear(frames(SPEECH, 70_000))).toEqual({ ended: "limit", at: 60_000 });
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

  test("a batch's level is its root mean square", () => {
    expect(level(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBe(0.5);
    expect(level(new Float32Array(0))).toBe(0);
  });
});
