import { describe, expect, test } from "bun:test";
import { type TrackRow, eventDisplay } from "../src/app/event";

const row = (issue: string, stage: string, implementer = "working", reviewer = ""): TrackRow => ({ issue, title: `Title of ${issue}`, stage, implementer, reviewer });

/** How far out from the vertex a track ends. */
const reachOf = (track: { end: { x: number; y: number } }) => Math.round(Math.hypot(track.end.x, track.end.y));

describe("the event display: In-flight rows to tracks", () => {
  test("each Dispatch is a track reaching as far out as its Stage", () => {
    const { tracks } = eventDisplay([
      row("acme/api#1", "Implementing"),
      row("acme/api#2", "PR ready"),
      row("acme/api#3", "Review launched"),
      row("acme/api#4", "Failed at tab"),
      row("acme/api#5", "Failed at review agent start"),
      row("acme/api#6", "unknown"),
    ]);
    expect(tracks.map((t) => [t.issue, t.reach, reachOf(t)])).toEqual([
      // Inside the tracker,
      ["acme/api#1", "implementing", 58],
      // into the electromagnetic calorimeter,
      ["acme/api#2", "pr-ready", 70],
      // out past the muon stations.
      ["acme/api#3", "review-launched", 152],
      // A failed launch bursts early; a failed review out in the hadron calorimeter.
      ["acme/api#4", "failed", 40],
      ["acme/api#5", "failed", 112],
      ["acme/api#6", "unknown", 58],
    ]);
  });

  test("each Stage leaves its own marks: a calorimeter deposit, muon hits, a burst", () => {
    const kinds = (stage: string) => eventDisplay([row("acme/api#1", stage)]).tracks[0]!.marks.map((m) => m.kind);
    expect(kinds("Implementing")).toEqual(["tip"]);
    expect(kinds("PR ready")).toEqual(["deposit", "tip"]);
    expect(kinds("Review launched")).toEqual(["hit", "hit", "tip"]);
    expect(kinds("Failed at fetch")).toEqual(["burst"]);
  });

  test("a track whose agent is blocked waits on the user, and is counted apart", () => {
    const display = eventDisplay([
      row("acme/api#1", "Implementing", "blocked"),
      row("acme/api#2", "PR ready", "done", "blocked"),
      row("acme/api#3", "PR ready", "idle"),
    ]);
    expect(display.tracks.map((t) => [t.issue, t.waiting, t.working])).toEqual([
      ["acme/api#1", true, false],
      ["acme/api#2", true, false],
      ["acme/api#3", false, false],
    ]);
    expect(display.tracks[0]!.marks.map((m) => m.kind)).toEqual(["tip", "attention"]);
    expect(display.blocked).toBe(2);
    expect(display.counts).toEqual({ implementing: 1, "pr-ready": 2, "review-launched": 0, failed: 0, unknown: 0 });
  });

  test("a track is labelled with its key less the owner, and titled with its issue and Stage", () => {
    const [track] = eventDisplay([row("acme/api#7", "PR ready")]).tracks;
    expect(track!.label.text).toBe("api#7");
    expect(track!.tooltip).toBe("acme/api#7 Title of acme/api#7: PR ready");
    const [linear] = eventDisplay([row("BLE-27", "Implementing")]).tracks;
    expect(linear!.label.text).toBe("BLE-27");
  });

  test("a track keeps its angle and bend whatever order the rows come in", () => {
    const rows = [row("acme/api#1", "Implementing"), row("acme/api#2", "PR ready"), row("acme/web#9", "Review launched")];
    const byIssue = (display: ReturnType<typeof eventDisplay>) => new Map(display.tracks.map((t) => [t.issue, t]));
    const forwards = byIssue(eventDisplay(rows));
    const backwards = byIssue(eventDisplay([...rows].reverse()));
    for (const [issue, track] of forwards) expect(backwards.get(issue)).toEqual(track);
  });

  test("tracks are spread apart, clear of the downward subdetector key", () => {
    const issues = Array.from({ length: 12 }, (_, i) => row(`acme/api#${i + 1}`, "Implementing"));
    const angles = eventDisplay(issues).tracks.map((t) => Math.atan2(t.end.y, t.end.x)).sort((a, b) => a - b);
    const gaps = angles.map((a, i) => ((angles[(i + 1) % angles.length]! - a + 2 * Math.PI) % (2 * Math.PI)));
    expect(Math.min(...gaps)).toBeGreaterThan(0.3);
    for (const a of angles) expect(Math.abs(a - Math.PI / 2)).toBeGreaterThan(0.3);
  });
});
