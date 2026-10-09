import { sameSlug } from "../slug";
import { sameSpec } from "../spec";
import { type BoardJson, prOf, repoKey, repoSections } from "./board";

/** An issue or Spec as a row names it: its key, labelled within the Repo, its title and its link. */
interface Named {
  label: string;
  title: string;
  url: string;
}

/** An In-flight Dispatch as its Repo's row lists it. */
export interface DispatchLine extends Named {
  issue: string;
  stage: string;
  /** Its Implementer's Agent state. */
  agent: string;
  pr?: { url: string; number: number };
  /** What an Asking Implementer's screen shows, or why it could not be read. */
  question?: string;
}

/** A Held Spec and why `advance` holds it. */
export interface HeldLine extends Named {
  spec: string;
  reason: string;
}

/** A running Spec's next issue, which `advance` dispatches once its Implementer is free. */
export interface NextLine extends Named {
  spec: string;
  specLabel: string;
  specTitle: string;
  issue: string;
}

/** A Spec in the Repo's Queue. */
export interface QueuedLine extends Named {
  spec: string;
}

/** A Repo's row in the Repos pane: a summary while collapsed, its In-flight work, Held Specs and what starts next once expanded. */
export interface RepoRow {
  repo: string;
  errors: string[];
  summary: { inFlight: number; asking: number; held: number };
  dispatches: DispatchLine[];
  held: HeldLine[];
  next: NextLine[];
  /** Its Queue, head first. */
  queue: QueuedLine[];
  /** It loaded and has nothing In flight, Held or to start. */
  empty: boolean;
}

/** The Agent state of an Implementer that is Asking. */
const ASKING = "blocked";

/** A row per configured Repo, in config order, from the same Board the app's Board model reads. */
export function repoRows(board: BoardJson): RepoRow[] {
  return repoSections(board).map(({ repo, errors: failed }) => {
    const mine = <T extends { repo: string }>(items: T[] = []) => items.filter((i) => sameSlug(i.repo, repo));
    const specs = mine(board.specs);
    const issues = [...mine(board.issues), ...mine(board.stackable), ...mine(board.prOpen)];
    const named = (key: string, title?: string, url?: string): Named => {
      const issue = issues.find((i) => i.issue === key);
      return { label: repoKey(key, repo), title: title ?? issue?.title ?? key, url: url ?? issue?.url ?? "" };
    };

    const dispatches = mine(board.dispatches).map((d): DispatchLine => {
      const asking = d.implementer === ASKING ? board.asking?.find((a) => a.issue === d.issue) : undefined;
      const question = asking && (asking.error ? `Could not read its screen: ${asking.error}` : asking.question);
      return {
        issue: d.issue, ...named(d.issue, d.title, d.url), stage: d.stage, agent: d.implementer,
        ...(d.pr && { pr: prOf(d.pr) }),
        ...(question && { question }),
      };
    });
    const held = specs.flatMap((s): HeldLine[] => (s.held ? [{ spec: s.spec, ...named(s.spec, s.title, s.url), reason: s.held.reason }] : []));
    const next = specs.flatMap((s): NextLine[] =>
      s.running && !s.held ? (s.next ?? []).map((n) => ({ spec: s.spec, specLabel: repoKey(s.spec, repo), specTitle: s.title, issue: n.issue, ...named(n.issue) })) : []);
    const room = board.rooms?.find((r) => sameSlug(r.repo, repo));
    const queue = (room?.queue ?? []).map((key): QueuedLine => {
      const spec = specs.find((s) => sameSpec(s.spec, key));
      return { spec: key, ...named(key, spec?.title, spec?.url) };
    });
    const nothing = !dispatches.length && !held.length && !next.length && !queue.length;
    // A rate-limited read is one Board warning, not each Repo's error; a Repo it left with nothing was not read, not Idle.
    const errors = !failed.length && nothing && board.warning ? [`Could not load: ${board.warning}`] : failed;
    return {
      repo,
      errors,
      summary: { inFlight: dispatches.length, asking: dispatches.filter((d) => d.agent === ASKING).length, held: held.length },
      dispatches,
      held,
      next,
      queue,
      empty: !errors.length && nothing,
    };
  });
}
