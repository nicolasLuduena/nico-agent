import { describe, expect, it } from "vitest";
import { harnessHue, stageHue } from "./hues";

describe("a Stage's hue", () => {
  it("is its own for every Stage, Implementing and PR draft sharing live", () => {
    const stages = ["Waiting", "Ready", "Stackable", "Implementing", "PR draft", "Verified", "Merged", "Closed", "Failed"];

    expect(stages.map(stageHue)).toEqual([
      "var(--waiting)",
      "var(--ready)",
      "var(--stackable)",
      "var(--live)",
      "var(--live)",
      "var(--verified)",
      "var(--merged)",
      "var(--closed)",
      "var(--failed)",
    ]);
  });

  it("is none for a Blocker not offered to the loop", () => {
    expect(stageHue(null)).toBeNull();
  });
});

describe("a Harness's hue", () => {
  it("is its own for each Harness, and ink-muted for one it does not know", () => {
    expect(["claude", "codex", "opencode", "pi"].map(harnessHue)).toEqual([
      "var(--harness-claude)",
      "var(--harness-codex)",
      "var(--harness-opencode)",
      "var(--ink-muted)",
    ]);
  });
});
