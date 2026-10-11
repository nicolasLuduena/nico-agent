//! What `serve` answers over HTTP, for the app: JSON, each route the shape
//! of the command it stands for. A route is an arm of [`answer`] and a line
//! of [`ROUTES`].

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Map, Value, json};

use crate::bucket;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config;
use crate::dispatch;
use crate::pause;
use crate::refresh;
use crate::repo;
use crate::stage;
use crate::status;
use crate::world::{AgentState, Answer, HttpRequest, HttpResponse, World};

pub const PORT: u16 = 42069;

/// The app, as `build.rs` built it from `web/`: each file's path, Content-Type and bytes.
const APP: &[(&str, &str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/app.rs"));

/// Every route and what it answers, for help lines.
const ROUTES: &[(&str, &str)] = &[
    ("GET /", "the app"),
    ("GET /api/status", "the status of every Repo and Dispatch"),
    (
        "GET /api/events",
        "a stream of `changed`, sent when state or an Agent state changes",
    ),
    (
        "POST /api/dispatch {issue, harness, model, effort}",
        "`nico-agent dispatch` of the issue",
    ),
    ("POST /api/refresh", "`nico-agent refresh`"),
    (
        "PATCH /api/repo/<owner/name>/switches {name: bool}",
        "set the Repo's switches",
    ),
    (
        "GET /bucket/<path>",
        "a file of the Bucket, where each Verdict's Evidence is kept",
    ),
];

/// Answer `request`, as the app sent it.
pub fn answer(ctx: &Context, request: &HttpRequest) -> Answer {
    let path = request.url.split('?').next().unwrap_or_default();
    match (request.method.as_str(), path) {
        ("GET", "/api/status") => reply(status(ctx)),
        ("GET", "/api/events") => events(ctx),
        ("GET", path) if let Some((_, kind, bytes)) = APP.iter().find(|(p, ..)| *p == path) => {
            Answer::Whole(HttpResponse {
                status: 200,
                headers: vec![("Content-Type".into(), (*kind).into())],
                body: bytes.to_vec(),
            })
        }
        ("POST", "/api/dispatch") => ran(dispatch(ctx, request)),
        ("POST", "/api/refresh") => ran(refresh::refresh(&[], ctx)),
        ("PATCH", path)
            if let Some(slug) = (path.strip_prefix("/api/repo/"))
                .and_then(|path| path.strip_suffix("/switches")) =>
        {
            ran(body(request).and_then(|set| repo::switches(ctx, slug, &set)))
        }
        ("GET", path) if let Some(path) = path.strip_prefix("/bucket/") => bucket::file(ctx, path),
        (method, _) => {
            let help: Vec<String> = (ROUTES.iter())
                .map(|(route, answers)| format!("{route}: {answers}"))
                .collect();
            let error = format!("no route {method} {path}");
            json(404, json!({ "error": error, "help": help }))
        }
    }
}

/// `status`'s answer from the Sources' caches alone, plus per Repo what the
/// page shows of it beside the map and offers in its Dispatch form.
fn status(ctx: &Context) -> Result<Value, Refusal> {
    let mut shown = status::shown(ctx, false)?;
    let config = config::load(&ctx.config_dir)?;
    let paused = pause::until(ctx.world, &ctx.config_dir, "GitHub")?;
    let prs = stage::load(&ctx.config_dir)?;
    let harnesses: Map<String, Value> = (config.harnesses.iter())
        .map(|(name, h)| {
            (
                name.clone(),
                json!({ "models": h.models, "efforts": h.efforts }),
            )
        })
        .collect();
    for shown in shown["repos"].as_array_mut().into_iter().flatten() {
        // The config may have changed since `status` read it.
        let Some((slug, repo)) = shown["slug"]
            .as_str()
            .and_then(|slug| config.repos.get_key_value(slug))
        else {
            continue;
        };
        let checked = (prs.values())
            .filter(|pr| pr.repo == *slug)
            .filter_map(|pr| pr.checked_at.as_ref())
            .max();
        let page = json!({
            "prs_checked_at": checked,
            "github_paused_until": paused,
            "switches": repo::shown(&repo.switches),
            "room": repo.room,
            "implementer": repo.implementer,
            "reviewer": config.reviewer(repo, &repo.implementer.harness),
            "harnesses": harnesses,
        });
        for (key, value) in page.as_object().into_iter().flatten() {
            shown[key] = value.clone();
        }
    }
    Ok(shown)
}

/// `changed`, with no payload, whenever a look every 10 seconds sees other
/// state than the last one did; nothing otherwise.
fn events(ctx: &Context) -> Answer {
    let dir = ctx.config_dir.clone();
    let mut last = (files(&dir), agents(ctx.world, &dir));
    Answer::Events {
        every: Duration::from_secs(10),
        poll: Box::new(move |world| {
            let now = (files(&dir), agents(world, &dir));
            if now == last {
                return String::new();
            }
            last = now;
            // A browser drops an event without data.
            "event: changed\ndata: {}\n\n".into()
        }),
    }
}

/// The state files in `dir` and under it, by path, with what each holds;
/// not the locks, nor a write's temp file.
fn files(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut files = BTreeMap::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(self::files(&path));
        } else if !path.extension().is_some_and(|e| e == "lock" || e == "tmp") {
            let text = fs::read(&path).unwrap_or_default();
            files.insert(path, text);
        }
    }
    files
}

