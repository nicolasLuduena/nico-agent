//! `refresh`: re-ask on purpose. Every Repo's Source is read again, then a
//! tick runs that asks about every watched PR once, final ones included, so
//! an undone merge or a hand-changed label shows up now. A paused Source
//! stays paused.

use std::time::Duration;

use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::source;
use crate::stage;
use crate::tick;

pub fn refresh(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("refresh", args, &[])?.positionals(&[])?;
    let config = config::load(&ctx.config_dir)?;
    let mut repos = vec![];
    for (slug, repo) in &config.repos {
        let (read, error) = source::issues(ctx.world, &ctx.config_dir, slug, repo, Duration::ZERO)?;
        let mut shown = json!({ "slug": slug, "read_at": read.map(|read| read.read_at) });
        if let Some(error) = error {
            shown["error"] = json!(error.0);
        }
        repos.push(shown);
    }
    let actions = tick::tick(ctx, true)?;
    let prs: Vec<Value> = (stage::load(&ctx.config_dir)?.into_iter())
        .map(|(url, pr)| json!({ "url": url, "state": pr.state, "final": pr.r#final }))
        .collect();
    Ok(json!({ "repos": repos, "prs": prs, "actions": actions }))
}
