# The weekly retro

Once a week you look back over the PRs merged across the Repos and propose changes to the agents' environment, so the next week's Implementers and Reviewers work in a better one. Every change is a Proposal the user approves or declines in one click; you write nothing to a Repo without an approved one, whatever the `write` order says.

The `retro` skill beside this one carries the method. Read its `SKILL.md` (it does not load by name) for its categories and its Reference, and follow this page wherever the two differ: it looks back at merged PRs, not a session, and it ends in Proposals, not a list for the user. When `retro` is not beside this skill, `say` `Weekly retro, week of <Monday>. Skipped: the retro skill is missing; add the nico-agent checkout as a Repo.` and stop.

## 1. Gather the week's merged PRs

The window is the one The weekly retro, in your skill, sets. For each Repo in `nico-agent repo list --json`, in its clone (its `path`), list the PRs merged in the window:

```sh
gh pr list --state merged --search "merged:>=<the window's start date>" --json number,title,url,mergedAt --limit 100
```

Keep the ones whose `mergedAt` falls in the window. For each, read what shows where the agent went wrong or slow:

- `gh pr view <url> --json body,reviews,comments,commits`: the reviews that requested changes, the comments, and the commits pushed after the first review (each is a fix someone had to ask for);
- its review threads, with the query under PRs in your skill, the resolved ones too;
- the `event` entries for it in the window (`recall` the PR's URL with `since`): the checks that failed before it merged.

Done when every Repo is listed and every PR merged in the window is read. A week with no merged PRs ends here: `say` `Weekly retro, week of <Monday>. No PRs merged.`

## 2. Find the changes

Run the `retro` skill's step 3 over what you read, every category in its order, each in the clone of the Repo whose PRs showed the problem.

Keep only changes to the environment, never to the code: a navigation pointer, an automated check, a coding standard, a steering file, tooling, access to information. A bug a PR shipped, a refactor it calls for, or a missing test for one feature is code; leave it out, or name it in your summary for the user to file.

Keep a change only when a PR in the window shows the problem, and name those PRs by URL.

Then leave out what the user has already settled. Drop a change that matches, for the same Repo:

- an open Proposal in `orient`: it waits on the user already;
- a declined one: `recall` `Weekly retro` finds every `decision` on a retro Proposal, its `reason` yours, its `text` the user's. Propose it again only when the user's text names something that has since changed, and say what changed in the reason;
- a line of the Notes: a decline that holds for every week ("we never gate on coverage") lives there.

## 3. Propose each one

Every change you kept is its own Proposal, so the user decides each in one click: call `propose` with `write`, `repo` the Repo as the Board names it. Its `text` is the ticket you would file on the Repo's Source, in the Repo's own words (its `GLOSSARY.md`, its issue tracker doc):

```markdown
# <the change, as a ticket title>

## What to build

<the change: which file or check, and what it says or catches>

## Why

<what went wrong, each PR by URL, and how this change would have caught or prevented it>

## Acceptance criteria

- [ ] <how to tell it is in place>
```

Its `reason` starts `Weekly retro, week of <Monday>:` and says in one sentence what the change prevents and which PRs showed it. Done when each kept change has its Proposal id.

## 4. Sum it up

`say` once:

"Weekly retro, week of 2026-10-05. I read 6 PRs merged in acme/api and acme/web. Proposed: 7, a lint rule against floating promises (https://github.com/acme/api/pull/9, https://github.com/acme/api/pull/12); 8, a pointer from AGENTS.md to docs/billing.md (https://github.com/acme/web/pull/4). Left out: the coverage gate you declined in Proposal 3. Decide them with `nico-agent proposals`."

Name each Proposal by id with the PRs that motivated it, and each change you left out with the reason.

## When the user decides

The `decision` arrives in your Inbox with the `write`:

- **Approved**: file the ticket on the Repo's Source, as `SHAPING.md` publishes an approved write: in the Repo's clone, following its `AGENTS.md` and issue tracker doc, labelled `ready-for-agent`, exactly the text approved. Then `say` its URL: the change reaches the Repo through an Implementer's PR like any other issue.
- **Declined**: file nothing. When the user's reason will hold for every week, note it in the Notes.
