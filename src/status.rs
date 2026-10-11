//! `status`: per Repo, what the loop may start; and every Dispatch with its Stage.

use std::collections::HashSet;

use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::dispatch;
use crate::source;

pub fn status(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("status", args, &[])?.positionals(&[])?;
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let in_flight: HashSet<String> = (dispatches.iter())
        .filter(|d| d.closed_at.is_none())
        .map(|d| d.issue.clone())
        .collect();
    let mut repos = vec![];
    for (slug, repo) in &config.repos {
        let (read, error) = source::issues(ctx.world, &ctx.config_dir, slug, repo, config.tick())?;
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
    let dispatches: Vec<Value> = (dispatches.iter())
        .map(|d| {
            let mut shown = json!(d);
            shown["stage"] = json!(dispatch::stage(d));
            shown
        })
        .collect();
    Ok(json!({ "repos": repos, "dispatches": dispatches }))
}
