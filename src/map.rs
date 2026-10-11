//! What the page draws a Repo's map from: the Source's cache, the state
//! files and herdr, as `status` shows them; never a new read of a Source.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{Value, json};

use crate::bucket;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::dispatch;
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
    let Some(slug) = config.repos.keys().find(|s| s.eq_ignore_ascii_case(slug)) else {
        return Ok(None);
    };
    let status = status::shown(ctx, false)?;
    let prs = stage::load(&ctx.config_dir)?;
    let repo = (status["repos"].as_array().into_iter().flatten()).find(|r| r["slug"] == *slug);
    let listed = |list: &str, key: &str| {
        (repo.and_then(|r| r[list].as_array()).into_iter().flatten()).any(|row| row["key"] == key)
    };
    let dispatches: Vec<&Value> = status["dispatches"]
        .as_array()
        .into_iter()
        .flatten()
        .collect();
    // Each issue's last Dispatch, while it is live or its PR merged in the last 7 days.
    let mut last: BTreeMap<&str, &Value> = BTreeMap::new();
    for d in &dispatches {
        last.insert(d["issue"].as_str().unwrap_or_default(), d);
    }
    let week_ago = state::iso(ctx.world.now() - Duration::from_secs(7 * 86_400));
    last.retain(|_, d| {
        d["closed_at"].is_null() || d["pr"]["merged_at"].as_str() >= Some(&week_ago)
    });
    let issues = source::cached(&ctx.config_dir, slug).map_or(vec![], |read| read.issues);
    let offered = |i: &Issue| i.open && i.labels.iter().any(|l| l == READY_LABEL);
    let mut keys: Vec<&str> = (issues.iter().filter(|i| offered(i)))
        .map(|i| i.key.as_str())
        .chain(
            (last.iter())
                .filter(|(_, d)| d["repo"] == *slug)
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
    for (key, d) in last.iter().filter(|(_, d)| d["repo"] == *slug) {
        let below = &d["stacked_on"];
        let Some(url) = below["url"]
            .as_str()
            .filter(|_| below["head_branch"] == d["base"])
        else {
            continue;
        };
        let of_dispatch = (dispatches.iter()).find(|d| d["pr"]["url"] == url);
        let target = of_dispatch.and_then(|d| d["issue"].as_str()).or_else(|| {
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
        let d = last.get(key).copied().unwrap_or(&Value::Null);
        let stage = match issue {
            _ if !d.is_null() => d["stage"].clone(),
            _ if listed("ready", key) => json!("Ready"),
            _ if listed("stackable", key) => json!("Stackable"),
            Some(issue) if offered(issue) => json!("Waiting"),
            _ => Value::Null,
        };
        let pr = match (&d["pr"], targets.get(key)) {
            (Value::Null, Some(&url)) => {
                json!({ "url": url, "draft": prs.get(url).map(|pr| pr.draft) })
            }
            (Value::Null, None) => Value::Null,
            (pr, _) => json!({ "url": pr["url"], "draft": pr["draft"] }),
        };
        let url = (issue.map(|i| i.url.clone()))
            .or_else(|| d["url"].as_str().map(String::from))
            .or_else(|| {
                let (slug, number) = source::github_ref(key)?;
                Some(format!("https://github.com/{slug}/issues/{number}"))
            });
        let title = (issue.map(|i| i.title.as_str()))
            .or(d["title"].as_str())
            .or_else(|| {
                let mut blockers = issues.iter().flat_map(|i| &i.blockers);
                blockers.find(|b| b.key == key)?.title.as_deref()
            });
        let research =(issue.is_some_and(|i| i.labels.iter().any(|l| l == "research")))
            || d["research"] == true;
        let verdict = &d["verdict"];
        nodes.insert(
            key,
            json!({
                "key": key,
                "title": title,
                "url": url,
                "kind": if research { "research" } else { "code" },
                "stage": stage,
                "agent_state": d["agent_state"],
                "pr": pr,
                "verdict": if verdict.is_null() { Value::Null } else {
                    json!({ "result": verdict["result"], "sha": verdict["sha"], "at": verdict["at"] })
                },
                "restarts": d["restarts"].as_array().map_or(0, Vec::len),
                "created_at": issue.map(|i| &i.created_at),
                "merged_at": d["pr"]["merged_at"],
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
    let status = status::shown(ctx, false)?;
    let mut shown = status["dispatches"].as_array().into_iter().flatten();
    let mut node = (shown.rfind(|s| s["issue"] == key).cloned()).unwrap_or_default();
    let folder = bucket::folder(d);
    let evidence: Vec<Value> = (bucket::files(ctx.world, &config, &folder)?.iter())
        .map(|f| {
            let url = format!("/bucket/{}", bucket::escaped(&format!("{folder}/{f}")));
            json!({ "path": f, "url": url })
        })
        .collect();
    node["evidence_folder"] = json!(format!("/bucket/{}/", bucket::escaped(&folder)));
    node["evidence"] = json!(evidence);
    Ok(Some(node))
}
