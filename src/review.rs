//! The tick's Reviewers: one started in a Dispatch's workspace and worktree
//! when its PR first appears, and again for each new head, or by hand from
//! the Board, prompted to re-run the Repo's verification and record a
//! Verdict with `verdict`.

use std::io;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::bucket;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Repo, fill_in};
use crate::dispatch::{self, Dispatch};
use crate::launch::{self, AgentLaunch};
use crate::restart::Reason;
use crate::stage::{self, Pr, Stage, Standing};
use crate::tick;
use crate::verdict::{Outcome, Verdict};
use crate::wiki;
use crate::world::{self, Agent, AgentState, PrState};

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
    /// Started to rule on the Implementer's Rulings: on a head whose failing
    /// Verdict they answered with no push.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rulings: bool,
}

/// Whether `v`, the Verdict on the head of `d`'s PR, is a fail the
/// Implementer answered with Rulings alone: restarted for it before
/// `listed`, when herdr listed `agents`, it went idle in them with the head
/// unchanged, or a Reviewer was started to rule on them.
pub fn answered(d: &Dispatch, v: &Verdict, agents: Option<&[Agent]>, listed: &str) -> bool {
    // Listed before its restart, an idle Implementer has ruled on nothing yet.
    let restarted = (d.restarts.iter())
        .any(|r| r.reason == Reason::Verdict && r.at >= v.at && r.at.as_str() < listed);
    let idle = agents.and_then(|a| world::agent_state(a, &d.implementer.agent));
    let ruling = (d.reviewer.as_ref()).is_some_and(|r| r.rulings && r.sha.as_ref() == Some(&v.sha));
    v.result == Outcome::Fail
        && restarted
        && (ruling || matches!(idle, Some(AgentState::Idle | AgentState::Done)))
}

/// (5) Start a Reviewer for each live Dispatch whose open PR has a head with
/// no Verdict, or a failing one [`answered`] with Rulings alone, and no
/// Reviewer prompted for it still in herdr's `agents`, listed at `listed`;
/// behind the `review` switch. A launch that fails is said and tried again
/// next tick, in a fresh tab. Without `agents`, a prompted Reviewer stands.
/// A Reviewer herdr reports working is never closed: the next head waits for it.
/// Nor does one start while herdr reports the Implementer working: it may push again.
/// A head's starts that fail or whose Reviewer leaves herdr are tried again
/// `max_restarts_per_reason` times, then the user is told, once.
pub fn start_reviewers(
    ctx: &Context,
    config: &Config,
    agents: Option<&[Agent]>,
    listed: &str,
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
        let verdict = standing.verdict_on_head();
        let answered = verdict.is_some_and(|v| answered(&d, v, agents, listed));
        // Once answered, the Reviewer that failed the head is not the one prompted for it.
        let last = (d.reviewer.as_ref()).filter(|r| !answered || r.rulings);
        let prompted = last.filter(|r| !gone(r)).and_then(|r| r.sha.as_ref());
        if standing.stage != Stage::PrDraft
            || (verdict.is_some() && !answered)
            || prompted == Some(&pr.head_sha)
        {
            continue;
        }
        // A start that failed but took its prompt after all (sent by hand),
        // or a Reviewer still on an older head.
        let working = |r: &Reviewer| {
            agents.and_then(|a| world::agent_state(a, &r.launch.agent)) == Some(AgentState::Working)
        };
        let implementing = agents.and_then(|a| world::agent_state(a, &d.implementer.agent))
            == Some(AgentState::Working);
        if implementing || d.reviewer.as_ref().is_some_and(working) {
            continue;
        }
        let head = &pr.head_sha;
        let cap = config.max_restarts_per_reason as usize;
        let of_head = |failures: &[String]| failures.iter().filter(|sha| *sha == head).count();
        let mut failures = (d.reviewer.as_ref()).map_or(vec![], |r| r.failures.clone());
        // Past the cap: the user was told as it was passed.
        if of_head(&failures) > cap {
            continue;
        }
        // Prompted for this head, and gone from herdr before its Verdict.
        if last.and_then(|r| r.sha.as_ref()) == Some(head) {
            failures.push(head.clone());
        }
        if of_head(&failures) <= cap {
            if let Err(line) = close_last(ctx, &d) {
                said.push(line);
                continue;
            }
            let started = start_on_head(ctx, config, &d, url, pr, answered, &mut failures)?;
            said.push(started.unwrap_or_else(|no| no.error));
        } else {
            record(ctx, &d.issue, d.reviewer.clone(), failures.clone())?;
        }
        if of_head(&failures) > cap {
            said.extend(stop(ctx, &d.issue, head, of_head(&failures)));
        }
    }
    Ok(said)
}

