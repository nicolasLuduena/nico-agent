import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { DiffFile } from "../src/diff";
import { RealWorld } from "../src/real-world";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];
const WORKTREE = "/worktrees/review-api-12-20260930120000";

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * A fixture repo with a known diff: `main`, then a PR branch that edits
 * retry.ts, adds backoff.ts, deletes notes.txt and moves the README.
 */
function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "nico-agent-diff-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  write(root, {
    "src/retry.ts": "export function retry(call) {\n  return call();\n}\n\nexport const LIMIT = 3;\n",
    "notes.txt": "first\nsecond\n",
    "README.md": "# api\n\nAn API that retries.\nIt never gives up.\n",
  });
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "agent/api-7");
  write(root, {
    "src/retry.ts": "export function retry(call) {\n  return backoff(call);\n}\n\nexport const LIMIT = 3;\n",
    "src/backoff.ts": "export function backoff(call) {\n  return call();\n}\n",
  });
  git(root, "rm", "-q", "notes.txt");
  git(root, "mv", "README.md", "API.md");
  git(root, "add", ".");
  git(root, "commit", "-qm", "backoff");
  return root;
}

/** A Review partner on acme/api#12 whose checkout holds the fixture repo's diff. */
async function reviewing() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  ctx.world.addPr({ repo: "acme/api", number: 12, title: "Retry with backoff", headBranch: "agent/api-7" });
  await ctx.cli("partner", "start", "review", "--pr", "acme/api#12", ...FLAGS);
  ctx.world.diffs.set(WORKTREE, await new RealWorld().gitDiff(fixtureRepo(), "main"));
  return ctx;
}

describe("the Review partner's diff", () => {
  test("is read from its checkout against the PR's base, file by file, with each line's numbers", async () => {
    const { web, world } = await reviewing();
    world.calls.length = 0;
    const response = await web("/api/partner/diff?tab=review");
    expect(response.status).toBe(200);
    expect(world.calls).toEqual([`git -C ${WORKTREE} diff origin/main...HEAD`]);
    const { diff, base, files } = JSON.parse(response.body) as { diff: string; base: string; files: DiffFile[] };
    expect(diff).toBe("4 files, +4 −3");
    expect(base).toBe("main");
    expect(files.map((f) => [f.status, f.path, f.from, f.additions, f.deletions])).toEqual([
      ["renamed", "API.md", "README.md", 0, 0],
      ["deleted", "notes.txt", undefined, 0, 2],
      ["added", "src/backoff.ts", undefined, 3, 0],
      ["modified", "src/retry.ts", undefined, 1, 1],
    ]);
    const retry = files.find((f) => f.path === "src/retry.ts")!;
    expect(retry.hunks).toEqual([{
      header: "@@ -1,5 +1,5 @@",
      lines: [
        { kind: "context", text: "export function retry(call) {", old: 1, new: 1 },
        { kind: "del", text: "  return call();", old: 2 },
        { kind: "add", text: "  return backoff(call);", new: 2 },
        { kind: "context", text: "}", old: 3, new: 3 },
        { kind: "context", text: "", old: 4, new: 4 },
        { kind: "context", text: "export const LIMIT = 3;", old: 5, new: 5 },
      ],
    }]);
  });

  test("an Idea partner has no PR, so no diff", async () => {
    const { cli, web } = await reviewing();
    await cli("partner", "start", "idea", "--repo", "acme/api", ...FLAGS);
    const response = await web("/api/partner/diff?tab=idea");
    expect(JSON.parse(response.body).error).toBe("the Idea partner reviews no PR, so it has no diff");
  });

  test("before its worktree exists there is nothing to read yet", async () => {
    const { cli, world } = await reviewing();
    await cli("partner", "end", "review");
    world.callFailures.set("herdr worktree create", "boom");
    await cli("partner", "start", "review", "--pr", "acme/api#12", ...FLAGS);
    const diff = await cli("partner", "diff", "review", "--json");
    expect(diff.exitCode).toBe(1);
    expect(diff.json().error).toBe("the Review partner has no worktree yet");
  });
});
