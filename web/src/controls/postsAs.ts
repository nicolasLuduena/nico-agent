import type { Repo } from "../status";

/** Where the GitHub App is installed on a Repo. */
export const INSTALL_APP = "https://github.com/apps/nicolasluduena-coding-agent/installations/new";

/** What a Repo's panel says of who its agents post as, and where to install the App while they post as you; null before its first checks. */
export function postsAs(repo: Pick<Repo, "posts_as">): { said: string; install: string | null } | null {
  if (!repo.posts_as) return null;
  if (repo.posts_as === "you") return { said: "PRs and comments are posted as you", install: INSTALL_APP };
  return { said: `Agents post as ${repo.posts_as}`, install: null };
}
