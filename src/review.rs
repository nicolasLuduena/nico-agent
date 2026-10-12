//! The tick's Reviewers: one started in a Dispatch's workspace and worktree
//! when its PR first appears, and again for each new head, prompted to
//! re-run the Repo's verification and record a Verdict with `verdict`.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::bucket;
use crate::cli::{Context, Refusal};
use crate::config::{Config, fill_in};
use crate::dispatch::{self, Dispatch};
use crate::launch::{self, AgentLaunch};
use crate::stage::{self, Pr, Stage, Standing};
use crate::verdict::Outcome;
use crate::world::{self, Agent, AgentState};

/// A Dispatch's latest Reviewer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reviewer {
    #[serde(flatten)]
    pub launch: AgentLaunch,
    /// The PR head it was prompted for; unset while its launch has not got that far.
    pub sha: Option<String>,
    /// The head of each Reviewer start that came to nothing: it failed, or
    /// its Reviewer left herdr before its Verdict.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<String>,
}

/// (5) Start a Reviewer for each live Dispatch whose open PR has a head with
/// no Verdict and no Reviewer prompted for it still in herdr's `agents`;
/// behind the `review` switch. A launch that fails is said and tried again
/// next tick, in a fresh tab. Without `agents`, a prompted Reviewer stands.
/// A Reviewer herdr reports working is never closed: the next head waits for it.
/// A head's starts that fail or whose Reviewer leaves herdr are tried again
/// `max_restarts_per_reason` times, then the user is told, once.
pub fn start_reviewers(
    ctx: &Context,
    config: &Config,
    agents: Option<&[Agent]>,
) -> Result<Vec<String>, Refusal> {
    let prs = stage::load(&ctx.config_dir)?;
    let mut said = vec![];
    let live = dispatch::load(&ctx.config_dir)?.into_iter();
    for d in live.filter(|d| d.closed_at.is_none()) {
        let repo = config.repo_of(&d);
        if !repo.switches.review {
            continue;
        }
        let standing = stage::standing(&ctx.config_dir, &prs, &d)?;
        let Some((url, pr)) = standing.pr else {
            continue;
        };
        let gone = |r: &&Reviewer| {
            agents.is_some_and(|a| world::agent_state(a, &r.launch.agent).is_none())
        };
        let prompted = (d.reviewer.as_ref())
            .filter(|r| !gone(r))
            .and_then(|r| r.sha.as_ref());
        if standing.stage != Stage::PrDraft
            || standing.verdict_on_head().is_some()
            || prompted == Some(&pr.head_sha)
        {
            continue;
        }
        // A start that failed but took its prompt after all (sent by hand),
        // or a Reviewer still on an older head.
        let working = |r: &Reviewer| {
            agents.and_then(|a| world::agent_state(a, &r.launch.agent)) == Some(AgentState::Working)
        };
        if d.reviewer.as_ref().is_some_and(working) {
            continue;
        }
        let head = &pr.head_sha;
        let cap = config.max_restarts_per_reason as usize;
        let of_head = |failures: &[String]| failures.iter().filter(|sha| *sha == head).count();
        let mut reviewer = d.reviewer.clone();
        let mut failures = (reviewer.as_ref()).map_or(vec![], |r| r.failures.clone());
        // Past the cap: the user was told as it was passed.
        if of_head(&failures) > cap {
            continue;
        }
        // Prompted for this head, and gone from herdr before its Verdict.
        if reviewer.as_ref().and_then(|r| r.sha.as_ref()) == Some(head) {
            failures.push(head.clone());
        }
        if of_head(&failures) <= cap {
            // Its agent name is taken until the last Reviewer's tab is closed.
            if let Some(tab) = reviewer.as_ref().and_then(|r| r.launch.tab.as_ref())
                && let Err(e) = ctx.world.herdr_tab_close(tab)
            {
                said.push(format!(
                    "could not close the last Reviewer of {}: {e}",
                    d.issue
                ));
                continue;
            }
            let chosen = config.reviewer(&repo, &d.implementer.harness);
            let mut started = Reviewer {
                launch: AgentLaunch {
                    agent: launch::agent_name("rev", &d.repo, &d.issue),
                    harness: chosen.harness,
                    model: chosen.model,
                    effort: chosen.effort,
                    tab: None,
                    pane: None,
                },
                sha: None,
                failures: vec![],
            };
            match start(ctx, config, &repo.path, &d, &mut started.launch, url, pr) {
                Ok(()) => {
                    said.push(format!(
                        "{}: Reviewer started on {} for {head}",
                        d.issue, started.launch.harness
                    ));
                    started.sha = Some(head.clone());
                }
                Err(no) => {
                    said.push(format!(
                        "could not start the Reviewer of {}: {}",
                        d.issue, no.error
                    ));
                    failures.push(head.clone());
                }
            }
            reviewer = Some(started);
        }
        if of_head(&failures) > cap {
            said.extend(stop(ctx, &d.issue, head, of_head(&failures)));
        }
        dispatch::update(&ctx.config_dir, |all| {
            if let Some(live) = all.iter_mut().find(|l| dispatch::is_live(l, &d.issue)) {
                live.reviewer = reviewer.map(|r| Reviewer { failures, ..r });
            }
        })?;
    }
    Ok(said)
}

