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
use crate::verdict::{self, Outcome, Verdict};
use crate::world::{Mergeable, PrState, PullRequest};

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
    /// When GitHub was last asked about it.
    #[serde(default)]
    pub checked_at: Option<String>,
    #[serde(default)]
    pub merged_at: Option<String>,
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
    let passed = |pr| on_head(pr, verdict).is_some_and(|v| v.result == Outcome::Pass);
    match pr {
        Some(pr) if pr.state == PrState::Merged => Stage::Merged,
        Some(pr) if pr.state == PrState::Closed => Stage::Closed,
        _ if dispatch.failure.is_some() => Stage::Failed,
        Some(pr) if passed(pr) => Stage::Verified,
        Some(_) => Stage::PrDraft,
        None => Stage::Implementing,
    }
}

/// `verdict`, if it is on `pr`'s current head: a push after it leaves it on
/// a head the PR no longer has, and then it no longer counts.
fn on_head<'v>(pr: &Pr, verdict: Option<&'v Verdict>) -> Option<&'v Verdict> {
    verdict.filter(|v| v.sha == pr.head_sha)
}

/// Where a Dispatch stands: its PR, its Stage and its latest Verdict.
pub struct Standing<'a> {
    /// Its PR's URL and what GitHub last said of it.
    pub pr: Option<(&'a String, &'a Pr)>,
    pub stage: Stage,
    /// Its latest Verdict, on whatever head: what `status` shows.
    pub latest_verdict: Option<Verdict>,
}

impl Standing<'_> {
    /// Its latest Verdict if on its PR's current head: the only one that counts.
    pub fn verdict_on_head(&self) -> Option<&Verdict> {
        let (_, pr) = self.pr?;
        on_head(pr, self.latest_verdict.as_ref())
    }
}

/// Where `d` stands, its PR among `prs` and its Verdict read from `config_dir`.
pub fn standing<'a>(config_dir: &Path, prs: &'a Prs, d: &Dispatch) -> io::Result<Standing<'a>> {
    let pr = pr_of(prs, d);
    let latest_verdict = verdict::load(config_dir, &d.issue)?;
    let stage = of(d, pr.map(|(_, pr)| pr), latest_verdict.as_ref());
    Ok(Standing {
        pr,
        stage,
        latest_verdict,
    })
}

/// The PR `d` found, by its URL, as GitHub last said of it.
pub fn pr_of<'a>(prs: &'a Prs, d: &Dispatch) -> Option<(&'a String, &'a Pr)> {
    prs.get_key_value(d.pr.as_ref()?)
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
/// what failed, which live Dispatches it looked for a PR for and found
/// none (only of those is no PR known), and the PRs it saw merge.
pub fn watch(ctx: &Context, every: bool) -> io::Result<(Vec<String>, Vec<String>, Vec<Pr>)> {
    let (mut said, mut no_pr, mut merged) = (vec![], vec![], vec![]);
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let refers = |d: &Dispatch, url: &str| {
        d.pr.as_deref() == Some(url) || d.stacked_on.as_ref().is_some_and(|b| b.url == url)
    };
    let file = ctx.config_dir.join(FILE);
    let watched = state::update(&file, |text| {
        let mut watched: Prs = state::parse(&file, text)?;
        watched.retain(|url, _| dispatches.iter().any(|d| refers(d, url)));
        Ok::<_, io::Error>((state::text(&watched), watched))
    })?;
    // Quiet while paused: each call would only be refused, and said.
    if pause::of(ctx.world, &ctx.config_dir, "GitHub")?.is_some() {
        return Ok((said, no_pr, merged));
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
            Ok(prs) => match its_pr(d, &prs) {
                Some(pr) => asks.push((pr.url, d.repo.clone(), pr.number, Some(d.issue.clone()))),
                None => no_pr.push(d.issue.clone()),
            },
            Err(e) => {
                said.push(format!("could not look for the PR of {}: {e}", d.issue));
                if e.rate_limit().is_some() {
                    return Ok((said, no_pr, merged));
                }
            }
        }
    }
    for (url, repo, number, found_for) in asks {
        let now = match ctx.world.github_pull_request_activity(&repo, number) {
            Ok(now) => now,
            Err(e) => {
                said.push(format!("could not ask GitHub about {url}: {e}"));
                if e.rate_limit().is_some() {
                    return Ok((said, no_pr, merged));
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
            checked_at: Some(state::iso(ctx.world.now())),
            merged_at: now.merged_at,
        };
        if pr.state == PrState::Merged
            && watched
                .get(&url)
                .is_none_or(|was| was.state != PrState::Merged)
        {
            merged.push(pr.clone());
        }
        save(&ctx.config_dir, &url, pr)?;
        if let Some(issue) = found_for {
            dispatch::link_pr(&ctx.config_dir, &issue, &url)?;
            said.push(format!("{issue}: PR {url} found"));
        }
    }
    Ok((said, no_pr, merged))
}

/// `d`'s PR among `prs` on its branch: an open one, else the newest merged or
/// closed one opened since `d` started, since a PR can be merged or closed
/// before any tick sees it open. One opened before is an earlier Dispatch's.
fn its_pr(d: &Dispatch, prs: &[PullRequest]) -> Option<PullRequest> {
    let ours = || (prs.iter()).filter(|pr| pr.head_branch.as_ref() == Some(&d.branch));
    (ours().find(|pr| pr.state == PrState::Open))
        .or_else(|| {
            (ours().filter(|pr| pr.created_at >= d.created_at)).max_by_key(|pr| &pr.created_at)
        })
        .cloned()
}

pub fn save(config_dir: &Path, url: &str, pr: Pr) -> io::Result<()> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: Prs = state::parse(&file, text)?;
        all.insert(url.into(), pr);
        Ok((state::text(&all), ()))
    })
}