/// The Agent state of each live Dispatch's agents, as herdr says now; `None`
/// with none live, or herdr not answering. The user's own agents are not the page's.
fn agents(world: &dyn World, dir: &Path) -> Option<BTreeMap<String, AgentState>> {
    let dispatches = dispatch::load(dir).unwrap_or_default();
    let names: Vec<&String> = (dispatches.iter())
        .filter(|d| d.closed_at.is_none())
        .flat_map(|d| {
            [
                Some(&d.implementer.agent),
                d.reviewer.as_ref().map(|r| &r.launch.agent),
            ]
        })
        .flatten()
        .collect();
    if names.is_empty() {
        return None;
    }
    let agents = world.herdr_agents().ok()?;
    Some(
        (agents.into_iter())
            .filter(|a| names.contains(&&a.name))
            .map(|a| (a.name, a.state))
            .collect(),
    )
}

/// A command's answer as JSON: its own, or its `{error, help}`.
fn reply(answer: Result<Value, Refusal>) -> Answer {
    match answer {
        Ok(answer) => json(200, answer),
        Err(no) => json(500, json!({ "error": no.error, "help": no.help })),
    }
}

/// A command the app ran, answered as [`reply`] does but with its refusal a
/// 4xx: 400 for a bad request (exit 2), 409 for one the state refuses.
fn ran(answer: Result<Value, Refusal>) -> Answer {
    match answer {
        Err(no) => {
            let status = if no.exit_code == 2 { 400 } else { 409 };
            json(status, json!({ "error": no.error, "help": no.help }))
        }
        ok => reply(ok),
    }
}

/// `dispatch <issue> --harness --model --effort`, from the body's
/// `{issue, harness, model, effort}`; a launch null or left out is unset.
fn dispatch(ctx: &Context, request: &HttpRequest) -> Result<Value, Refusal> {
    let body = body(request)?;
    let mut args = vec![];
    for name in ["issue", "harness", "model", "effort"] {
        match &body[name] {
            Value::Null => {}
            Value::String(issue) if name == "issue" => args.push(issue.clone()),
            Value::String(flag) => args.push(format!("--{name}={flag}")),
            other => {
                let error = format!("{name} is a string, not {other}");
                return Err(bad_invocation(error, "dispatch"));
            }
        }
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    dispatch::dispatch(&args, ctx)
}

/// The request's body, which is JSON, or a bad request.
fn body(request: &HttpRequest) -> Result<Value, Refusal> {
    serde_json::from_str(&request.body).map_err(|e| Refusal {
        error: format!("the body is not JSON: {e}"),
        help: vec![],
        exit_code: 2,
    })
}

pub(crate) fn json(status: u16, body: Value) -> Answer {
    Answer::Whole(HttpResponse {
        status,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: body.to_string().into(),
    })
}
