//! The PR-shaped restart reasons, each asking the Implementer to rebase:
//! `retarget` when the PR its Dispatch is stacked on became final, `conflict`
//! when its PR conflicts with its Base.

use crate::dispatch::Dispatch;
use crate::restart::Reason;
use crate::stage::{self, Prs};
use crate::world::Mergeable;

/// Whether `d` must rebase: `retarget` when the PR below became final, once,
/// onto that PR's base, which becomes its Base; or else `conflict` when its
/// open PR conflicts with its Base, once per conflict: again only after its
/// PR was seen mergeable. GitHub's `unknown` leaves what was known. Notes on
/// `d` what it learns.
pub fn reason(d: &mut Dispatch, prs: &Prs) -> Option<Reason> {
    // Still on the head of the PR below: not retargeted yet.
    let below = (d.stacked_on.as_ref())
        .filter(|below| below.head_branch == d.base)
        .and_then(|below| prs.get(&below.url))
        .filter(|pr| pr.r#final);
    if let Some(below) = below {
        d.base = below.base.clone();
        // Its PR is rebased by this restart; one it opens later is not.
        d.rebasing = d.pr.is_some();
        return Some(Reason::Retarget);
    }
    let (_, pr) = stage::pr_of(prs, d).filter(|(_, pr)| !pr.r#final)?;
    match pr.mergeable {
        Mergeable::Conflicting if !d.rebasing => {
            d.rebasing = true;
            Some(Reason::Conflict)
        }
        Mergeable::Mergeable => {
            d.rebasing = false;
            None
        }
        _ => None,
    }
}
