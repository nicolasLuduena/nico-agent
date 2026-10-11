//! The tick's Reviewers: one started in a Dispatch's workspace and worktree
//! when its PR first appears, and again for each new head, prompted to
//! re-run the Repo's verification and record a Verdict with `verdict`.

use serde::{Deserialize, Serialize};

use crate::cli::{Context, Refusal};
use crate::config::{Config, fill_in};
use crate::dispatch::{self, Dispatch};
use crate::launch::{self, AgentLaunch};
use crate::stage::{self, Pr, Stage};
use crate::verdict;
use crate::world::Agent;

/// A Dispatch's latest Reviewer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reviewer {
    #[serde(flatten)]
    pub launch: AgentLaunch,
    /// The PR head it was prompted for; unset while its launch has not got that far.
    pub sha: Option<String>,
}

/// (5) Start a Reviewer for each live Dispatch whose open PR has a head with
/// no Verdict and no Reviewer prompted for it still in herdr's `agents`;
/// behind the `review` switch. A launch that fails is said and tried again
/// next tick, in a fresh tab. Without `agents`, a prompted Reviewer stands.
pub fn start_reviewers(
    ctx: &Context,
    config: &Config,
    agents: Option<&[Agent]>,
) -> Result<Vec<String>, Refusal> {
    let prs = stage::load(&ctx.config_dir)?;
    let mut said = vec![];
    let live = dispatch::load(&ctx.config_dir)?.into_iter();
    for d in live.filter(|d| d.closed_at.is_none()) {
        let Some(repo) = config.repos.get(&d.repo).filter(|r| r.switches.review) else {
            continue;
        };
        let Some((url, pr)) = d.pr.as_ref().and_then(|url| Some((url, prs.get(url)?))) else {
            continue;
        };
        let verdict = verdict::load(&ctx.config_dir, &d.issue)?;
        let gone =
            |r: &&Reviewer| agents.is_some_and(|a| a.iter().all(|a| a.name != r.launch.agent));
        let prompted = (d.reviewer.as_ref())
            .filter(|r| !gone(r))
            .and_then(|r| r.sha.as_ref());
        if stage::of(&d, Some(pr), verdict.as_ref()) != Stage::PrDraft
            || [prompted, verdict.as_ref().map(|v| &v.sha)].contains(&Some(&pr.head_sha))
        {
            continue;
        }
        // Its agent name is taken until the last Reviewer's tab is closed.
        if let Some(tab) = d.reviewer.as_ref().and_then(|r| r.launch.tab.as_ref())
            && let Err(e) = ctx.world.herdr_tab_close(tab)
        {
            said.push(format!(
                "could not close the last Reviewer of {}: {e}",
                d.issue
            ));
            continue;
        }
        let chosen = config.reviewer(repo);
        let mut reviewer = Reviewer {
            launch: AgentLaunch {
                agent: launch::agent_name("rev", &d.repo, &d.issue),
                harness: chosen.harness,
                model: chosen.model,
                effort: chosen.effort,
                tab: None,
                pane: None,
            },
            sha: None,
        };
        match start(ctx, config, &repo.path, &d, &mut reviewer.launch, url, pr) {
            Ok(()) => {
                said.push(format!(
                    "{}: Reviewer started on {} for {}",
                    d.issue, reviewer.launch.harness, pr.head_sha
                ));
                reviewer.sha = Some(pr.head_sha.clone());
            }
            Err(no) => said.push(format!(
                "could not start the Reviewer of {}: {}",
                d.issue, no.error
            )),
        }
        dispatch::update(&ctx.config_dir, |all| {
            if let Some(live) = all.iter_mut().find(|l| dispatch::is_live(l, &d.issue)) {
                live.reviewer = Some(reviewer);
            }
        })?;
    }
    Ok(said)
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
    ];
    let text = fill_in(&config.prompts.review, &values);
    launch::prompt(ctx.world, &reviewer.agent, &text)
}
