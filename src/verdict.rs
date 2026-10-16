//! `verdict`: the Reviewer's pass or fail on one head of a Dispatch's open
//! PR, kept in `verdicts/<issue>.json`, the latest only. A push after it
//! leaves it on a head the PR no longer has, so it no longer counts. The
//! tick acts on it: a fail restarts the Implementer (restart.rs), a pass
//! flips the PR (flip.rs).

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::bucket;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config;
use crate::dispatch;
use crate::review;
use crate::stage;
use crate::state;
use crate::world::PrState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verdict {
    pub result: Outcome,
    /// The PR head it holds for.
    pub sha: String,
    pub at: String,
    /// What the Reviewer found, as its `--findings` file said it.
    pub findings: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Pass,
    Fail,
}

/// Where the Verdict of `issue` is kept: `verdicts/owner/repo#N.json` or `verdicts/BLE-12.json`.
pub fn file(config_dir: &Path, issue: &str) -> PathBuf {
    config_dir.join("verdicts").join(format!("{issue}.json"))
}

/// The latest Verdict on `issue`, if any.
pub fn load(config_dir: &Path, issue: &str) -> io::Result<Option<Verdict>> {
    state::load(&file(config_dir, issue))
}

pub fn verdict(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let args = Args::parse("verdict", args, &["--sha", "--findings"])?;
    let &[text, word] = args.positionals(&["<issue>", "pass|fail"])? else {
        unreachable!("two positionals")
    };
    let result = match word {
        "pass" => Outcome::Pass,
        "fail" => Outcome::Fail,
        _ => {
            let error = format!("`{word}` is not a Verdict: pass or fail");
            return Err(bad_invocation(error, "verdict"));
        }
    };
    let Some(sha) = args.flag("--sha") else {
        return Err(bad_invocation("--sha is required".into(), "verdict"));
    };
    if result == Outcome::Fail && args.flag("--findings").is_none() {
        let error = "a failing Verdict needs --findings <file>".into();
        return Err(bad_invocation(error, "verdict"));
    }
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let issue = dispatch::key(&config, &dispatches, text)?;
    let see_status = || "Run `nico-agent status` to see the Dispatch".to_string();
    let Some(d) = (dispatches.into_iter()).find(|d| dispatch::is_live(d, &issue)) else {
        return Err(Refusal::new(
            format!("{issue} has no live Dispatch"),
            vec![
                "A Verdict is on the PR of an issue In flight".into(),
                see_status(),
            ],
        ));
    };
    let prs = stage::load(&ctx.config_dir)?;
    let Some((url, pr)) = stage::pr_of(&prs, &d).filter(|(_, pr)| pr.state == PrState::Open) else {
        return Err(Refusal::new(
            format!("{issue} has no open PR"),
            vec![
                "A Verdict is on the head of an open PR".into(),
                see_status(),
            ],
        ));
    };
    if sha != pr.head_sha {
        let head = &pr.head_sha;
        return Err(Refusal::new(
            format!("{sha} is not the head of {url}"),
            vec![format!(
                "The PR moved to {head}: verify that head and run `nico-agent verdict {issue} pass|fail --sha {head}`"
            )],
        ));
    }
    let findings = match args.flag("--findings") {
        Some(path) => Some(std::fs::read_to_string(path).map_err(|e| {
            Refusal::new(
                format!("could not read the findings in {path}: {e}"),
                vec!["Pass --findings the file the findings are written in".into()],
            )
        })?),
        None => None,
    };
    let said = format!("{issue} {word} at {sha}");
    let new = Verdict {
        result,
        sha: sha.into(),
        at: state::iso(ctx.world.now()),
        findings,
    };
    let file = file(&ctx.config_dir, &issue);
    let recorded = state::update(&file, |text| {
        let old: Option<Verdict> = state::parse(&file, text)?;
        // The same Verdict again changes nothing, its time included, unless it
        // rules on the Rulings that answered it.
        if old.as_ref().is_some_and(|old| {
            (old.result, &old.sha) == (result, &new.sha)
                && !review::answered(&d, old, None, &new.at)
        }) {
            return Ok::<_, Refusal>((text.to_string(), false));
        }
        // Kept before it is recorded: the tick acting on it may Close the worktree.
        let message = format!("verdict {issue} {word} {sha}");
        let findings = new.findings.as_deref();
        bucket::keep(ctx, &config, &d, sha, findings, &message)?;
        Ok((state::text(&new), true))
    })?;
    Ok(json!({
        "verdict": if recorded { said } else { format!("{said} already recorded (no-op)") },
        "stage": stage::of(&d, Some(pr), Some(&new)),
    }))
}
