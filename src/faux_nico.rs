//! faux-nico: behind a Repo's `answer` switch, a fresh agent started for each
//! new Asking, in a worktree of the Repo at the Dispatch's Base, prompted to
//! answer it with `answer` only when the Repo's docs settle it. Each is a Run,
//! closed as any; when it ends with its Dispatch still Asking, the user is told.

use std::io;

use crate::asking;
use crate::away::{self, Run, Trigger};
use crate::cli::{Context, Refusal};
use crate::config::{Config, fill_in};
use crate::dispatch::{self, Dispatch};

/// Tell the user of each Asking a faux-nico of `ended`, the Runs the tick
/// just closed, left unanswered. Then start a faux-nico for each Dispatch
/// newly Asking in a Repo with `answer` on: no answer and no faux-nico for
/// that Asking yet, and none of its own running. A start that fails is said
/// and kept as run: once its agent is seen gone, the user is told of the Asking.
pub fn step(ctx: &Context, config: &Config, ended: &[Run]) -> Result<Vec<String>, Refusal> {
    let mut said = vec![];
    for run in ended {
        said.extend(pass(ctx, run)?);
    }
    let runs = away::load(&ctx.config_dir)?;
    for d in dispatch::load(&ctx.config_dir)? {
        let Some(asking) = &d.asking else {
            continue;
        };
        let repo = config.repo_of(&d);
        let started = (runs.iter()).any(|r| {
            matches!(&r.trigger, Trigger::FauxNico { issue, asking: since, .. }
                if *issue == d.issue && (r.closed_at.is_none() || *since == asking.since))
        });
        if !repo.switches.answer || answered(&d, &asking.since) || started {
            continue;
        }
        let trigger = Trigger::FauxNico {
            issue: d.issue.clone(),
            asking: asking.since.clone(),
            passed: false,
        };
        let chosen = repo.or_implementer(&repo.faux_nico);
        let sigil = &config.harnesses[&chosen.harness].sigil;
        let values = [
            ("sigil", sigil.as_str()),
            ("issueUrl", &d.url),
            ("question", &asking.question),
            ("issue", &d.issue),
        ];
        let text = fill_in(&config.prompts.faux_nico, &values);
        let start =
            |run: &mut Run| away::start_on_worktree(ctx, config, &repo, &d.base, run, &text);
        said.push(away::start_run(ctx, trigger, Some(&d.repo), chosen, start)?);
    }
    Ok(said)
}

/// When `run`, just closed, is a faux-nico whose Dispatch is still Asking
/// what it was started for, unanswered: tell the user and record that it
/// passed. What it said.
fn pass(ctx: &Context, run: &Run) -> io::Result<Vec<String>> {
    let Trigger::FauxNico {
        issue,
        asking: since,
        ..
    } = &run.trigger
    else {
        return Ok(vec![]);
    };
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let Some(d) = dispatches.iter().find(|d| dispatch::is_live(d, issue)) else {
        return Ok(vec![]);
    };
    let Some(asking) = (d.asking.as_ref()).filter(|a| a.since == *since && !answered(d, since))
    else {
        return Ok(vec![]);
    };
    away::update(&ctx.config_dir, |all| {
        let closed = all.iter_mut().find(|r| **r == *run).map(|r| &mut r.trigger);
        if let Some(Trigger::FauxNico { passed, .. }) = closed {
            *passed = true;
        }
    })?;
    let said = format!("{issue}: faux-nico left its Asking to the user");
    Ok([said]
        .into_iter()
        .chain(asking::tell(ctx, d, asking))
        .collect())
}

/// Whether `d`'s Asking since `since` has an answer.
pub fn answered(d: &Dispatch, since: &str) -> bool {
    d.answers.iter().any(|a| a.since == since)
}