/// `POST /api/review {issue}`: start a Reviewer on the head of the issue's
/// PR now, as the tick does but whatever the `review` switch says, the
/// failed starts counted against that head cleared first. Refused, changing
/// nothing, unless the issue is In flight at PR draft with no Verdict on its
/// head and no Reviewer herdr reports working; a start that fails is
/// counted, as the tick's are, and refused.
pub fn now(ctx: &Context, text: &str) -> Result<Value, Refusal> {
    // A tick's own start would race this one, for the same agent name and record.
    let _held = tick::lock(ctx)?.map_err(|pid| {
        Refusal::new(
            format!("a tick is running (pid {pid})"),
            vec!["Try again once it ends: it may start the Reviewer itself".into()],
        )
    })?;
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let issue = dispatch::key(&config, &dispatches, text)?;
    let see_status = || "Run `nico-agent status` to see the Dispatch".to_string();
    let Some(d) = (dispatches.into_iter()).find(|d| dispatch::is_live(d, &issue)) else {
        return Err(Refusal::new(
            format!("{issue} has no live Dispatch"),
            vec![
                "A Reviewer reviews the PR of an issue In flight".into(),
                see_status(),
            ],
        ));
    };
    let prs = stage::load(&ctx.config_dir)?;
    let standing = stage::standing(&ctx.config_dir, &prs, &d)?;
    let Some((url, pr)) = standing.pr.filter(|(_, pr)| pr.state == PrState::Open) else {
        return Err(Refusal::new(
            format!("{issue} has no open PR"),
            vec![
                "A Reviewer reviews the head of an open PR".into(),
                see_status(),
            ],
        ));
    };
    let head = &pr.head_sha;
    if let Some(v) = standing.verdict_on_head() {
        let result = json!(v.result);
        return Err(Refusal::new(
            format!(
                "{head} of {url} already has a Verdict: {}",
                result.as_str().unwrap_or_default()
            ),
            vec!["A push is what asks for a new review: a Reviewer starts on the new head".into()],
        ));
    }
    if standing.stage != Stage::PrDraft {
        let stage = json!(standing.stage);
        return Err(Refusal::new(
            format!(
                "{issue} is {}, not PR draft",
                stage.as_str().unwrap_or_default()
            ),
            vec![
                "A Reviewer starts on the PR of a Dispatch at PR draft".into(),
                see_status(),
            ],
        ));
    }
    let agents = ctx.world.herdr_agents().map_err(|e| {
        Refusal::new(
            format!("could not list herdr's agents: {e}"),
            vec!["Try again once herdr answers".into()],
        )
    })?;
    if let Some(r) = (d.reviewer.as_ref())
        .filter(|r| world::agent_state(&agents, &r.launch.agent) == Some(AgentState::Working))
    {
        return Err(Refusal::new(
            format!("{issue}'s Reviewer {} is working", r.launch.agent),
            vec!["Wait for its Verdict, or stop it in herdr first".into()],
        ));
    }
    close_last(ctx, &d).map_err(|line| Refusal::new(line, vec![]))?;
    let mut failures = (d.reviewer.as_ref()).map_or(vec![], |r| r.failures.clone());
    failures.retain(|sha| sha != head);
    // Said in serve's log as the tick's are. Past a cap of 0 no one is notified: the user sees it.
    let started = start_on_head(ctx, &config, &d, url, pr, false, &mut failures)?;
    ctx.world
        .log(started.as_ref().unwrap_or_else(|no| &no.error));
    Ok(json!({ "review": started? }))
}

/// Close the tab of `d`'s last Reviewer, if it has one: its agent name is
/// taken until then. What to say when herdr could not.
fn close_last(ctx: &Context, d: &Dispatch) -> Result<(), String> {
    let tab = (d.reviewer.as_ref()).and_then(|r| r.launch.tab.as_ref());
    tab.map_or(Ok(()), |tab| ctx.world.herdr_tab_close(tab))
        .map_err(|e| format!("could not close the last Reviewer of {}: {e}", d.issue))
}

