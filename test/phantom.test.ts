import { describe, expect, test } from "bun:test";
import { screen } from "../src/phantom";
import fixtures from "./fixtures/phantom/transcripts.json";

/** A fixture's transcript, as `transcribe` reads speaches' verbose_json answer. */
function heard(name: keyof typeof fixtures) {
  const { text, segments } = fixtures[name].answer;
  return { text: text.trim(), segments: segments.map((s) => ({ start: s.start, end: s.end, noSpeech: s.no_speech_prob })) };
}

describe("screen", () => {
  test("a phrase Whisper repeated reaches the Front voice once", () => {
    expect(screen(heard("repeated-no"))).toEqual({ text: "No." });
    expect(screen(heard("repeated-aiken"))).toEqual({ text: "This is not the case with Aiken." });
  });

  test("speech, and a phrase said twice, reach it as heard", () => {
    expect(screen(heard("speech"))).toEqual({ text: "Dispatch the next issue on the board." });
    expect(screen({ text: "No, no. Dispatch it." })).toEqual({ text: "No, no. Dispatch it." });
  });

  test("one of Whisper's silence phrases alone is dropped; said with more, it stays", () => {
    expect(screen(heard("thanks-for-watching"))).toEqual({ dropped: "phantom phrase" });
    for (const text of ["Thank you.", "Subtitles by the Amara.org community", "you", "...", "Thanks for watching! Thanks for watching! Thanks for watching!"]) {
      expect(screen({ text })).toEqual({ dropped: "phantom phrase" });
    }
    expect(screen({ text: "Thank you, dispatch it." })).toEqual({ text: "Thank you, dispatch it." });
  });

  test("a transcript speaches marks as mostly not speech is dropped", () => {
    expect(screen(heard("no-speech"))).toEqual({ dropped: "no speech" });
    // Two seconds of speech and a phantom word in the second of quiet after it: mostly speech, it stays.
    const segments = [{ start: 0, end: 2, noSpeech: 0.02 }, { start: 2, end: 3, noSpeech: 0.95 }];
    expect(screen({ text: "Dispatch it. Okay.", segments })).toEqual({ text: "Dispatch it. Okay." });
  });

  describe("heard while the app speaks", () => {
    const PLAYING = ["Two issues are Ready.", "The retries PR is ready for review. Shall I merge it, yes or no?"];

    test("what the app is saying, heard back through the microphone, is dropped", () => {
      expect(screen({ text: "The retries PR is ready for review." }, PLAYING)).toEqual({ dropped: "echo" });
      expect(screen({ text: "ready for review shall I merge" }, PLAYING)).toEqual({ dropped: "echo" });
    });

    test("the user talking over it is heard, a short answer too", () => {
      expect(screen({ text: "Yes." }, PLAYING)).toEqual({ text: "Yes." });
      expect(screen({ text: "No, merge the billing PR first." }, PLAYING)).toEqual({ text: "No, merge the billing PR first." });
      expect(screen({ text: "The retries PR is ready for review." })).toEqual({ text: "The retries PR is ready for review." });
    });
  });
});
