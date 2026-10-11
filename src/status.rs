//! `status`: per Repo, what the loop may start; and every Dispatch with its Stage.

use serde_json::{Value, json};

use crate::args::Args;
use crate::away;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config};
use crate::dispatch::{self, Dispatch};
use crate::pause;
use crate::source;
use crate::stage::{self, Prs, Stage};
use crate::verdict;
use crate::world::{self, AgentState};

pub fn status(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("status", args, &[])?.positionals(&[])?;
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let prs = stage::load(&ctx.config_dir)?;
    shown(ctx, &config, &dispatches, &prs, true)
}

/// What `status` shows of the `config`, `dispatches` and `prs` the caller
/// loaded, its `dispatches[]` in their order; with `read`, each Source whose
/// cache is older than a tick is read first, else only its cache is shown,
/// however old.
pub fn shown(
    ctx: &Context,
    config: &Config,
    dispatches: &[Dispatch],
    prs: &Prs,
    read: bool,
) -> Result<Value, Refusal> {
    let mut repos = vec![];
    let runs = away::load(&ctx.config_dir)?;
    for (slug, repo) in &config.repos {
        let (read, error) = match read {
            true => source::issues(ctx.world, &ctx.config_dir, slug, repo, config.tick())?,
            false => (source::cached(&ctx.config_dir, slug), None),
        };
        let readiness = read
            .as_ref()
            .map(|read| source::readiness(read, dispatches, prs))
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
        if let Some(scan) = away::last_scan(&runs, slug) {
            shown["last_scan"] = json!(scan);
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
        None => json!(AgentState::Unknown),
        Some(agents) => world::agent_state(agents, name).map_or(json!("gone"), |s| json!(s)),
    };
    let mut shown_dispatches = vec![];
    for d in dispatches {
        let pr = stage::pr_of(prs, d);
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
