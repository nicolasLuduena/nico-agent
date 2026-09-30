/** A separate process adding one Dispatch record, for the concurrency test. */
import { addDispatch } from "../src/state";

const [dir, n] = process.argv.slice(2) as [string, string];
const now = new Date().toISOString();
await addDispatch(dir, {
  issue: `acme/api#${n}`,
  title: `Issue ${n}`,
  url: `https://github.com/acme/api/issues/${n}`,
  repo: "acme/api",
  branch: `agent/api-${n}`,
  base: "origin/main",
  worktree: `/worktrees/api-${n}`,
  workspace: `w${n}`,
  implementer: { tab: `w${n}:t2`, pane: `w${n}:p2`, agent: `impl-api-${n}`, harness: "claude", model: "opus", effort: "high" },
  createdAt: now,
  updatedAt: now,
});
