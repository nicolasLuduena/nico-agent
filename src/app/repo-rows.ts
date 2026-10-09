import { sameSlug } from "../slug";
import { sameSpec } from "../spec";
import { type DispatchTarget, canReview, dispatchTarget } from "./actions";
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
  /** A Reviewer can be launched: its PR is linked and none was started. */
  review: boolean;
  /** Close asks first: it has no PR yet, so it is still Implementing. */
  confirmClose: boolean;
}

/** A Ready or Stackable issue, with what its dispatch form offers. */
export interface IssueLine extends Named {
  kind: "ready" | "stackable";
  target: DispatchTarget;
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
  /** Its Ready and Stackable issues, to dispatch. */
  issues: IssueLine[];
  /** It loaded and has nothing In flight, Held, to start or to dispatch. */
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

    const flights = mine(board.dispatches);
    const dispatches = flights.map((d): DispatchLine => {
      const asking = d.implementer === ASKING ? board.asking?.find((a) => a.issue === d.issue) : undefined;
      const question = asking && (asking.error ? `Could not read its screen: ${asking.error}` : asking.question);
      return {
        issue: d.issue, ...named(d.issue, d.title, d.url), stage: d.stage, agent: d.implementer,
        ...(d.pr && { pr: prOf(d.pr) }),
        ...(question && { question }),
        review: canReview(d), confirmClose: !d.pr,
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
    const toDispatch = (kind: IssueLine["kind"], items: (Omit<Named, "label"> & { issue: string })[]) => items.flatMap((i): IssueLine[] => {
      const target = !flights.some((d) => sameSlug(d.issue, i.issue)) && dispatchTarget(board, i.issue, repo);
      return target ? [{ kind, ...named(i.issue, i.title, i.url), target }] : [];
    });
    const dispatchable = [...toDispatch("ready", mine(board.issues)), ...toDispatch("stackable", mine(board.stackable))];
    const nothing = !dispatches.length && !held.length && !next.length && !queue.length && !dispatchable.length;
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
      issues: dispatchable,
      empty: !errors.length && nothing,
    };
  });
}
