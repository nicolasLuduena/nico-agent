//! What the page draws a Repo's map from: the Source's cache, the state
//! files and herdr, as `status` shows them; never a new read of a Source.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{Value, json};

use crate::bucket;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::dispatch::{self, Dispatch};
use crate::http;
use crate::source::{self, Issue};
use crate::stage;
use crate::state;
use crate::status;
use crate::world::READY_LABEL;

/// `GET /api/map/<repo>`: the nodes and edges of the Repo `slug`; `None`
/// when it is no Repo. Its nodes are its open `ready-for-agent` issues, the
/// issues of its live Dispatches and of those whose PR merged in the last 7
/// days, the open Blockers of these, and the PRs its Stacked dispatches sit on.
pub fn map(ctx: &Context, slug: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let Some((slug, _)) = config.repo(slug) else {
        return Ok(None);
    };
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let prs = stage::load(&ctx.config_dir)?;
    let status = status::shown(ctx, &config, &dispatches, &prs, false)?;
    let repo = (status["repos"].as_array().into_iter().flatten()).find(|r| r["slug"] == *slug);
    let listed = |list: &str, key: &str| {
        (repo.and_then(|r| r[list].as_array()).into_iter().flatten()).any(|row| row["key"] == key)
    };
    let merged_at =
        |d: &Dispatch| stage::pr_of(&prs, d).and_then(|(_, pr)| pr.merged_at.as_deref());
    // Each issue's last Dispatch, with what `status` shows of it, while it
    // is live or its PR merged in the last 7 days.
    let shown = status["dispatches"].as_array().into_iter().flatten();
    let mut last: BTreeMap<&str, (&Dispatch, &Value)> = BTreeMap::new();
    for (d, shown) in dispatches.iter().zip(shown) {
        last.insert(&d.issue, (d, shown));
    }
    let week_ago = state::iso(ctx.world.now() - Duration::from_secs(7 * 86_400));
    last.retain(|_, (d, _)| d.closed_at.is_none() || merged_at(d) >= Some(&week_ago));
    let issues = source::cached(&ctx.config_dir, slug).map_or(vec![], |read| read.issues);
    let offered = |i: &Issue| i.open && i.labels.iter().any(|l| l == READY_LABEL);
    let mut keys: Vec<&str> = (issues.iter().filter(|i| offered(i)))
        .map(|i| i.key.as_str())
        .chain(
            (last.iter())
                .filter(|(_, (d, _))| d.repo == *slug)
                .map(|(k, _)| *k),
        )
        .collect();
    let mut edges = vec![];
    let walked: Vec<&Issue> = (issues.iter())
        .filter(|i| keys.contains(&i.key.as_str()))
        .collect();
    for issue in walked {
        for blocker in issue.blockers.iter().filter(|b| !b.resolved) {
            keys.push(&blocker.key);
            edges.push(json!({ "from": blocker.key, "to": issue.key, "kind": "blocker" }));
        }
    }
    // The PR each Stacked dispatch still sits on, by the issue it is of.
    let mut targets: BTreeMap<&str, &str> = BTreeMap::new();
    for (key, (d, _)) in last.iter().filter(|(_, (d, _))| d.repo == *slug) {
        let Some(below) = (d.stacked_on.as_ref()).filter(|below| below.head_branch == d.base)
        else {
            continue;
        };
        let url = below.url.as_str();
        let of_dispatch = (dispatches.iter()).find(|d| d.pr.as_deref() == Some(url));
        let target = of_dispatch.map(|d| d.issue.as_str()).or_else(|| {
            let mut blockers = issues.iter().flat_map(|i| &i.blockers);
            let blocker = blockers.find(|b| b.prs.iter().any(|pr| pr.url == url))?;
            Some(blocker.key.as_str())
        });
        let Some(target) = target else { continue };
        // A stack, not a Blocker: the edge is drawn once, as a stack.
        edges.retain(|e| e["from"] != target || e["to"] != *key);
        edges.push(json!({ "from": key, "to": target, "kind": "stack" }));
        keys.push(target);
        targets.insert(target, url);
    }
    let mut nodes = BTreeMap::new();
    for key in keys {
        let issue = issues.iter().find(|i| i.key == key);
        let (d, shown) = last.get(key).copied().unzip();
        let shown = shown.unwrap_or(&Value::Null);
        let stage = match issue {
            _ if d.is_some() => shown["stage"].clone(),
            _ if listed("ready", key) || listed("gardening", key) => json!("Ready"),
            _ if listed("stackable", key) => json!("Stackable"),
            Some(issue) if offered(issue) => json!("Waiting"),
            _ => Value::Null,
        };
        let pr = match (d.and_then(|d| stage::pr_of(&prs, d)), targets.get(key)) {
            (Some((url, pr)), _) => json!({ "url": url, "draft": pr.draft }),
            (None, Some(&url)) => json!({ "url": url, "draft": prs.get(url).map(|pr| pr.draft) }),
            (None, None) => Value::Null,
        };
        let url = (issue.map(|i| i.url.clone()))
            .or_else(|| d.map(|d| d.url.clone()))
            .or_else(|| {
                let (slug, number) = source::github_ref(key)?;
                Some(format!("https://github.com/{slug}/issues/{number}"))
            });
        let title = (issue.map(|i| i.title.as_str()))
            .or(d.map(|d| d.title.as_str()))
            .or_else(|| {
                let mut blockers = issues.iter().flat_map(|i| &i.blockers);
                blockers.find(|b| b.key == key)?.title.as_deref()
            });
        let research = (issue.is_some_and(|i| i.labels.iter().any(|l| l == "research")))
            || d.is_some_and(|d| d.research);
        let verdict = &shown["verdict"];
        nodes.insert(
            key,
            json!({
                "key": key,
                "title": title,
                "url": url,
                "kind": if research { "research" } else { "code" },
                "stage": stage,
                "agent_state": shown["agent_state"],
                "pr": pr,
                "review": shown["review"],
                "verdict": if verdict.is_null() { Value::Null } else {
                    json!({ "result": verdict["result"], "sha": verdict["sha"], "at": verdict["at"] })
                },
                "restarts": d.map_or(0, |d| d.restarts.len()),
                "created_at": issue.map(|i| &i.created_at),
                "merged_at": d.and_then(merged_at),
            }),
        );
    }
    let nodes: Vec<Value> = nodes.into_values().collect();
    Ok(Some(json!({ "nodes": nodes, "edges": edges })))
}

/// `GET /api/node/<issue>`: the issue's last Dispatch as `status` shows it,
/// its restarts and Verdict with findings among it, and every file of the
/// issue's Bucket folder; `None` when the issue has no Dispatch.
pub fn node(ctx: &Context, issue: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let Ok(key) = dispatch::key(&config, &dispatches, issue) else {
        return Ok(None);
    };
    let Some(d) = dispatches.iter().rfind(|d| d.issue == key) else {
        return Ok(None);
    };
    let prs = stage::load(&ctx.config_dir)?;
    let status = status::shown(ctx, &config, &dispatches, &prs, false)?;
    let mut shown = status["dispatches"].as_array().into_iter().flatten();
    let mut node = (shown.rfind(|s| s["issue"] == key).cloned()).unwrap_or_default();
    let folder = bucket::folder(d);
    let evidence: Vec<Value> = (bucket::files(ctx.world, &config, &folder)?.iter())
        .map(|f| {
            let url = format!("/bucket/{}", http::escaped(&format!("{folder}/{f}")));
            json!({ "path": f, "url": url })
        })
        .collect();
    node["evidence_folder"] = json!(format!("/bucket/{}/", http::escaped(&folder)));
    node["evidence"] = json!(evidence);
    Ok(Some(node))
}
