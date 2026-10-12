//! The PR-shaped restart reasons, each asking the Implementer to rebase:
//! `retarget` when the PR its Dispatch is stacked on merged, `conflict`
//! when its PR conflicts with its Base. A PR below closed unmerged is no
//! reason: no rebase recovers it.

use crate::dispatch::Dispatch;
use crate::restart::Reason;
use crate::stage::{self, Pr, Prs};
use crate::world::{Mergeable, PrState};

/// Whether `d` must rebase: `retarget` when the PR below merged, once,
/// onto that PR's base, which becomes its Base; or else `conflict` when its
/// open PR conflicts with its Base, once per conflict: again only after its
/// PR was seen mergeable. GitHub's `unknown` leaves what was known. Notes on
/// `d` what it learns.
pub fn reason(d: &mut Dispatch, prs: &Prs) -> Option<Reason> {
    if let Some((_, below)) = below(d, prs).filter(|(_, pr)| pr.state == PrState::Merged) {
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

/// The URL of the PR `d` is stacked on, if it closed unmerged before `d` was retargeted.
pub fn closed_below<'p>(d: &Dispatch, prs: &'p Prs) -> Option<&'p String> {
    below(d, prs)
        .filter(|(_, pr)| pr.state == PrState::Closed)
        .map(|(url, _)| url)
}

/// The PR `d` is stacked on, by URL, while `d` is still on its head: not retargeted yet.
fn below<'p>(d: &Dispatch, prs: &'p Prs) -> Option<(&'p String, &'p Pr)> {
    let below = (d.stacked_on.as_ref()).filter(|below| below.head_branch == d.base)?;
    prs.get_key_value(&below.url)
}
