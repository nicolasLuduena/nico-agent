//! `status`: per Repo, what the loop may start.

use std::time::Duration;

use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::source;

pub fn status(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("status", args, &[])?.positionals(&[])?;
    let config = config::load(&ctx.config_dir)?;
    let tick = Duration::from_secs(u64::from(config.tick_minutes) * 60);
    let in_flight = source::in_flight(&ctx.config_dir)?;
    let mut repos = vec![];
    for (slug, repo) in &config.repos {
        let (read, error) = source::issues(ctx.world, &ctx.config_dir, slug, repo, tick)?;
        let readiness = read
            .as_ref()
            .map(|read| source::readiness(read, &in_flight))
            .unwrap_or_default();
        let mut shown = json!({
            "slug": slug,
            "read_at": read.map(|read| read.read_at),
            "ready": readiness.ready,
            "stackable": readiness.stackable,
            "waiting": readiness.waiting,
        });
        if let Some(error) = error {
            shown["error"] = json!(error.0);
        }
        repos.push(shown);
    }
    Ok(json!({ "repos": repos }))
}
