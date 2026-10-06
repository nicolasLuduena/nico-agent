import { type BlockerPrs, everyBlocker, stackChoice, stackable } from "./board";
import { DispatchError } from "./dispatch";
import { linearIdentifier } from "./linear";
import { sameSlug } from "./slug";
import { linearPullRequests } from "./stage";
import type { PullRequest, World } from "./world";

/** An open PR in a Repo a Stacked dispatch starts on, and the issue it was named by, if any. */
export interface StackTarget {
  issue?: string;
  pr: PullRequest & { headBranch: string };
}

const BOARD = "Run `nico-agent` to see the Board";

/**
 * The PR a Stacked dispatch into `repo` starts on (see GLOSSARY.md, Stacked
 * dispatch): the one `choice` names, by its issue or its PR URL, else a
 * Blocker's only PR. Every unresolved Blocker's PR must be that PR or below
 * it in its Stack. Undefined for a dispatch that is not Stacked.
 */
export async function chooseStackTarget(
  world: World,
  key: string,
  repo: string,
  blockers: BlockerPrs[],
  choice: string | undefined,
  noBlockerPrs: () => DispatchError,
): Promise<StackTarget | undefined> {
  let target: StackTarget;
  if (choice) {
    target = await resolveStackTarget(world, repo, choice);
  } else {
    if (!blockers.length) return undefined;
    const options = everyBlocker(blockers);
    if (!options.length) throw noBlockerPrs();
    if (options.length > 1) {
      const help = options.map((o) => `Stack on ${o.pr.url} with \`--stack-on ${stackChoice(o, options)}\``);
      throw new DispatchError(`${key} needs a unique Blocker choice with --stack-on`, help);
    }
    target = { issue: options[0]!.blocker, pr: options[0]!.pr };
  }
  await requireBlockersBelow(world, key, repo, target, blockers);
  return target;
}

/**
 * The open PR in `repo` that `choice` names: a PR URL, or an issue (a number
 * in the Repo, `owner/repo#N`, a GitHub issue URL, a Linear identifier or URL)
 * with exactly one open PR in the Repo.
 */
async function resolveStackTarget(world: World, repo: string, choice: string): Promise<StackTarget> {
  const pull = choice.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/i);
  if (pull) {
    const [, slug, digits] = pull as unknown as [string, string, string];
    if (!sameSlug(slug, repo)) {
      throw new DispatchError(`${choice} is a PR in another Repo than ${repo}`, [`Pass \`--stack-on\` an open PR in ${repo}`, BOARD]);
    }
    const pr = await world.githubPullRequest(repo, Number(digits));
    if (!pr) throw new DispatchError(`${choice} was not found on GitHub`, [`Check the PR number on https://github.com/${repo}/pulls`]);
    if (pr.state !== "open") {
      throw new DispatchError(`${choice} is ${pr.state}; only an open PR can be stacked on`, [`Pass \`--stack-on\` an open PR in ${repo}`, BOARD]);
    }
    if (!pr.headBranch) {
      throw new DispatchError(`${choice} comes from another repository, so its head can't be fetched from ${repo}`, [`Pass \`--stack-on\` an open PR in ${repo}`]);
    }
    return { pr: pr as StackTarget["pr"] };
  }
  const issue = stackIssue(repo, choice);
  const prs = stackable(!("slug" in issue)
    ? await linearPullRequests(world, issue.identifier, repo)
    : await world.githubLinkedPullRequests(issue.slug, issue.number), repo);
  if (!prs.length) {
    throw new DispatchError(`${issue.key} has no open PR in ${repo} to stack on`, [
      `Pass \`--stack-on\` an issue with an open PR in ${repo}, or the PR's URL`,
      BOARD,
    ]);
  }
  if (prs.length > 1) {
    throw new DispatchError(`${issue.key} has several open PRs in ${repo}; choose one by its URL with --stack-on`,
      prs.map((pr) => `Stack on ${pr.url} with \`--stack-on ${pr.url}\``));
  }
  return { issue: issue.key, pr: prs[0]! };
}

/** The issue a `--stack-on` choice names; a bare number is an issue of `repo`. */
function stackIssue(repo: string, choice: string):
  { key: string; identifier: string } | { key: string; identifier?: undefined; slug: string; number: number } {
  const identifier = linearIdentifier(choice);
  if (identifier) return { key: identifier, identifier };
  const match = choice.match(/^(\d+)$/)
    ? [choice, repo, choice]
    : choice.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/) ??
      choice.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i);
  if (!match) {
    throw new DispatchError(`\`${choice}\` is not an issue or PR reference`, [
      "Pass `--stack-on` an issue number, `owner/repo#N`, a GitHub issue or PR URL, or a Linear identifier",
    ], true);
  }
  const [, slug, digits] = match as unknown as [string, string, string];
  return { key: `${slug}#${digits}`, slug, number: Number(digits) };
}

/** Refuse `target` unless each Blocker has a PR that is it or below it in its Stack. */
async function requireBlockersBelow(world: World, key: string, repo: string, target: StackTarget, blockers: BlockerPrs[]) {
  const isTarget = (pr: PullRequest) => pr.number === target.pr.number;
  let pending = blockers.filter((b) => !b.prs.some(isTarget));
  if (!pending.length) return;
  const stack = await stackBelow(world, repo, target.pr);
  pending = pending.filter((b) => !b.prs.some((pr) => stack.some((s) => s.number === pr.number)));
  if (!pending.length) return;
  const names = pending.map((b) => b.blocker).join(", ");
  throw new DispatchError(`${key} can't stack on ${target.pr.url}: no PR of its Blocker${pending.length > 1 ? "s" : ""} ${names} is in that PR's Stack at or below it`, [
    ...pending.flatMap((b) => b.prs.map((pr) => `Stack on ${pr.url}, or on a PR above it, with \`--stack-on ${pr.url}\``)),
    BOARD,
  ]);
}

/** The open PRs of `repo` below `pr` in its Stack, walking down through base branches. */
async function stackBelow(world: World, repo: string, pr: PullRequest): Promise<PullRequest[]> {
  const below: PullRequest[] = [];
  const seen = new Set([pr.number]);
  for (let current = pr; ;) {
    const next = stackable(await world.githubBranchPullRequests(repo, current.baseBranch), repo).find((p) => !seen.has(p.number));
    if (!next) return below;
    below.push(next);
    seen.add(next.number);
    current = next;
  }
}
