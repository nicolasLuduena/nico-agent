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

/// `GET /api/map/<project>`: the nodes and edges of the Project `name`, a
/// Repo's own named by its slug; `None` when it is no Project. Its nodes are
/// its Repos' open `ready-for-agent` issues, the issues of their live
/// Dispatches and of those whose PR merged in the last 7 days, the open
/// Blockers of these, and the PRs their Stacked dispatches sit on; each names
/// its Repo, none for a Blocker outside the Project.
pub fn map(ctx: &Context, name: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let slugs: Vec<&String> = (config.repos.iter())
        .filter(|(slug, repo)| repo.project_name(slug) == name)
        .map(|(slug, _)| slug)
        .collect();
    if slugs.is_empty() && !config.projects.contains_key(name) {
        return Ok(None);
    }
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let prs = stage::load(&ctx.config_dir)?;
    let status = status::shown(ctx, &config, &dispatches, &prs, false)?;
    let rows: Vec<&Value> = (status["repos"].as_array().into_iter().flatten())
        .filter(|r| slugs.iter().any(|slug| r["slug"] == **slug))
        .collect();
    let row = |list: &str, key: &str| {
        (rows.iter().filter_map(|r| r[list].as_array()).flatten()).find(|row| row["key"] == key)
    };
    let listed = |list: &str, key: &str| row(list, key).is_some();
    let merged_at =
        |d: &Dispatch| stage::pr_of(&prs, d).and_then(|(_, pr)| pr.merged_at.as_deref());
    // Each issue's last Dispatch in the Project, with what `status` shows of
    // it, while it is live or its PR merged in the last 7 days.
    let shown = status["dispatches"].as_array().into_iter().flatten();
    let mut last: BTreeMap<&str, (&Dispatch, &Value)> = BTreeMap::new();
    for (d, shown) in dispatches.iter().zip(shown) {
        if slugs.contains(&&d.repo) {
            last.insert(&d.issue, (d, shown));
        }
    }
    let week_ago = state::iso(ctx.world.now() - Duration::from_secs(7 * 86_400));
    last.retain(|_, (d, _)| d.closed_at.is_none() || merged_at(d) >= Some(&week_ago));
    // The issues the Project's Sources hold, and the Repo each is in, with
    // the user each read and the Repo's slug while its `mine` Switch is on.
    let mut issues: Vec<Issue> = vec![];
    let mut held: BTreeMap<String, &str> = BTreeMap::new();
    let mut readers: BTreeMap<&str, (Vec<String>, Option<String>)> = BTreeMap::new();
    for slug in &slugs {
        let Some(read) = source::cached(&ctx.config_dir, &config, slug)? else {
            continue;
        };
        for issue in read.issues {
            held.insert(issue.key.clone(), slug);
            issues.push(issue);
        }
        readers.insert(slug, (read.user, read.mine));
    }
    // A Blocker in another Repo of the Project is keyed in GitHub's casing; its node, in the config's.
    for blocker in issues.iter_mut().flat_map(|i| &mut i.blockers) {
        let own = source::github_ref(&blocker.key).and_then(|(slug, number)| {
            let own = slugs.iter().find(|s| s.eq_ignore_ascii_case(slug))?;
            Some(format!("{own}#{number}"))
        });
        if let Some(own) = own {
            blocker.key = own;
        }
    }
    let offered = |i: &Issue| i.open && i.labels.iter().any(|l| l == READY_LABEL);
    let mut keys: Vec<&str> = (issues.iter().filter(|i| offered(i)))
        .map(|i| i.key.as_str())
        .chain(last.keys().copied())
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
    for (key, (d, _)) in &last {
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
        let reader = held.get(key).map(|slug| &readers[slug]);
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
        let repo = (d.map(|d| d.repo.as_str()))
            .or_else(|| held.get(key).copied())
            .or_else(|| source::repo_in(&config, slugs.first()?, key).map(String::as_str));
        let mut node = json!({
            "key": key,
            "repo": repo,
            "title": title,
            "url": url,
            "kind": if research { "research" } else { "code" },
            "assignees": issue.zip(reader).map(|(i, (user, _))| source::assignees(i, user)),
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
        });
        // Why a Waiting node waits, as `status` says it, or as a hand Dispatch
        // is refused when that is for who it is assigned to.
        let yours = (issue.zip(reader)).and_then(|(i, (user, mine))| {
            let why = source::why_not_startable(i, user, mine.as_deref())?;
            source::why_not_yours(i, user, mine.as_deref()).filter(|yours| *yours == why)
        });
        if let Some(waiting) = row("waiting", key).filter(|_| stage == "Waiting") {
            node["waits"] = waiting["reason"].clone();
        } else if let Some(why) = yours.filter(|_| stage == "Waiting") {
            node["waits"] = json!(why);
            node["assignee_holds"] = json!(true);
        }
        nodes.insert(key, node);
    }
    let nodes: Vec<Value> = nodes.into_values().collect();
    Ok(Some(json!({ "nodes": nodes, "edges": edges })))
}

/// `GET /api/node/<issue>`: the issue's last Dispatch as `status` shows it,
/// its restarts and Verdict with findings among it, and every file of the
/// issue's Bucket folder, and while it is Asking its Implementer's pane;
/// `None` when the issue has no Dispatch.
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
    // What the Asking Implementer shows, as herdr has it, for the user to answer
    // from; Asking as the band says it, herdr's blocked before a tick records it.
    let blocked = node["agent_state"]["implementer"] == "blocked";
    if d.closed_at.is_none() && (d.asking.is_some() || blocked) {
        match ctx.world.herdr_agent_read(&d.implementer.agent) {
            Ok(pane) => node["pane"] = json!(pane),
            Err(e) => node["pane_error"] = json!(e.0),
        }
    }
    Ok(Some(node))
}
