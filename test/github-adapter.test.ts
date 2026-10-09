import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealWorld } from "../src/real-world";
import { RateLimited } from "../src/world";

/**
 * Run `body` with fake commands first on PATH, each a shell script by name,
 * in a directory `body` gets for their files. Without a `ghbot` of its own,
 * the bot has no token, so everything is read as the user.
 */
async function withCommands(scripts: (bin: string) => Record<string, string>, body: (bin: string) => Promise<void>) {
  const bin = mkdtempSync(join(tmpdir(), "nico-gh-"));
  const all = { ghbot: `#!/bin/sh\necho "gh-bot-token: no config" >&2\nexit 1\n`, ...scripts(bin) };
  for (const [name, script] of Object.entries(all)) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await body(bin);
  } finally {
    process.env.PATH = path;
  }
}

const NO_ISSUES = JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } });

test("the PRs on a branch carry their head branch, unless they come from a fork", async () => {
  const prs = [
    { number: 18, url: "https://github.com/acme/api/pull/18", state: "OPEN", baseRefName: "agent/api-6", headRefName: "agent/api-8", isCrossRepository: false },
    { number: 17, url: "https://github.com/acme/api/pull/17", state: "CLOSED", baseRefName: "main", headRefName: "agent/api-8", isCrossRepository: true },
  ];
  await withCommands((bin) => {
    writeFileSync(join(bin, "prs.json"), JSON.stringify(prs));
    return { gh: `#!/bin/sh\necho "$*" > "${bin}/args"\ncat "${bin}/prs.json"\n` };
  }, async (bin) => {
    expect(await new RealWorld().githubBranchPullRequests("acme/api", "agent/api-8")).toEqual([
      { repo: "acme/api", number: 17, url: "https://github.com/acme/api/pull/17", state: "closed", baseBranch: "main" },
      { repo: "acme/api", number: 18, url: "https://github.com/acme/api/pull/18", state: "open", baseBranch: "agent/api-6", headBranch: "agent/api-8" },
    ]);
    // Only the branch's PRs, not every PR the Repo ever had.
    const args = await Bun.file(join(bin, "args")).text();
    expect(args).toContain("--head agent/api-8 --state all");
  });
});

test("an issue's native sub-issues come in sub-issue order, across pages, each with its repo, parent and own sub-issues", async () => {
  const node = (number: number, repo: string, subIssues: number) => ({
    number, title: `Issue ${number}`, url: `https://github.com/${repo}/issues/${number}`, state: number === 13 ? "CLOSED" : "OPEN",
    labels: { nodes: [{ name: "ready-for-agent" }] }, assignees: { nodes: [] }, blockedBy: { nodes: [] },
    parent: { number: 10, repository: { nameWithOwner: "acme/api" } }, subIssuesSummary: { total: subIssues },
    repository: { nameWithOwner: repo },
  });
  const page = (nodes: unknown[], endCursor: string | null) =>
    ({ data: { repository: { issue: { subIssues: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } } } } });
  await withCommands((bin) => {
    writeFileSync(join(bin, "first.json"), JSON.stringify(page([node(13, "acme/api", 0), node(11, "acme/web", 2)], "Mg")));
    writeFileSync(join(bin, "second.json"), JSON.stringify(page([node(12, "acme/api", 0)], null)));
    return { gh: `#!/bin/sh\necho "$*" >> "${bin}/args"\ncase "$*" in *cursor=Mg*) cat "${bin}/second.json";; *) cat "${bin}/first.json";; esac\n` };
  }, async (bin) => {
    const subIssues = await new RealWorld().githubSubIssues("acme/api", 10);
    expect(subIssues.map((i) => [i.slug, i.number, i.state, i.hasSubIssues])).toEqual([
      ["acme/api", 13, "closed", false], ["acme/web", 11, "open", true], ["acme/api", 12, "open", false],
    ]);
    expect(subIssues[0]!.parent).toEqual({ slug: "acme/api", number: 10 });
    const args = await Bun.file(join(bin, "args")).text();
    expect(args).toContain("subIssues(");
    expect(args).toContain("number=10");
  });
});

test("a Repo the bot's App is installed on is read as the bot, any other as the user", async () => {
  await withCommands((bin) => {
    writeFileSync(join(bin, "issues.json"), NO_ISSUES);
    return {
      ghbot: `#!/bin/sh\ncase "$*" in *installation/repositories*) echo acme/api;; *) echo ghbot >> "${bin}/calls"; cat "${bin}/issues.json";; esac\n`,
      gh: `#!/bin/sh\necho gh >> "${bin}/calls"\ncat "${bin}/issues.json"\n`,
    };
  }, async (bin) => {
    const world = new RealWorld();
    expect(await world.githubIssues("acme/api")).toEqual([]);
    expect(await world.githubIssues("acme/web")).toEqual([]);
    const calls = (await Bun.file(join(bin, "calls")).text()).trim().split("\n");
    expect(calls).toEqual(["ghbot", "gh"]);
  });
});

test("a PR's activity is read as the user, even where the App is installed: the App can't read check results", async () => {
  const activity = { data: { repository: { pullRequest: { state: "OPEN", isDraft: true, comments: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } } } } };
  await withCommands((bin) => ({
    ghbot: `#!/bin/sh\ncase "$*" in *installation/repositories*) echo acme/api;; *) echo ghbot >> "${bin}/calls"; exit 1;; esac\n`,
    gh: `#!/bin/sh\necho gh >> "${bin}/calls"\necho '${JSON.stringify(activity)}'\n`,
  }), async (bin) => {
    expect(await new RealWorld().githubPullRequestActivity("acme/api", 18)).toEqual({ state: "open", draft: true, comments: [], checks: [] });
    expect(await Bun.file(join(bin, "calls")).text()).toBe("gh\n");
  });
});

test("a rate-limited read fails until the latest reset of the limits it spent", async () => {
  const resources = {
    core: { limit: 5000, remaining: 4000, reset: 1_791_570_000 },
    graphql: { limit: 5000, remaining: 0, reset: 1_791_571_000 },
    search: { limit: 30, remaining: 0, reset: 1_791_569_000 },
  };
  await withCommands(() => ({
    gh: `#!/bin/sh\ncase "$*" in "api rate_limit") echo '${JSON.stringify({ resources })}';; *) echo "GraphQL: API rate limit already exceeded for user ID 1." >&2; exit 1;; esac\n`,
  }), async () => {
    const failure = await new RealWorld().githubIssues("acme/api").catch((e) => e);
    expect(failure).toBeInstanceOf(RateLimited);
    expect(failure.resumesAt).toEqual(new Date(1_791_571_000_000));
  });
});
