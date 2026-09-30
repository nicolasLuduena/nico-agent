import type { Repo } from "./config";
import type { Dispatch } from "./state";
import type { GitHubIssue, World } from "./world";
import { READY_LABEL, WorldError } from "./world";

export interface BoardIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
}

export interface Board {
  ready: BoardIssue[];
  inFlight: Dispatch[];
  errors: { repo: string; error: string }[];
}

/**
 * Ready: open, labelled `ready-for-agent`, unassigned or assigned only to the
 * user, and every Blocker closed.
 */
export function isReady(issue: GitHubIssue, viewer: string) {
  return (
    issue.state === "open" &&
    issue.labels.includes(READY_LABEL) &&
    issue.assignees.every((login) => login.toLowerCase() === viewer.toLowerCase()) &&
    issue.blockers.every((blocker) => blocker.state === "closed")
  );
}

/** Ready issues of every Repo, minus those In flight, which are listed apart. */
export async function loadBoard(world: World, repos: Repo[], inFlight: Dispatch[]): Promise<Board> {
  const board: Board = { ready: [], inFlight, errors: [] };
  if (repos.length === 0) return board;
  const dispatched = new Set(inFlight.map((d) => d.issue));
  let viewer: string;
  try {
    viewer = await world.githubViewer();
  } catch (e) {
    const error = worldErrorMessage(e);
    return { ready: [], inFlight, errors: repos.map((r) => ({ repo: r.slug, error })) };
  }
  const results = await Promise.allSettled(repos.map((repo) => world.githubIssues(repo.slug)));
  results.forEach((result, i) => {
    const repo = repos[i]!;
    if (result.status === "rejected") {
      board.errors.push({ repo: repo.slug, error: worldErrorMessage(result.reason) });
      return;
    }
    const ready = result.value
      .filter((issue) => isReady(issue, viewer) && !dispatched.has(`${repo.slug}#${issue.number}`))
      .sort((a, b) => a.number - b.number);
    board.ready.push(...ready.map(({ number, title, url }) => ({ repo: repo.slug, number, title, url })));
  });
  return board;
}

/** The message of an adapter failure; anything else is a bug and propagates. */
function worldErrorMessage(e: unknown) {
  if (e instanceof WorldError) return e.message;
  throw e;
}
