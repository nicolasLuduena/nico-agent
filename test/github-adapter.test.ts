import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealWorld } from "../src/real-world";

test("the PRs on a branch carry their head branch, unless they come from a fork", async () => {
  const bin = mkdtempSync(join(tmpdir(), "nico-gh-"));
  const prs = [
    { number: 18, url: "https://github.com/acme/api/pull/18", state: "OPEN", baseRefName: "agent/api-6", headRefName: "agent/api-8", isCrossRepository: false },
    { number: 17, url: "https://github.com/acme/api/pull/17", state: "CLOSED", baseRefName: "main", headRefName: "agent/api-8", isCrossRepository: true },
  ];
  writeFileSync(join(bin, "prs.json"), JSON.stringify(prs));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" > "${bin}/args"\ncat "${bin}/prs.json"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    expect(await new RealWorld().githubBranchPullRequests("acme/api", "agent/api-8")).toEqual([
      { repo: "acme/api", number: 17, url: "https://github.com/acme/api/pull/17", state: "closed", baseBranch: "main" },
      { repo: "acme/api", number: 18, url: "https://github.com/acme/api/pull/18", state: "open", baseBranch: "agent/api-6", headBranch: "agent/api-8" },
    ]);
    expect(await Bun.file(join(bin, "args")).text()).toContain("--head agent/api-8");
  } finally {
    process.env.PATH = path;
  }
});