/// Start a new Reviewer of `d` on the head of its PR `pr` at `url`, once
/// [`close_last`] closed its last one's tab, to rule on the Implementer's
/// Rulings if `rulings`, and record it on `d` with `failures`, that head
/// added when the start fails: what it says, or why it failed.
fn start_on_head(
    ctx: &Context,
    config: &Config,
    d: &Dispatch,
    url: &str,
    pr: &Pr,
    rulings: bool,
    failures: &mut Vec<String>,
) -> Result<Result<String, Refusal>, Refusal> {
    let repo = config.repo_of(d);
    let head = &pr.head_sha;
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
        rulings,
    };
    let said = match start(ctx, config, &repo, d, &mut started.launch, url, pr) {
        Ok(()) => {
            started.sha = Some(head.clone());
            Ok(format!(
                "{}: Reviewer started on {} for {head}",
                d.issue, started.launch.harness
            ))
        }
        Err(mut no) => {
            failures.push(head.clone());
            no.error = format!("could not start the Reviewer of {}: {}", d.issue, no.error);
            Err(no)
        }
    };
    record(ctx, &d.issue, Some(started), failures.clone())?;
    Ok(said)
}

/// Make `reviewer`, with `failures`, the Reviewer of the live Dispatch of `issue`.
fn record(
    ctx: &Context,
    issue: &str,
    reviewer: Option<Reviewer>,
    failures: Vec<String>,
) -> io::Result<()> {
    dispatch::update(&ctx.config_dir, |all| {
        if let Some(live) = all.iter_mut().find(|l| dispatch::is_live(l, issue)) {
            live.reviewer = reviewer.map(|r| Reviewer { failures, ..r });
        }
    })
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
    listed: &str,
) -> Option<Value> {
    let reviewed =
        d.closed_at.is_none() && matches!(standing.stage, Stage::PrDraft | Stage::Verified);
    let (_, pr) = standing.pr.filter(|_| reviewed)?;
    let head = &pr.head_sha;
    let reviewer = d.reviewer.as_ref();
    let on_head = standing.verdict_on_head();
    let answered = on_head.is_some_and(|v| answered(d, v, agents, listed));
    // herdr's Agent state of the Reviewer prompted for the head: `None` once it
    // left herdr, `Unknown` while herdr does not say, which leaves it standing, as the tick does.
    let prompted = (reviewer.filter(|r| r.sha.as_ref() == Some(head) && (!answered || r.rulings)))
        .map(|r| {
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
    let off = !config.repo_of(d).switches.review;
    let state = match (on_head.filter(|_| !answered), prompted.flatten()) {
        // With review off only a Reviewer started on the head by hand shows.
        _ if off && prompted.is_none() => "off",
        (Some(v), _) if v.result == Outcome::Pass => "passed",
        (Some(_), _) => "failed",
        // Past the cap none starts for the head: one still prompted for it is one that left.
        _ if attempts > cap => "gave_up",
        (None, Some(AgentState::Working | AgentState::Unknown)) => "reviewing",
        (None, Some(_)) => "stopped",
        // Gone from herdr: with review off, no tick tries again.
        _ if off => "off",
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
/// there, given the Wikis of the Library versions `repo` links, and prompt
/// it for the PR's head.
fn start(
    ctx: &Context,
    config: &Config,
    repo: &Repo,
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
    let (wikis, line) = wiki::libraries(&ctx.config_dir, config, repo)?;
    let ready = launch::start(ctx.world, harness, reviewer, &repo.path, &wikis)?;
    launch::get_ready(ctx.world, harness, reviewer, worktree, ready)?;
    let values = [
        ("sigil", harness.sigil.as_str()),
        ("prUrl", url),
        ("issueUrl", &d.url),
        ("issue", &d.issue),
        ("headSha", &pr.head_sha),
        ("evidenceFolder", &bucket::evidence(d)),
    ];
    let text = fill_in(&config.prompts.review, &values) + &line;
    launch::prompt(ctx.world, harness, &reviewer.agent, &text)
}
