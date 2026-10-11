//! A Dispatch's PR, found on its branch once and then watched by number in
//! `prs.json`, and the Stage derived from it: never stored.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cli::Context;
use crate::dispatch::{self, Dispatch};
use crate::pause;
use crate::state;
use crate::verdict::{Outcome, Verdict};
use crate::world::{Mergeable, PrState};

pub const FILE: &str = "prs.json";

/// What GitHub last said about a watched PR.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pr {
    /// `owner/name` of the repo it is in.
    pub repo: String,
    pub number: u64,
    pub state: PrState,
    pub draft: bool,
    pub head_sha: String,
    pub base: String,
    pub mergeable: Mergeable,
    /// When anything last happened on it.
    pub updated_at: String,
    /// Merged or closed: never asked about again.
    pub r#final: bool,
}

/// Every watched PR, by URL.
pub type Prs = BTreeMap<String, Pr>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Stage {
    /// No PR yet.
    Implementing,
    /// Its PR is open, with no passing Verdict on its head.
    #[serde(rename = "PR draft")]
    PrDraft,
    /// Its PR is open, with a passing Verdict on its head.
    Verified,
    Merged,
    /// Its PR closed unmerged.
    Closed,
    /// A step failed.
    Failed,
}

/// Where `dispatch` stands, given its PR as last seen and its latest Verdict.
pub fn of(dispatch: &Dispatch, pr: Option<&Pr>, verdict: Option<&Verdict>) -> Stage {
    let passed =
        |pr: &Pr| verdict.is_some_and(|v| v.result == Outcome::Pass && v.sha == pr.head_sha);
    match pr {
        Some(pr) if pr.state == PrState::Merged => Stage::Merged,
        Some(pr) if pr.state == PrState::Closed => Stage::Closed,
        _ if dispatch.failure.is_some() => Stage::Failed,
        Some(pr) if passed(pr) => Stage::Verified,
        Some(_) => Stage::PrDraft,
        None => Stage::Implementing,
    }
}

pub fn load(config_dir: &Path) -> io::Result<Prs> {
    state::load(&config_dir.join(FILE))
}

/// Look for each live Dispatch's PR on its branch until one is found, and
/// ask GitHub about each PR a live Dispatch refers to (its own, or the one it
/// is stacked on) that is not final; with `every`, about every watched PR,
/// final ones included. What no Dispatch refers to any more is no longer
/// watched. A failed read is said and asked again next time; it never stops
/// the others, but a rate limit pauses them all. Says what it found and
/// what failed, and which live Dispatches it looked for a PR for and found
/// none: only of those is no PR known.
pub fn watch(ctx: &Context, every: bool) -> io::Result<(Vec<String>, Vec<String>)> {
    let (mut said, mut no_pr) = (vec![], vec![]);
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let refers = |d: &Dispatch, url: &str| {
        d.pr.as_deref() == Some(url) || d.stacked_on.as_ref().is_some_and(|b| b.url == url)
    };
    let file = ctx.config_dir.join(FILE);
    let watched = state::update(&file, |text| {
        let mut watched: Prs = state::parse(&file, text)?;
        watched.retain(|url, _| dispatches.iter().any(|d| refers(d, url)));
        let text = serde_json::to_string_pretty(&watched).expect("a Pr is plain data") + "\n";
        Ok::<_, io::Error>((text, watched))
    })?;
    if pause::of(ctx.world, &ctx.config_dir, "GitHub")?.is_some() {
        return Ok((said, no_pr));
    }
    let live = || dispatches.iter().filter(|d| d.closed_at.is_none());
    // (url, repo, number, the Dispatch it was just found for)
    let mut asks: Vec<(String, String, u64, Option<String>)> = (watched.iter())
        .filter(|(url, pr)| every || (!pr.r#final && live().any(|d| refers(d, url))))
        .map(|(url, pr)| (url.clone(), pr.repo.clone(), pr.number, None))
        .collect();
    // The PR a Stacked Dispatch sits on, watched from then on: its Blocker may be worked outside the loop.
    for d in live() {
        if let Some(below) = &d.stacked_on
            && !watched.contains_key(&below.url)
            && !asks.iter().any(|(url, ..)| *url == below.url)
        {
            asks.push((below.url.clone(), d.repo.clone(), below.number, None));
        }
    }
    for d in live().filter(|d| d.pr.is_none()) {
        match ctx.world.github_branch_pull_requests(&d.repo, &d.branch) {
            // Only an open one: a closed PR on the branch is an earlier Dispatch's.
            Ok(prs) => match (prs.into_iter())
                .find(|pr| pr.state == PrState::Open && pr.head_branch.as_ref() == Some(&d.branch))
            {
                Some(pr) => asks.push((pr.url, d.repo.clone(), pr.number, Some(d.issue.clone()))),
                None => no_pr.push(d.issue.clone()),
            },
            Err(e) => {
                said.push(format!("could not look for the PR of {}: {e}", d.issue));
                if pause::note(&ctx.config_dir, &e)? {
                    return Ok((said, no_pr));
                }
            }
        }
    }
    for (url, repo, number, found_for) in asks {
        let now = match ctx.world.github_pull_request_activity(&repo, number) {
            Ok(now) => now,
            Err(e) => {
                said.push(format!("could not ask GitHub about {url}: {e}"));
                if pause::note(&ctx.config_dir, &e)? {
                    return Ok((said, no_pr));
                }
                continue;
            }
        };
        let pr = Pr {
            repo,
            number,
            state: now.state,
            draft: now.draft,
            head_sha: now.head_sha,
            base: now.base_branch,
            mergeable: now.mergeable,
            updated_at: now.updated_at,
            r#final: now.state != PrState::Open,
        };
        save(&ctx.config_dir, &url, pr)?;
        if let Some(issue) = found_for {
            dispatch::link_pr(&ctx.config_dir, &issue, &url)?;
            said.push(format!("{issue}: PR {url} found"));
        }
    }
    Ok((said, no_pr))
}

pub fn save(config_dir: &Path, url: &str, pr: Pr) -> io::Result<()> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: Prs = state::parse(&file, text)?;
        all.insert(url.into(), pr);
        let text = serde_json::to_string_pretty(&all).expect("a Pr is plain data") + "\n";
        Ok((text, ()))
    })
}
