import { describe, expect, it } from "vitest";
import type { Project, Settings } from "../status";
import { picked, projectOf, switchLabel, tag, undoLabel, unset } from "./settings";

const claude = { harness: "claude", model: null, effort: null };
const defaults: Settings = {
  switches: {},
  room: { value: 3, from: "default" },
  base: { value: null, from: "default" },
  implementer: { value: claude, from: "default" },
  reviewer: { value: { ...claude, harness: "codex" }, from: "default" },
  libraries: { value: [], from: "default" },
};
const shop: Project = { ...defaults, name: "shop", repos: ["acme/api", "acme/web"], defaults: { room: 4, switches: { review: false } } };
const own: Project = { ...defaults, name: "acme/cli", repos: ["acme/cli"], defaults: {} };

describe("a setting's chip", () => {
  it("says where it comes from while the Repo does not set it", () => {
    expect(tag({ value: 4, from: "project" })).toBe("from Project");
    expect(tag({ value: 3, from: "default" })).toBe("default");
  });

  it("is none once the Repo sets it", () => {
    expect(tag({ value: 2, from: "repo" })).toBeNull();
  });
});

describe("removing the Repo's own value", () => {
  it("is offered only for a value the Repo sets", () => {
    expect(undoLabel({ value: 4, from: "project" }, shop, ["room"])).toBeNull();
    expect(undoLabel({ value: 3, from: "default" }, own, ["room"])).toBeNull();
  });

  it("falls back to the Project's when its Project sets it, a switch one by one", () => {
    expect(undoLabel({ value: 2, from: "repo" }, shop, ["room"])).toBe("Use the Project's");
    expect(undoLabel({ value: true, from: "repo" }, shop, ["switches", "review"])).toBe("Use the Project's");
  });

  it("falls back to the default when its Project does not set it", () => {
    expect(undoLabel({ value: "dev", from: "repo" }, shop, ["base"])).toBe("Use the default");
    expect(undoLabel({ value: false, from: "repo" }, shop, ["switches", "stack"])).toBe("Use the default");
    expect(undoLabel({ value: 2, from: "repo" }, own, ["room"])).toBe("Use the default");
    expect(undoLabel({ value: 2, from: "repo" }, undefined, ["room"])).toBe("Use the default");
  });

  it("sends null for the setting, or for the one switch", () => {
    expect(unset(["reviewer"])).toEqual({ reviewer: null });
    expect(unset(["switches", "review"])).toEqual({ switches: { review: null } });
  });
});

describe("a Project's own defaults", () => {
  it("are tagged default while the Project does not set them, and untagged once it does", () => {
    expect(tag({ value: 3, from: "default" }, "project")).toBe("default");
    expect(tag({ value: 4, from: "project" }, "project")).toBeNull();
  });

  it("go back to the default, once the Project sets them", () => {
    expect(undoLabel({ value: 4, from: "project" }, undefined, ["room"], "project")).toBe("Use the default");
    expect(undoLabel({ value: false, from: "project" }, undefined, ["switches", "review"], "project")).toBe("Use the default");
    expect(undoLabel({ value: 3, from: "default" }, undefined, ["room"], "project")).toBeNull();
  });
});

describe("the Project a Repo is in", () => {
  it("is the one /api/status lists it under", () => {
    expect(projectOf("acme/web", [own, shop])).toBe(shop);
    expect(projectOf("acme/cli", [own, shop])).toBe(own);
    expect(projectOf("acme/www", [own, shop])).toBeUndefined();
  });
});

describe("a launch picked on the page", () => {
  const launch = { harness: "claude", model: "opus", effort: "high" };

  it("keeps its Harness on a model or Effort picked", () => {
    expect(picked(launch, "model", "sonnet")).toEqual({ harness: "claude", model: "sonnet", effort: "high" });
    expect(picked(launch, "effort", null)).toEqual({ harness: "claude", model: "opus", effort: null });
  });

  it("starts another Harness on its own model and Effort", () => {
    expect(picked(launch, "harness", "codex")).toEqual({ harness: "codex", model: null, effort: null });
  });
});

describe("a switch's row", () => {
  it("is named as the Glossary says it, mine for what it does", () => {
    expect(switchLabel("mine")).toBe("Only issues assigned to me");
    expect(switchLabel("flip")).toBe("Flip to ready");
    expect(switchLabel("quality_scan")).toBe("Quality-scan");
    expect(switchLabel("stack")).toBe("Stack");
  });
});
