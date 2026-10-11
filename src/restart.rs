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
use crate::state;
use crate::world::Agent;

/// One restart of a Dispatch's Implementer.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// (4) Restart, behind each Repo's `restart` switch, every live Dispatch
/// whose agent is missing from herdr's `agents` (rebooted), or whose agent
/// has been idle or done for `stall_minutes` with no PR (stalled). Nothing
/// without a list: herdr down is not every agent gone. Says what it did.
pub fn step(ctx: &Context, config: &Config, agents: Option<&[Agent]>) -> io::Result<Vec<String>> {
    let Some(agents) = agents else {
        return Ok(vec![]);
    };
    let watched = (dispatch::load(&ctx.config_dir)?.into_iter())
        .filter(|d| {
            config
                .repos
                .get(&d.repo)
                .is_some_and(|r| r.switches.restart)
        })
        .filter(|d| d.closed_at.is_none() && d.failure.is_none())
        .filter(|d| d.completed.len() == STEPS.len());
    let stall = Duration::from_secs(u64::from(config.stall_minutes) * 60);
    let now = ctx.world.now();
    let mut said = vec![];
    for mut d in watched {
        let state = agent_state(agents, &d);
        let idle = d.pr.is_none() && matches!(state, Some("idle" | "done"));
        if state.is_none() {
            said.extend(restart(ctx, config, d, Reason::Rebooted, &[])?);
        } else if !idle {
            if d.idle_since.take().is_some() {
                dispatch::save(ctx, &mut d)?;
            }
        } else if let Some(since) = &d.idle_since {
            if *since <= state::iso(now - stall) {
                said.extend(restart(ctx, config, d, Reason::Stalled, &[])?);
            }
        } else {
            d.idle_since = Some(state::iso(now));
            dispatch::save(ctx, &mut d)?;
        }
    }
    Ok(said)
}

/// The Agent state herdr reports for the Dispatch's Implementer; `None` when it has no such agent.
fn agent_state<'a>(agents: &'a [Agent], d: &Dispatch) -> Option<&'a str> {
    (agents.iter())
        .find(|a| a.name == d.implementer.agent)
        .map(|a| a.state.as_str())
}

/// The loop's restart of `record`'s Implementer for `reason`, with `values`
/// filling its prompt's placeholders before the Dispatch's own (`issueUrl`,
/// `branch`, `prUrl`, `baseBranch`). A Failed Dispatch is never restarted;
/// one whose reason is used up, or whose restart fails, is marked Failed
/// with one notification. Says what it did.
pub fn restart(
    ctx: &Context,
    config: &Config,
    mut record: Dispatch,
    reason: Reason,
    values: &[(&str, &str)],
) -> io::Result<Vec<String>> {
    if record.failure.is_some() {
        return Ok(vec![]);
    }
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
    Ok(
        match run(ctx, config, &mut record, reason, "loop", values)? {
            Ok(()) => vec![format!("{issue} restarted: {reason}")],
            Err(no) => [no.error]
                .into_iter()
                .chain(announce_failed(ctx, &record))
                .collect(),
        },
    )
}

/// Restart `record`'s Implementer for `reason`, as `by`, recording it first:
/// a failed step is kept on the record and said, with help.
pub fn run(
    ctx: &Context,
    config: &Config,
    record: &mut Dispatch,
    reason: Reason,
    by: &str,
    values: &[(&str, &str)],
) -> io::Result<Result<(), Refusal>> {
    record.restarts.push(Restart {
        at: state::iso(ctx.world.now()),
        reason,
        by: by.into(),
    });
    record.idle_since = None;
    dispatch::save(ctx, record)?;
    let failed = relaunch(ctx, config, record, &prompt(config, record, reason, values)).err();
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
    let (Some(repo), Some(harness)) = (
        config.repos.get(&record.repo),
        config.harnesses.get(&record.implementer.harness),
    ) else {
        let gone = format!(
            "{} or its Harness {} is no longer configured",
            record.repo, record.implementer.harness
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
fn prompt(config: &Config, record: &Dispatch, reason: Reason, values: &[(&str, &str)]) -> String {
    let texts = &config.prompts.restart;
    let text = match reason {
        Reason::Rebooted | Reason::Manual => &texts.rebooted,
        Reason::Stalled => &texts.stalled,
        Reason::Conflict => &texts.conflict,
        Reason::Retarget => &texts.retarget,
        Reason::Verdict => &texts.verdict,
    };
    let own = [
        ("issueUrl", record.url.as_str()),
        ("branch", &record.branch),
        ("prUrl", record.pr.as_deref().unwrap_or("(none yet)")),
        ("baseBranch", &record.base),
    ];
    fill_in(
        &format!("{} {text}", texts.prefix),
        &[values, &own].concat(),
    )
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
    let live = (dispatch::load(&ctx.config_dir)?.into_iter())
        .find(|d| d.issue == issue && d.closed_at.is_none());
    Ok(live.and_then(|d| announce_failed(ctx, &d)))
}
