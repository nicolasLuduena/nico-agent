//! What each GitHub identity has used of its hourly budgets, read once a
//! tick and kept in `rate_limits.json`, so the page shows it without asking.

use std::collections::BTreeMap;
use std::io;

use crate::cli::Context;
use crate::state;
use crate::world::RateLimit;

pub const FILE: &str = "rate_limits.json";

/// The last answer, by identity: `gh`, the user, and `ghbot`, the bot.
pub type RateLimits = BTreeMap<String, RateLimit>;

/// Ask each identity, `ghbot` only where it is installed, and keep what
/// answered over its last answer, rewritten only when it moved, so the page is
/// told of no change; one that did not answer keeps its last, and the user's failure is said.
pub fn step(ctx: &Context) -> io::Result<Vec<String>> {
    let mut said = vec![];
    let mut read = RateLimits::new();
    match ctx.world.github_rate_limit(false) {
        Ok(limit) => {
            read.insert("gh".into(), limit);
        }
        Err(e) => said.push(format!("could not read GitHub's rate limit: {e}")),
    }
    if let Ok(limit) = ctx.world.github_rate_limit(true) {
        read.insert("ghbot".into(), limit);
    }
    if !read.is_empty() {
        let file = ctx.config_dir.join(FILE);
        state::update(&file, |text| {
            let mut kept: RateLimits = state::parse(&file, text)?;
            kept.extend(read);
            Ok::<_, io::Error>((state::text(&kept), ()))
        })?;
    }
    Ok(said)
}
