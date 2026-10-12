//! The flip: a Verified PR marked ready for review, the one write to a PR.

use std::io;

use crate::cli::Context;
use crate::config::Config;
use crate::dispatch;
use crate::pause;
use crate::stage::{self, Pr, Stage};

/// (6) Flip to ready, behind each Repo's `flip` switch, the PR of every
/// Verified Dispatch while it is draft, once per passing Verdict: one put
/// back to draft by hand stays so. Nothing while GitHub is paused; a failed
/// flip is said and tried again next tick. Says what it did.
pub fn step(ctx: &Context, config: &Config) -> io::Result<Vec<String>> {
    let mut said = vec![];
    if pause::of(ctx.world, &ctx.config_dir, "GitHub")?.is_some() {
        return Ok(said);
    }
    let prs = stage::load(&ctx.config_dir)?;
    let live = dispatch::load(&ctx.config_dir)?.into_iter();
    for d in live.filter(|d| d.closed_at.is_none()) {
        let on = config.repo_of(&d).switches.flip;
        let standing = stage::standing(&ctx.config_dir, &prs, &d)?;
        let Some((url, pr)) = standing.pr else {
            continue;
        };
        if !on
            || !pr.draft
            || d.flipped.as_ref() == Some(&pr.head_sha)
            || standing.stage != Stage::Verified
        {
            continue;
        }
        match ctx.world.github_pr_ready(&pr.repo, pr.number) {
            Ok(()) => {
                let ready = Pr {
                    draft: false,
                    ..pr.clone()
                };
                stage::save(&ctx.config_dir, url, ready)?;
                let head = pr.head_sha.clone();
                dispatch::edit(ctx, &d.issue, |live| live.flipped = Some(head))?;
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