/// Where the review of `d`'s PR stands for its head, as `status` shows it,
/// by the rules [`start_reviewers`] starts Reviewers on; `agents` as herdr
/// listed them, if it did. `None` unless `d` is live and its Stage PR draft
/// or Verified: no Reviewer is started for any other.
pub fn shown(
    config: &Config,
    d: &Dispatch,
    standing: &Standing,
    agents: Option<&[Agent]>,
) -> Option<Value> {
    let reviewed =
        d.closed_at.is_none() && matches!(standing.stage, Stage::PrDraft | Stage::Verified);
    let (_, pr) = standing.pr.filter(|_| reviewed)?;
    let head = &pr.head_sha;
    let reviewer = d.reviewer.as_ref();
    // herdr's Agent state of the Reviewer prompted for the head: `None` once it
    // left herdr, `Unknown` while herdr does not say, which leaves it standing, as the tick does.
    let prompted = (reviewer.filter(|r| r.sha.as_ref() == Some(head))).map(|r| {
        agents.map_or(Some(AgentState::Unknown), |a| {
            world::agent_state(a, &r.launch.agent)
        })
    });
    let cap = config.max_restarts_per_reason as usize;
    let mut attempts = reviewer.map_or(0, |r| r.failures.iter().filter(|sha| *sha == head).count());
    // Gone before its Verdict: the next tick counts it, unless it gave up on the head already.
    if prompted == Some(None) && attempts <= cap {
        attempts += 1;
    }
    let state = match (standing.verdict_on_head(), prompted.flatten()) {
        _ if !config.repo_of(d).switches.review => "off",
        (Some(v), _) if v.result == Outcome::Pass => "passed",
        (Some(_), _) => "failed",
        // Past the cap none starts for the head: one still prompted for it is one that left.
        _ if attempts > cap => "gave_up",
        (None, Some(AgentState::Working | AgentState::Unknown)) => "reviewing",
        (None, Some(_)) => "stopped",
        _ if attempts > 0 => "retrying",
        _ => "waiting",
    };
    Some(json!({
        "state": state,
        "sha": head,
        "harness": reviewer.map(|r| &r.launch.harness),
        "attempts": attempts,
        "cap": cap,
    }))
}

/// Say that the Reviewer of `issue` for `head` failed to start or left
/// herdr before a Verdict `times` times, and tell the user.
fn stop(ctx: &Context, issue: &str, head: &str, times: usize) -> Vec<String> {
    let title = format!("{issue} Reviewer stopped");
    let what = format!("failed to start or left herdr before a Verdict {times} times");
    let body = format!(
        "Its Reviewer for {head} {what}. Review the PR by hand and record it with `nico-agent verdict {issue} pass|fail --sha {head}`."
    );
    let said = format!("{issue}: its Reviewer for {head} {what}; not started again for it");
    // Once: a failed notification is said, not tried again.
    let failed = (ctx.world.notify(&title, &body))
        .err()
        .map(|e| format!("could not notify \"{title}\": {e}"));
    [said].into_iter().chain(failed).collect()
}

/// Open the Reviewer's tab in the Dispatch's worktree, start its Harness
/// there and prompt it for the PR's head.
fn start(
    ctx: &Context,
    config: &Config,
    repo_path: &str,
    d: &Dispatch,
    reviewer: &mut AgentLaunch,
    url: &str,
    pr: &Pr,
) -> Result<(), Refusal> {
    let made = "a Dispatch with a PR has its worktree";
    let (workspace, worktree) = (
        d.workspace.as_ref().expect(made),
        d.worktree.as_ref().expect(made),
    );
    let harness = &config.harnesses[&reviewer.harness];
    launch::open_tab(ctx.world, reviewer, workspace, worktree, "reviewer")?;
    let ready = launch::start(ctx.world, harness, reviewer, repo_path)?;
    launch::get_ready(ctx.world, harness, reviewer, worktree, ready)?;
    let values = [
        ("sigil", harness.sigil.as_str()),
        ("prUrl", url),
        ("issueUrl", &d.url),
        ("issue", &d.issue),
        ("headSha", &pr.head_sha),
        ("evidenceFolder", &bucket::evidence(d)),
    ];
    let text = fill_in(&config.prompts.review, &values);
    launch::prompt(ctx.world, harness, &reviewer.agent, &text)
}
