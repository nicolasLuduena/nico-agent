//! The PR-shaped restarts, each asking the Implementer to rebase: `retarget`
//! when the PR its Dispatch is stacked on became final, `conflict` when its
//! PR conflicts with its Base.

use std::io;

use crate::cli::Context;
use crate::config::Config;
use crate::dispatch::{self, STEPS};
use crate::restart::{self, Reason};
use crate::stage;
use crate::world::Mergeable;

/// (4) Behind each Repo's `restart` switch, restart the Implementer of each
/// live Dispatch whose PR below became final, once, onto that PR's base,
/// which becomes its Base; or else whose open PR conflicts with its Base,
/// once per conflict: again only after its PR was seen mergeable. GitHub's
/// `unknown` leaves what was known. Says what it did.
pub fn step(ctx: &Context, config: &Config) -> io::Result<Vec<String>> {
    let prs = stage::load(&ctx.config_dir)?;
    let live = (dispatch::load(&ctx.config_dir)?.into_iter())
        .filter(|d| {
            config
                .repos
                .get(&d.repo)
                .is_some_and(|r| r.switches.restart)
        })
        .filter(|d| d.closed_at.is_none() && d.failure.is_none())
        .filter(|d| d.completed.len() == STEPS.len());
    let mut said = vec![];
    for mut d in live {
        // Still on the head of the PR below: not retargeted yet.
        let below = (d.stacked_on.as_ref())
            .filter(|below| below.head_branch == d.base)
            .and_then(|below| prs.get(&below.url))
            .filter(|pr| pr.r#final);
        if let Some(below) = below {
            d.base = below.base.clone();
            // Its PR is rebased by this restart; one it opens later is not.
            d.rebasing = d.pr.is_some();
            said.extend(restart::restart(ctx, config, d, Reason::Retarget, &[])?);
            continue;
        }
        let Some(pr) = (d.pr.as_ref())
            .and_then(|url| prs.get(url))
            .filter(|pr| !pr.r#final)
        else {
            continue;
        };
        match pr.mergeable {
            Mergeable::Conflicting if !d.rebasing => {
                d.rebasing = true;
                said.extend(restart::restart(ctx, config, d, Reason::Conflict, &[])?);
            }
            Mergeable::Mergeable if d.rebasing => {
                d.rebasing = false;
                dispatch::save(ctx, &mut d)?;
            }
            _ => {}
        }
    }
    Ok(said)
}
