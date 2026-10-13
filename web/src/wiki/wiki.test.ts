import { expect, test } from "vitest";
import { anchorUrl } from "./wiki";

test("an Anchor opens GitHub at the Wiki's commit, at its lines, its path escaped", () => {
  const wiki = { target: { repo: "acme/api" }, commit: "abc1234" };
  expect(anchorUrl(wiki, { path: "src/lib.rs", start: 1, end: 2 })).toBe("https://github.com/acme/api/blob/abc1234/src/lib.rs#L1-L2");
  expect(anchorUrl(wiki, { path: "docs/a b#c.md", start: 3, end: 3 })).toBe("https://github.com/acme/api/blob/abc1234/docs/a%20b%23c.md#L3-L3");
});
