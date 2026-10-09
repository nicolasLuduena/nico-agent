import { DEFAULT_MAX_IMPLEMENTERS_PER_SPEC, DEFAULT_MAX_RUNNING_SPECS, type Repo } from "./config";
import { sameSlug } from "./slug";
import type { SourceAdapter, SourceIssue } from "./source";
import { type InFlightRow, linkedPr } from "./stage";
import { type IssueFacts, type RepoDecision, type RepoFacts, type SpecFacts, decideSpecs } from "./spec";
import { type PullRequest, type World, worldErrorMessage } from "./world";

/** One Repo's issues from one Source, and how to read them. */
export interface SourceIssues<I extends SourceIssue = SourceIssue> {
  repo: Repo;
  adapter: SourceAdapter<I>;
  issues: I[];
  /** The user, as the Source knows them, for whether an issue is free to take. */
  viewer: string;
}

export interface LoadedSpecs {
  /** Each Repo's Specs as the Spec rules decide them; Repos without Specs are left out. */
  specs: RepoDecision[];
  /** Open issues with an open or merged PR but no Dispatch In flight, as each Repo names them: no longer Ready, though no Stage tracks them. */
  prs: { repo: string; issue: string; pr: PullRequest }[];
  errors: { repo: string; error: string; source?: "Linear" | "git" }[];
}

/**
 * Gather the facts the Spec rules need from every Source of each Repo, so the
 * rules see the Repo whole, and decide its Specs.
 */
export async function loadSpecs(world: World, sources: SourceIssues<any>[], inFlight: InFlightRow[]): Promise<LoadedSpecs> {
  const loaded: LoadedSpecs = { specs: [], prs: [], errors: [] };
  const byRepo = new Map<Repo, SpecFacts[]>();
  const results = await Promise.allSettled(sources.map((s) => specFacts(world, s, inFlight)));
  results.forEach((result, i) => {
    const { repo, adapter } = sources[i]!;
    if (result.status === "fulfilled") byRepo.set(repo, [...(byRepo.get(repo) ?? []), ...result.value]);
    else loaded.errors.push({ repo: repo.slug, ...(adapter.source && { source: adapter.source }), error: worldErrorMessage(result.reason) });
  });
  for (const [repo, specs] of byRepo) {
    for (const i of specs.flatMap((s) => s.issues)) {
      if (!i.closed && !i.inFlight && i.pr && !loaded.prs.some((p) => p.repo === repo.slug && p.issue === i.issue)) loaded.prs.push({ repo: repo.slug, issue: i.issue, pr: i.pr });
    }
  }
  const facts = await Promise.allSettled([...byRepo].map(async ([repo, specs]): Promise<RepoFacts> => ({
    repo: repo.slug, defaultBranch: repo.base ?? await world.gitDefaultBranch(repo.path), maxRunningSpecs: repo.maxRunningSpecs ?? DEFAULT_MAX_RUNNING_SPECS,
    maxImplementersPerSpec: repo.maxImplementersPerSpec ?? DEFAULT_MAX_IMPLEMENTERS_PER_SPEC,
    specs: specs.sort((a, b) => a.spec.localeCompare(b.spec, undefined, { numeric: true })),
  })));
  const repos: RepoFacts[] = [];
  facts.forEach((result, i) => {
    const repo = [...byRepo.keys()][i]!;
    if (result.status === "fulfilled") repos.push(result.value);
    else loaded.errors.push({ repo: repo.slug, source: "git", error: worldErrorMessage(result.reason) });
  });
  loaded.specs = decideSpecs(repos).filter((r) => r.specs.length > 0);
  return loaded;
}

/**
 * The facts the Spec rules need about a Repo's Specs from one Source: those
 * its issues belong to, those they are, and its loose issues and loose
 * In-flight Dispatches as Specs of one.
 */
async function specFacts<I extends SourceIssue>(world: World, { repo, adapter, issues, viewer }: SourceIssues<I>, rows: InFlightRow[]): Promise<SpecFacts[]> {
  const inFlight = rows.filter((row) => sameSlug(row.dispatch.repo, repo.slug) && adapter.owns(row.dispatch));
  const rowOf = (name: string) => inFlight.find((r) => sameSlug(r.dispatch.issue, name));
  const facts = async (issue: I): Promise<IssueFacts> => {
    const name = adapter.name(issue);
    const row = rowOf(name);
    return {
      issue: name, closed: adapter.closed(issue), startable: adapter.startable(issue, viewer), inFlight: row !== undefined,
      pr: row ? row.pr : linkedPr(await adapter.linkedPrs(name), repo.slug),
      blockers: adapter.blockers(issue),
      ...(row && await holdFacts(world, row)),
    };
  };
  const parents = new Set(issues.flatMap((i) => adapter.isSpec(i) ? [adapter.name(i)] : adapter.parent(i) ?? []));
  const specs: SpecFacts[] = await Promise.all([...parents].map(async (spec) => {
    const { parent, subIssues } = await adapter.spec(spec, issues);
    return { spec, title: parent?.title ?? spec, url: parent?.url ?? "", issues: await Promise.all(subIssues.map(facts)) };
  }));
  const inSpec = new Set(specs.flatMap((s) => s.issues.map((i) => i.issue)));
  const loose = issues.filter((i) => !adapter.parent(i) && !adapter.isSpec(i) && (adapter.startable(i, viewer) || rowOf(adapter.name(i))));
  for (const issue of loose) specs.push({ spec: adapter.name(issue), title: issue.title, url: issue.url, issues: [await facts(issue)] });
  for (const row of inFlight) {
    if (inSpec.has(row.dispatch.issue) || specs.some((s) => s.spec === row.dispatch.issue)) continue;
    specs.push(await looseInFlight(world, row));
  }
  return specs;
}

/** A Dispatch In flight whose issue was found in no Spec counts as a Spec of one. */
async function looseInFlight(world: World, row: InFlightRow): Promise<SpecFacts> {
  const { issue, title, url } = row.dispatch;
  return { spec: issue, title, url, issues: [{ issue, closed: false, startable: false, inFlight: true, pr: row.pr, blockers: [], ...await holdFacts(world, row) }] };
}

/** What an In-flight Dispatch tells the Spec rules about holds. */
async function holdFacts(world: World, row: InFlightRow): Promise<Pick<IssueFacts, "failed" | "builtOnClosedPr">> {
  const { failure, stackedOn, repo } = row.dispatch;
  if (failure) return { failed: { step: failure.step, error: failure.error } };
  if (!stackedOn) return {};
  // The Stack under the Dispatch's own open PR, else under the PR it was dispatched on.
  const from = row.pr?.state === "open" ? row.pr.baseBranch : stackedOn.pr.headBranch;
  const builtOnClosedPr = await closedBelow(world, repo, from);
  return builtOnClosedPr ? { builtOnClosedPr } : {};
}

/**
 * The PR closed without merging that a Stack is built on, walking down from
 * `branch` through the head branches of its PRs; undefined once the walk
 * reaches a branch without an open PR on it, such as the default branch.
 */
async function closedBelow(world: World, repo: string, branch: string): Promise<PullRequest | undefined> {
  const seen = new Set<string>();
  while (!seen.has(branch)) {
    seen.add(branch);
    const prs = (await world.githubBranchPullRequests(repo, branch)).filter((pr) => sameSlug(pr.repo, repo));
    const open = prs.find((pr) => pr.state === "open");
    if (!open) return prs.at(-1)?.state === "closed" ? prs.at(-1) : undefined;
    branch = open.baseBranch;
  }
  return undefined;
}
