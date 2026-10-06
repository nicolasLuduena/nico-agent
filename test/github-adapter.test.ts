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

test("an issue's native sub-issues come in sub-issue order, across pages, each with its repo, parent and own sub-issues", async () => {
  const bin = mkdtempSync(join(tmpdir(), "nico-gh-"));
  const node = (number: number, repo: string, subIssues: number) => ({
    number, title: `Issue ${number}`, url: `https://github.com/${repo}/issues/${number}`, state: number === 13 ? "CLOSED" : "OPEN",
    labels: { nodes: [{ name: "ready-for-agent" }] }, assignees: { nodes: [] }, blockedBy: { nodes: [] },
    parent: { number: 10, repository: { nameWithOwner: "acme/api" } }, subIssuesSummary: { total: subIssues },
    repository: { nameWithOwner: repo },
  });
  const page = (nodes: unknown[], endCursor: string | null) =>
    ({ data: { repository: { issue: { subIssues: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } } } } });
  writeFileSync(join(bin, "first.json"), JSON.stringify(page([node(13, "acme/api", 0), node(11, "acme/web", 2)], "Mg")));
  writeFileSync(join(bin, "second.json"), JSON.stringify(page([node(12, "acme/api", 0)], null)));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${bin}/args"\ncase "$*" in *cursor=Mg*) cat "${bin}/second.json";; *) cat "${bin}/first.json";; esac\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const subIssues = await new RealWorld().githubSubIssues("acme/api", 10);
    expect(subIssues.map((i) => [i.slug, i.number, i.state, i.hasSubIssues])).toEqual([
      ["acme/api", 13, "closed", false], ["acme/web", 11, "open", true], ["acme/api", 12, "open", false],
    ]);
    expect(subIssues[0]!.parent).toEqual({ slug: "acme/api", number: 10 });
    const args = await Bun.file(join(bin, "args")).text();
    expect(args).toContain("subIssues(");
    expect(args).toContain("number=10");
  } finally {
    process.env.PATH = path;
  }
});
