import { describe, expect, it } from "vitest";
import type { Dispatch, Launch, Repo } from "../status";
import { choices, startingLaunch } from "./launch";

const repo: Repo = {
  slug: "acme/api",
  read_at: null,
  prs_checked_at: null,
  ready: [],
  stackable: [],
  switches: {},
  implementer: { harness: "claude", model: "opus", effort: null },
  harnesses: {
    claude: { models: ["opus", "sonnet"], efforts: ["low", "high"] },
    codex: { models: null, efforts: null },
  },
};

const dispatch = (repo: string, implementer: Launch) => ({ repo, implementer }) as Dispatch;

describe("the launch the Dispatch form starts on", () => {
  it("is the Repo's implementer launch while it has no Dispatch", () => {
    expect(startingLaunch(repo, [])).toEqual({ harness: "claude", model: "opus", effort: null });
  });

  it("is the launch of the Repo's last Dispatch, not another Repo's", () => {
    const dispatches = [
      dispatch("acme/api", { harness: "claude", model: "sonnet", effort: "low" }),
      dispatch("acme/api", { harness: "codex", model: "gpt-5", effort: null }),
      dispatch("acme/web", { harness: "claude", model: "sonnet", effort: "high" }),
    ];

    expect(startingLaunch(repo, dispatches)).toEqual({ harness: "codex", model: "gpt-5", effort: null });
  });

  it("on a Harness picked, is the last launch used on it, else that Harness's defaults", () => {
    const dispatches = [
      dispatch("acme/api", { harness: "claude", model: "sonnet", effort: "low" }),
      dispatch("acme/api", { harness: "codex", model: "gpt-5", effort: null }),
    ];
    const noClaude = [dispatch("acme/api", { harness: "codex", model: "gpt-5", effort: null })];

    expect(startingLaunch(repo, dispatches, "claude")).toEqual({ harness: "claude", model: "sonnet", effort: "low" });
    expect(startingLaunch(repo, noClaude, "claude")).toEqual({ harness: "claude", model: "opus", effort: null });
    expect(startingLaunch(repo, [], "codex")).toEqual({ harness: "codex", model: null, effort: null });
  });

  it("skips a launch on a Harness the config no longer has", () => {
    const gone = [dispatch("acme/api", { harness: "opencode", model: null, effort: null })];

    expect(startingLaunch(repo, gone)).toEqual({ harness: "claude", model: "opus", effort: null });
  });
});

describe("a model or Effort select's options", () => {
  it("are the default, then the Harness's list", () => {
    expect(choices(["opus", "sonnet"], "sonnet")).toEqual([null, "opus", "sonnet"]);
  });

  it("are the default and the one chosen, for a Harness that takes any", () => {
    expect(choices(null, "gpt-5")).toEqual([null, "gpt-5"]);
    expect(choices(null, null)).toEqual([null]);
  });
});
