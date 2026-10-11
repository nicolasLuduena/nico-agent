//! Restart, the one recovery action: close a Dispatch's tab, open a new one
//! in its workspace and worktree, start its Harness and send it the restart
//! prompt for the reason. A reason restarted `max_restarts_per_reason`
//! times already marks the Dispatch Failed instead, with one notification.

use std::fmt;
use std::io;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::cli::{Context, Refusal};
use crate::config::{Config, fill_in};
use crate::dispatch::{self, Dispatch, Failure, STEPS};
use crate::launch;
use crate::rebase;
use crate::stage::{self, Prs};
use crate::state;
use crate::verdict::{self, Outcome};
use crate::world::{self, Agent, AgentState};

/// One restart of a Dispatch's Implementer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Restart {
    pub at: String,
    pub reason: Reason,
    /// Who restarted it: `loop` or `user`.
    pub by: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Reason {
    /// Its agent is missing from herdr.
    Rebooted,
    /// Its agent was idle or done for `stall_minutes`, with no PR.
    Stalled,
    /// Its PR conflicts with its Base.
    Conflict,
    /// The PR it is stacked on became final.
    Retarget,
    /// The Reviewer failed its PR.
    Verdict,
    /// `dispatch` by hand on a Dispatch whose agent is gone; never counts toward the cap.
    Manual,
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = serde_json::to_value(self).expect("a Reason is a name");
        f.write_str(name.as_str().expect("a Reason is a name"))
    }
}

/// (4) Restart, behind each Repo's `restart` switch, each live Dispatch that
/// broke, once a tick, for the first of its reasons: its PR below became
/// final or its PR conflicts (see [`rebase::reason`]); the Reviewer failed
/// its PR's head; its agent is missing from herdr's `agents` (rebooted); its
/// agent was idle or done for `stall_minutes` with no PR (stalled), which
/// only a Dispatch the watch found no PR for this tick, in `no_pr`, can
/// be. A rebase comes first, as it moves the head a Verdict is on, and any
/// restart starts an agent that was gone; a reason passed over holds next
/// tick if still true. Without `agents`, no agent reason: herdr down is not
/// every agent gone. Says what it did.
pub fn step(
    ctx: &Context,
    config: &Config,
    agents: Option<&[Agent]>,
    no_pr: &[String],
) -> io::Result<Vec<String>> {
    let prs = stage::load(&ctx.config_dir)?;
    let now = ctx.world.now();
    let stalled = state::iso(now - Duration::from_secs(u64::from(config.stall_minutes) * 60));
    let now = state::iso(now);
    let broke = (dispatch::load(&ctx.config_dir)?.into_iter())
        .filter(|d| config.repo_of(d).switches.restart)
        .filter(|d| d.closed_at.is_none() && d.failure.is_none())
        .filter(|d| d.completed.len() == STEPS.len());
    let mut said = vec![];
    for mut d in broke {
        let seen = d.clone();
        let reason = match rebase::reason(&mut d, &prs) {
            Some(reason) => Some(reason),
            None if failed_verdict(ctx, &d, &prs)? => Some(Reason::Verdict),
            None => agents.and_then(|agents| {
                let stalled = Some(stalled.as_str()).filter(|_| no_pr.contains(&d.issue));
                agent_reason(&mut d, agents, &now, stalled)
            }),
        };
        match reason {
            Some(reason) => said.extend(by_loop(ctx, config, d, reason)?),
            None if d != seen => dispatch::save(ctx, &mut d)?,
            None => {}
        }
    }
    Ok(said)
}

/// Whether the head of `d`'s open PR has a failing Verdict that no `verdict`
/// restart came at or after: one restart per failing Verdict.
fn failed_verdict(ctx: &Context, d: &Dispatch, prs: &Prs) -> io::Result<bool> {
    let Some((_, pr)) = stage::pr_of(prs, d).filter(|(_, pr)| !pr.r#final) else {
        return Ok(false);
    };
    let failed = verdict::load(&ctx.config_dir, &d.issue)?
        .filter(|v| v.result == Outcome::Fail && v.sha == pr.head_sha);
    Ok(failed
        .is_some_and(|v| !(d.restarts.iter()).any(|r| r.reason == Reason::Verdict && r.at >= v.at)))
}

/// `rebooted` when `d`'s Implementer is missing from `agents`; `stalled` when
/// it has been idle or done with no PR since `stalled` or before, noting on
/// `d` since when it is; `None` for `stalled` when that is not known.
fn agent_reason(
    d: &mut Dispatch,
    agents: &[Agent],
    now: &str,
    stalled: Option<&str>,
) -> Option<Reason> {
    let Some(state) = world::agent_state(agents, &d.implementer.agent) else {
        return Some(Reason::Rebooted);
    };
    if d.pr.is_some() || !matches!(state, AgentState::Idle | AgentState::Done) {
        d.idle_since = None;
        return None;
    }
    let since = d.idle_since.get_or_insert_with(|| now.into());
    stalled
        .is_some_and(|stalled| since.as_str() <= stalled)
        .then_some(Reason::Stalled)
}

