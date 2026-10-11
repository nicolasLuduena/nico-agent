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
        if config.reviewer(repo).harness == *harness {
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
    let mut shown_dispatches = vec![];
    for d in &dispatches {
        let mut shown = json!(d);
        let pr = d.pr.as_ref().and_then(|url| Some((url, prs.get(url)?)));
        let verdict = verdict::load(&ctx.config_dir, &d.issue)?;
        let stage = stage::of(d, pr.map(|(_, pr)| pr), verdict.as_ref());
        let flip_off = config.repos.get(&d.repo).is_some_and(|r| !r.switches.flip);
        if flip_off && stage == Stage::Verified && pr.is_some_and(|(_, pr)| pr.draft) {
            let slug = &d.repo;
            shown["warnings"].as_array_mut().expect("a Dispatch's warnings are a list").push(json!(format!(
                "flip is off for {slug}, so its Verified PR stays draft; mark it ready by hand, or turn on repos.\"{slug}\".switches.flip"
            )));
        }
        shown["stage"] = json!(stage);
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
