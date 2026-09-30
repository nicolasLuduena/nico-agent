import type { LinearSelector, Repo } from "./config";
import { type InFlightRow, type PrLookup, loadInFlight } from "./stage";
import type { Dispatch } from "./state";
import type { GitHubIssue, LinearIssue, World } from "./world";
import { READY_LABEL, WorldError } from "./world";

export type BoardIssue = {
  repo: string;
  title: string;
  url: string;
} & ({ number: number; identifier?: never } | { identifier: string; number?: never });

export interface Board {
  ready: BoardIssue[];
  inFlight: InFlightRow[];
  errors: { repo: string; error: string; source?: "Linear" }[];
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

/** Ready issues of every Repo, minus those In flight, which are listed apart with their Stage. */
export async function loadBoard(world: World, repos: Repo[], dispatches: Dispatch[], prs: PrLookup): Promise<Board> {
  const [ready, inFlight] = await Promise.all([loadReady(world, repos, dispatches), loadInFlight(world, dispatches, prs)]);
  return { ...ready, inFlight };
}

async function loadReady(world: World, repos: Repo[], inFlight: Dispatch[]) {
  const board: Omit<Board, "inFlight"> = { ready: [], errors: [] };
  if (repos.length === 0) return board;
  const dispatched = new Set(inFlight.map((d) => d.issue));
  const github = async () => {
    let viewer: string;
    try { viewer = await world.githubViewer(); }
    catch (e) {
      board.errors.push(...repos.map((r) => ({ repo: r.slug, error: worldErrorMessage(e) })));
      return;
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
  };
  const linear = async () => {
    const selected = repos.filter((r) => r.linear);
    if (!selected.length) return;
    let viewer: string;
    try { viewer = await world.linearViewer(); }
    catch (e) {
      board.errors.push(...selected.map((r) => ({ repo: r.slug, source: "Linear" as const, error: worldErrorMessage(e) })));
      return;
    }
    const teams = [...new Set(selected.map((r) => r.linear!.team))];
    const results = await Promise.allSettled(teams.map((team) => world.linearIssues(team)));
    selected.forEach((repo) => {
      const result = results[teams.indexOf(repo.linear!.team)]!;
      if (result.status === "rejected") {
        board.errors.push({ repo: repo.slug, source: "Linear", error: worldErrorMessage(result.reason) });
        return;
      }
      const ready = result.value.filter((i) => matchesSelector(i, repo.linear!) && isLinearReady(i, viewer) && !dispatched.has(i.identifier));
      ready.sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
      board.ready.push(...ready.map(({ identifier, title, url }) => ({ repo: repo.slug, identifier, title, url })));
    });
  };
  // GitHub rows precede Linear rows.
  await github();
  await linear();
  return board;
}

/** The message of an adapter failure; anything else is a bug and propagates. */
function worldErrorMessage(e: unknown) {
  if (e instanceof WorldError) return e.message;
  throw e;
}

export function matchesSelector(issue: LinearIssue, selector: LinearSelector) {
  return [issue.team.id, issue.team.key, issue.team.name].includes(selector.team) &&
    (!selector.project || (issue.project !== null && [issue.project.id, issue.project.name].includes(selector.project))) &&
    (!selector.label || issue.labels.includes(selector.label));
}

export function isLinearReady(issue: LinearIssue, viewer: string) {
  return ["backlog", "unstarted"].includes(issue.state) && issue.labels.includes(READY_LABEL) &&
    (issue.assignee === null || issue.assignee === viewer) &&
    issue.blockers.every((b) => ["completed", "canceled"].includes(b.state));
}