/// The loop's restart of `record`'s Implementer for `reason`. One whose
/// reason is used up, or whose restart fails, is marked Failed with one
/// notification. Says what it did.
fn by_loop(
    ctx: &Context,
    config: &Config,
    mut record: Dispatch,
    reason: Reason,
) -> io::Result<Vec<String>> {
    let times = (record.restarts.iter())
        .filter(|r| r.reason == reason)
        .count();
    if times >= config.max_restarts_per_reason as usize {
        let error = format!("{reason} again after {times} restarts for it");
        let said = format!("{} Failed: {error}", record.issue);
        record.failure = Some(Failure {
            step: "restart".into(),
            error,
            reason: Some(reason),
        });
        dispatch::save(ctx, &mut record)?;
        return Ok([said]
            .into_iter()
            .chain(announce_failed(ctx, &record))
            .collect());
    }
    let issue = record.issue.clone();
    Ok(match restart(ctx, config, &mut record, reason, "loop")? {
        Ok(()) => vec![format!("{issue} restarted: {reason}")],
        Err(no) => [no.error]
            .into_iter()
            .chain(announce_failed(ctx, &record))
            .collect(),
    })
}

/// Restart `record`'s Implementer for `reason`, as `by`, recording it first:
/// a failed step is kept on the record and said, with help.
pub fn restart(
    ctx: &Context,
    config: &Config,
    record: &mut Dispatch,
    reason: Reason,
    by: &str,
) -> io::Result<Result<(), Refusal>> {
    record.restarts.push(Restart {
        at: state::iso(ctx.world.now()),
        reason,
        by: by.into(),
    });
    record.idle_since = None;
    dispatch::save(ctx, record)?;
    let text = prompt(ctx, config, record, reason)?;
    let failed = relaunch(ctx, config, record, &text).err();
    record.failure = failed.as_ref().map(|(step, no)| Failure {
        step: step.to_string(),
        error: no.error.clone(),
        reason: Some(reason),
    });
    dispatch::save(ctx, record)?;
    let Some((step, mut no)) = failed else {
        return Ok(Ok(()));
    };
    no.error = format!(
        "{} failed at {step} of its {reason} restart: {}",
        record.issue, no.error
    );
    no.help.push(format!(
        "Close {}'s tab in herdr if it is still open, and run `nico-agent dispatch {}` to restart it",
        record.implementer.agent, record.issue
    ));
    Ok(Err(no))
}

/// Close the Implementer's tab, open a new one in its workspace and
/// worktree, start its Harness and send it `text`: the step that failed, if one did.
fn relaunch(
    ctx: &Context,
    config: &Config,
    record: &mut Dispatch,
    text: &str,
) -> Result<(), (&'static str, Refusal)> {
    let world = ctx.world;
    let repo = config.repo_of(record);
    let Some(harness) = config.harnesses.get(&record.implementer.harness) else {
        let gone = format!(
            "its Harness {} is no longer configured",
            record.implementer.harness
        );
        return Err(("tab", Refusal::new(gone, vec![])));
    };
    let made = "the worktree step made it";
    let workspace = record.workspace.as_deref().expect(made);
    let worktree = record.worktree.as_deref().expect(made);
    let launch = &mut record.implementer;
    let opened = (launch.tab.take())
        .map_or(Ok(()), |tab| world.herdr_tab_close(&tab))
        .and_then(|()| launch::open_tab(world, launch, workspace, worktree, "implementer"));
    opened.map_err(|e| ("tab", e.into()))?;
    let ready =
        launch::start(world, harness, launch, &repo.path).map_err(|e| ("agent start", e.into()))?;
    launch::get_ready(world, harness, launch, worktree, ready).map_err(|no| ("agent ready", no))?;
    launch::prompt(world, &launch.agent, text).map_err(|no| ("prompt", no))
}

/// The restart prompt for `reason`: the prefix, then the reason's own text.
/// `manual` is sent `rebooted`'s, the text for an agent gone from herdr.
fn prompt(ctx: &Context, config: &Config, record: &Dispatch, reason: Reason) -> io::Result<String> {
    let texts = &config.prompts.restart;
    let text = match reason {
        Reason::Rebooted | Reason::Manual => &texts.rebooted,
        Reason::Stalled => &texts.stalled,
        Reason::Conflict => &texts.conflict,
        Reason::Retarget => &texts.retarget,
        Reason::Verdict => &texts.verdict,
    };
    let verdict = verdict::load(&ctx.config_dir, &record.issue)?;
    let findings = verdict::file(&ctx.config_dir, &record.issue);
    let values = [
        ("issueUrl", record.url.as_str()),
        ("branch", &record.branch),
        ("prUrl", record.pr.as_deref().unwrap_or("(none yet)")),
        ("baseBranch", &record.base),
        ("sha", verdict.as_ref().map_or("", |v| &v.sha)),
        ("findingsPath", &findings.display().to_string()),
    ];
    Ok(fill_in(&format!("{} {text}", texts.prefix), &values))
}

/// Tell the user that `record` is Failed, if it is; called once, as it
/// becomes Failed. A line when the notification could not be shown.
fn announce_failed(ctx: &Context, record: &Dispatch) -> Option<String> {
    let failure = record.failure.as_ref()?;
    let title = format!("{} Failed", record.issue);
    let body = format!("{}: {}", failure.step, failure.error);
    // shortcut: a notification that fails is said, not retried; keep a notified list if that bites.
    (ctx.world.notify(&title, &body))
        .err()
        .map(|e| format!("could not notify \"{title}\": {e}"))
}

/// Tell the user that the live Dispatch of `issue` is Failed, if it is: for
/// the loop's dispatch that failed at a step, which it never tries again.
pub fn announce(ctx: &Context, issue: &str) -> io::Result<Option<String>> {
    let live = (dispatch::load(&ctx.config_dir)?.into_iter()).find(|d| dispatch::is_live(d, issue));
    Ok(live.and_then(|d| announce_failed(ctx, &d)))
}
