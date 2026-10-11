//! faux-nico: behind a Repo's `answer` switch, a fresh agent started for each
//! new Asking, in a worktree of the Repo at the Dispatch's Base, prompted to
//! answer it with `answer` only when the Repo's docs settle it. Each is a Run,
//! closed as any; when it ends with its Dispatch still Asking, the user is told.

use std::io;

use crate::asking;
use crate::away::{self, Run};
use crate::cli::{Context, Refusal};
use crate::config::{Config, fill_in};
use crate::dispatch::{self, Dispatch};
use crate::launch::{self, AgentLaunch};
use crate::state;

/// The trigger of a faux-nico Run.
pub const FAUX_NICO: &str = "faux-nico";

/// Start a faux-nico for each Dispatch newly Asking in a Repo with `answer`
/// on: no answer and no faux-nico for that Asking yet, and none of its own
/// running. A start that fails is said and kept as run: once its agent is
/// seen gone, the user is told of the Asking.
pub fn step(ctx: &Context, config: &Config) -> Result<Vec<String>, Refusal> {
    let runs = away::load(&ctx.config_dir)?;
    let mut said = vec![];
    for d in dispatch::load(&ctx.config_dir)? {
        let Some(asking) = &d.asking else {
            continue;
        };
        let repo = config.repo_of(&d);
        let mut its = (runs.iter()).filter(|r| r.issue.as_ref() == Some(&d.issue));
        if !repo.switches.answer
            || answered(&d, &asking.since)
            || its.any(|r| r.closed_at.is_none() || r.asking.as_ref() == Some(&asking.since))
        {
            continue;
        }
        let chosen = (repo.faux_nico.clone()).unwrap_or_else(|| repo.implementer.clone());
        let mut run = Run {
            trigger: FAUX_NICO.into(),
            repo: Some(d.repo.clone()),
            at: state::iso(ctx.world.now()),
            launch: AgentLaunch {
                agent: launch::agent_name(FAUX_NICO, &d.repo, &d.issue),
                harness: chosen.harness,
                model: chosen.model,
                effort: chosen.effort,
                tab: None,
                pane: None,
            },
            workspace: None,
            worktree: None,
            failure: None,
            closed_at: None,
            issue: Some(d.issue.clone()),
            asking: Some(asking.since.clone()),
            passed: false,
        };
        let sigil = &config.harnesses[&run.launch.harness].sigil;
        let values = [
            ("sigil", sigil.as_str()),
            ("issueUrl", &d.url),
            ("question", &asking.question),
            ("issue", &d.issue),
        ];
        let text = fill_in(&config.prompts.faux_nico, &values);
        match away::start_on_worktree(ctx, config, &repo, &d.base, &mut run, &text) {
            Ok(()) => said.push(format!(
                "{}: faux-nico started on {}",
                d.issue, run.launch.harness
            )),
            Err(no) => {
                said.push(format!(
                    "could not start the faux-nico of {}: {}",
                    d.issue, no.error
                ));
                run.failure = Some(no.error);
            }
        }
        away::update(&ctx.config_dir, |all| all.push(run))?;
    }
    Ok(said)
}

/// When `run`, now ended, is a faux-nico whose Dispatch is still Asking what
/// it was started for, unanswered: tell the user. What it said, if it did.
pub fn pass(ctx: &Context, run: &Run) -> io::Result<Option<Vec<String>>> {
    let (Some(issue), Some(since)) = (&run.issue, &run.asking) else {
        return Ok(None);
    };
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let Some(d) = dispatches.iter().find(|d| dispatch::is_live(d, issue)) else {
        return Ok(None);
    };
    let Some(asking) = (d.asking.as_ref()).filter(|a| a.since == *since && !answered(d, since))
    else {
        return Ok(None);
    };
    let said = format!("{issue}: faux-nico left its Asking to the user");
    Ok(Some(
        [said]
            .into_iter()
            .chain(asking::tell(ctx, d, asking))
            .collect(),
    ))
}

fn answered(d: &Dispatch, since: &str) -> bool {
    d.answers.iter().any(|a| a.since == since)
}
