import { describe, expect, it } from "vitest";
import { repoName } from "./status";

describe("a node's Repo on its Project's map", () => {
  it("is its slug's name", () => {
    expect(repoName("acme/web", ["acme/api", "acme/web"])).toBe("web");
  });

  it("is its whole slug when another Repo of the Project has the same name", () => {
    expect(repoName("acme/api", ["acme/api", "other/api"])).toBe("acme/api");
  });

  it("is not named while the Project has one Repo, nor outside the Project", () => {
    expect(repoName("acme/api", ["acme/api"])).toBeNull();
    expect(repoName(null, ["acme/api", "acme/web"])).toBeNull();
  });
});
