//! What the page draws a Project's Roadmap from: every open issue its
//! Sources last said, `ready-for-agent` ones aside; never a new read of a
//! Source, and nothing written to one.

use serde_json::{Value, json};

use crate::cli::{Context, Refusal};
use crate::config;
use crate::map;
use crate::source::{self, Issue};
use crate::world::READY_LABEL;

/// The Roadmap's lanes, left to right, each by the label that places an
/// issue in it; an issue with none of these is in [`NO_LABEL`].
const LANES: [&str; 4] = ["needs-triage", "needs-info", "ready-for-human", "wontfix"];
const NO_LABEL: &str = "no label";

/// `GET /api/roadmap/<project>`: the lanes that hold an issue, in order; a
/// node per open issue of the Project's Repos not labelled `ready-for-agent`,
/// in the first lane its labels match, with its body, assignees, and the
/// open issues that block it and that it blocks, off the Roadmap too; and an
/// edge from each of its open Blockers on the Roadmap. `None` when `name` is
/// no Project.
pub fn roadmap(ctx: &Context, name: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let Some(slugs) = map::project_slugs(&config, name) else {
        return Ok(None);
    };
    // Every open issue the Project's Sources hold, with its Repo and assignees.
    let mut issues: Vec<Issue> = vec![];
    let mut held: Vec<(&str, Value)> = vec![];
    for slug in &slugs {
        let Some(read) = source::cached(&ctx.config_dir, &config, slug)? else {
            continue;
        };
        for issue in read.open {
            // A Linear issue two Repos of the Project claim is one node.
            if !issues.iter().any(|i| i.key == issue.key) {
                held.push((slug, json!(source::assignees(&issue, &read.user))));
                issues.push(issue);
            }
        }
    }
    map::own_keys(&mut issues, &slugs);
    let lane = |i: &Issue| {
        (LANES.into_iter())
            .find(|lane| i.labels.iter().any(|l| l == lane))
            .unwrap_or(NO_LABEL)
    };
    let shown = |i: &Issue| !i.labels.iter().any(|l| l == READY_LABEL);
    let on = |key: &str| issues.iter().any(|i| i.key == key && shown(i));
    let link = |key: &str, title: Option<&str>| {
        let issue = issues.iter().find(|i| i.key == key);
        let url = (issue.map(|i| i.url.clone())).or_else(|| {
            let (slug, number) = source::github_ref(key)?;
            Some(format!("https://github.com/{slug}/issues/{number}"))
        });
        json!({ "key": key, "title": issue.map(|i| i.title.as_str()).or(title), "url": url })
    };
    let mut nodes = vec![];
    let mut edges = vec![];
    for (issue, (repo, assignees)) in issues.iter().zip(&held).filter(|(i, _)| shown(i)) {
        let blockers: Vec<_> = issue.blockers.iter().filter(|b| !b.resolved).collect();
        for blocker in blockers.iter().filter(|b| on(&b.key)) {
            edges.push(json!({ "from": blocker.key, "to": issue.key, "kind": "blocker" }));
        }
        let blocks = (issues.iter())
            .filter(|o| (o.blockers.iter()).any(|b| b.key == issue.key && !b.resolved))
            .map(|o| link(&o.key, None));
        nodes.push(json!({
            "key": issue.key,
            "repo": repo,
            "title": issue.title,
            "url": issue.url,
            "lane": lane(issue),
            "labels": issue.labels,
            "assignees": assignees,
            "body": issue.body,
            "blocked_by": blockers.iter().map(|b| link(&b.key, b.title.as_deref())).collect::<Vec<_>>(),
            "blocks": blocks.collect::<Vec<_>>(),
        }));
    }
    let lanes: Vec<&str> = (LANES.into_iter().chain([NO_LABEL]))
        .filter(|l| nodes.iter().any(|n| n["lane"] == *l))
        .collect();
    Ok(Some(
        json!({ "lanes": lanes, "nodes": nodes, "edges": edges }),
    ))
}
