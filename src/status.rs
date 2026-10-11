//! `status`: per Repo, what the loop may start; and every Dispatch with its Stage.

use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::dispatch;
use crate::pause;
use crate::source;
use crate::stage::{self, Stage};
use crate::verdict;
use crate::world;

pub fn status(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("status", args, &[])?.positionals(&[])?;
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let prs = stage::load(&ctx.config_dir)?;
    let mut repos = vec![];
    for (slug, repo) in &config.repos {
        let (read, error) = source::issues(ctx.world, &ctx.config_dir, slug, repo, config.tick())?;
        let readiness = read
            .as_ref()
            .map(|read| source::readiness(read, &dispatches, &prs))
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
        let harness = &repo.implementer.harness;
        if config.reviewer(repo, harness).harness == *harness {
            shown["warnings"] = json!([format!(
                "{slug}'s Reviewer runs on {harness}, as its Implementer does, so it may share its blind spots; set another Harness in repos.\"{slug}\".reviewer"
            )]);
        }
        repos.push(shown);
    }
    let mut sources = json!({});
    for source in pause::SOURCES {
        let until = pause::until(ctx.world, &ctx.config_dir, source)?;
        sources[source.to_lowercase()] = json!({ "paused_until": until });
    }
    // As herdr says now, beside the Stage, never deriving it.
    let live = dispatches.iter().any(|d| d.closed_at.is_none());
    let agents = live.then(|| ctx.world.herdr_agents().ok()).flatten();
    let agent_state = |name: &str| match &agents {
        None => "unknown",
        Some(agents) => world::agent_state(agents, name).unwrap_or("gone"),
    };
    let mut shown_dispatches = vec![];
    for d in &dispatches {
        let pr = stage::pr_of(&prs, d);
        let verdict = verdict::load(&ctx.config_dir, &d.issue)?;
        let stage = stage::of(d, pr.map(|(_, pr)| pr), verdict.as_ref());
        let (slug, harness) = (&d.repo, &d.implementer.harness);
        let mut warnings = d.warnings.clone();
        if d.closed_at.is_none() {
            let repo = config.repo_of(d);
            if config.reviewer(&repo, harness).harness == *harness {
                warnings.push(format!(
                    "{}'s Reviewer runs on {harness}, as its Implementer does, so it may share its blind spots; set another Harness in repos.\"{slug}\".reviewer",
                    d.issue
                ));
            }
            if !repo.switches.flip && stage == Stage::Verified && pr.is_some_and(|(_, pr)| pr.draft)
            {
                warnings.push(format!(
                    "flip is off for {slug}, so its Verified PR stays draft; mark it ready by hand, or turn on repos.\"{slug}\".switches.flip"
                ));
            }
        }
        let mut shown = json!(d);
        shown["warnings"] = json!(warnings);
        shown["stage"] = json!(stage);
        if d.closed_at.is_none() {
            shown["agent_state"] = json!({
                "implementer": agent_state(&d.implementer.agent),
                "reviewer": d.reviewer.as_ref().map(|r| agent_state(&r.launch.agent)),
            });
        }
        shown["verdict"] = json!(verdict);
        shown["pr"] = pr.map_or(Value::Null, |(url, pr)| {
            let mut pr = json!(pr);
            pr["url"] = json!(url);
            pr
        });
        shown_dispatches.push(shown);
    }
    Ok(json!({ "repos": repos, "sources": sources, "dispatches": shown_dispatches }))
}
