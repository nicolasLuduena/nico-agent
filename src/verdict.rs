//! `verdict`: the Reviewer's pass or fail on one head of a Dispatch's open
//! PR, kept in `verdicts/<issue>.json`, the latest only. A push after it
//! leaves it on a head the PR no longer has, so it no longer counts. The
//! tick acts on it: a fail restarts the Implementer, a pass flips the PR.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config::{self, Config};
use crate::dispatch;
use crate::pause;
use crate::stage::{self, Pr, Stage};
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

/// (6) Flip to ready, behind each Repo's `flip` switch, the PR of every
/// Verified Dispatch while it is draft, keeping it not draft so it is
/// flipped once. Nothing while GitHub is paused; a failed flip is said and
/// tried again next tick. Says what it did.
pub fn flip(ctx: &Context, config: &Config) -> io::Result<Vec<String>> {
    let mut said = vec![];
    if pause::of(ctx.world, &ctx.config_dir, "GitHub")?.is_some() {
        return Ok(said);
    }
    let prs = stage::load(&ctx.config_dir)?;
    let live = dispatch::load(&ctx.config_dir)?.into_iter();
    for d in live.filter(|d| d.closed_at.is_none()) {
        let on = config.repos.get(&d.repo).is_some_and(|r| r.switches.flip);
        let Some((url, pr)) = d.pr.as_ref().and_then(|url| Some((url, prs.get(url)?))) else {
            continue;
        };
        let verdict = load(&ctx.config_dir, &d.issue)?;
        if !on || !pr.draft || stage::of(&d, Some(pr), verdict.as_ref()) != Stage::Verified {
            continue;
        }
        match ctx.world.github_pr_ready(&pr.repo, pr.number) {
            Ok(()) => {
                let ready = Pr {
                    draft: false,
                    ..pr.clone()
                };
                stage::save(&ctx.config_dir, url, ready)?;
                said.push(format!("{}: PR {url} flipped to ready", d.issue));
            }
            Err(e) => {
                said.push(format!("could not flip {url} to ready: {e}"));
                if pause::note(&ctx.config_dir, &e)? {
                    break;
                }
            }
        }
    }
    Ok(said)
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
    let issue = dispatch::key(&config, text)?;
    let see_status = || "Run `nico-agent status` to see the Dispatch".to_string();
    let Some(d) =
        (dispatch::load(&ctx.config_dir)?.into_iter()).find(|d| dispatch::is_live(d, &issue))
    else {
        return Err(Refusal::new(
            format!("{issue} has no live Dispatch"),
            vec![
                "A Verdict is on the PR of an issue In flight".into(),
                see_status(),
            ],
        ));
    };
    let prs = stage::load(&ctx.config_dir)?;
    let Some((url, pr)) = (d.pr.as_ref())
        .and_then(|url| Some((url, prs.get(url)?)))
        .filter(|(_, pr)| pr.state == PrState::Open)
    else {
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
        // The same Verdict again changes nothing, its time included.
        if old
            .as_ref()
            .is_some_and(|old| (old.result, &old.sha) == (result, &new.sha))
        {
            return Ok::<_, io::Error>((text.to_string(), false));
        }
        let text = serde_json::to_string_pretty(&new).expect("a Verdict is plain data") + "\n";
        Ok((text, true))
    })?;
    Ok(json!({
        "verdict": if recorded { said } else { format!("{said} already recorded (no-op)") },
        "stage": stage::of(&d, Some(pr), Some(&new)),
    }))
}
