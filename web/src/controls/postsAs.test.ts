import { describe, expect, it } from "vitest";
import { INSTALL_APP, postsAs } from "./postsAs";

describe("who a Repo's agents post as", () => {
  it("is the bot once the App is on the Repo", () => {
    expect(postsAs({ posts_as: "nicolasluduena-coding-agent[bot]" })).toEqual({ said: "Agents post as nicolasluduena-coding-agent[bot]", install: null });
  });

  it("is you without it, with a link to install the App", () => {
    expect(postsAs({ posts_as: "you" })).toEqual({ said: "PRs and comments are posted as you", install: INSTALL_APP });
  });

  it("is not said before the Repo's first checks", () => {
    expect(postsAs({})).toBeNull();
  });
});
