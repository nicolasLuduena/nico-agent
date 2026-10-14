import { describe, expect, it } from "vitest";
import { harnessHue, repoLine, stageHue } from "./hues";
import type { Project } from "./status";

/** A Project as one read of `/api/status` gives it: its Repos sorted by slug, as serve lists them. */
function read(name: string, repos: string[]): Project {
  const json = JSON.stringify({ name, repos: [...repos].sort(), defaults: {} });
  return JSON.parse(json);
}

describe("a Repo's line colour", () => {
  it("is its own in a Project of three, by its order there", () => {
    const shop = read("shop", ["acme/web", "acme/api", "acme/docs"]);

    expect(repoLine("acme/api", shop)).toBe("var(--line-1)");
    expect(repoLine("acme/docs", shop)).toBe("var(--line-2)");
    expect(repoLine("acme/web", shop)).toBe("var(--line-3)");
  });

  it("stays the same across reloads", () => {
    const before = repoLine("acme/web", read("shop", ["acme/api", "acme/web", "acme/docs"]));
    const after = repoLine("acme/web", read("shop", ["acme/docs", "acme/web", "acme/api"]));

    expect(after).toBe(before);
  });

  it("starts again from the first past six Repos", () => {
    const big = read("big", ["a/1", "a/2", "a/3", "a/4", "a/5", "a/6", "a/7"]);

    expect(repoLine("a/7", big)).toBe("var(--line-1)");
  });

  it("is none in a Project of one Repo, or for a Repo outside it", () => {
    expect(repoLine("acme/cli", read("acme/cli", ["acme/cli"]))).toBeNull();
    expect(repoLine("acme/other", read("shop", ["acme/api", "acme/web"]))).toBeNull();
    expect(repoLine(null, read("shop", ["acme/api", "acme/web"]))).toBeNull();
  });
});

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
