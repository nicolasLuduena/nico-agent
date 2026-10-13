//! What `serve` answers over HTTP, for the app: JSON, each route the shape
//! of the command it stands for. A route is an arm of [`answer`] and a line
//! of [`ROUTES`].

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::away;
use crate::bucket;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config;
use crate::dispatch;
use crate::map;
use crate::refresh;
use crate::repo;
use crate::stage;
use crate::status;
use crate::wiki;
use crate::world::{AgentState, Answer, HttpRequest, HttpResponse, World};

/// The app, as `build.rs` built it from `web/`: each file's path, Content-Type and bytes.
const APP: &[(&str, &str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/app.rs"));

/// Every route and what it answers, for help lines.
const ROUTES: &[(&str, &str)] = &[
    ("GET /", "the app"),
    ("GET /api/status", "the status of every Repo and Dispatch"),
    (
        "GET /api/map/<project>",
        "the issues of the Project's Repos and how they block and stack on each other",
    ),
    (
        "GET /api/node/<issue>",
        "the issue's Dispatch, its restarts, its Verdict's findings and its Evidence",
    ),
    (
        "GET /api/events",
        "a stream of `changed`, sent when state or an Agent state changes, and a keepalive comment otherwise",
    ),
    (
        "GET /api/wikis",
        "each Repo's Wiki, with the commit it describes, when it was built and its Gaps",
    ),
    (
        "GET /api/wiki/<id>",
        "the Wiki, a Repo's by its slug: its Components, Interpretations, Anchors and Gaps",
    ),
    (
        "POST /api/dispatch {issue, harness, model, effort}",
        "`nico-agent dispatch` of the issue",
    ),
    ("POST /api/refresh", "`nico-agent refresh`"),
    (
        "PATCH /api/repo/<owner/name>/switches {name: bool}",
        "set the Repo's switches; null takes its Project's or the default",
    ),
    (
        "PATCH /api/repo/<owner/name> {implementer, reviewer, room, base, project, install, switches}",
        "set the Repo's own settings; null takes its Project's or the default",
    ),
    (
        "PATCH /api/project/<name> {implementer, reviewer, room, base, switches}",
        "set the Project's defaults for its Repos; null removes one",
    ),
    (
        "POST /api/repo {slug, path, project}",
        "`nico-agent repo add`",
    ),
    (
        "DELETE /api/repo/<owner/name>",
        "`nico-agent repo rm`, refused while the Repo has a Dispatch In flight",
    ),
    (
        "GET /bucket/<path>",
        "a file of the Bucket, where each Verdict's Evidence is kept, or a page of a folder's",
    ),
];

/// Answer `request`, as the app sent it to serve on `port`.
pub fn answer(ctx: &Context, port: u16, request: &HttpRequest) -> Answer {
    if let Some(refused) = foreign(ctx, port, request) {
        return refused;
    }
    let path = request.url.split('?').next().unwrap_or_default();
    match (request.method.as_str(), path) {
        ("GET", "/api/status") => reply(status(ctx)),
        ("GET", "/api/events") => events(ctx),
        ("GET", path) if let Some(name) = path.strip_prefix("/api/map/") => {
            let name = unescaped(name);
            let help = "Ask for a Project /api/status lists";
            found(
                map::map(ctx, &name),
                format!("{name} is not a Project"),
                help,
            )
        }
        ("GET", path) if let Some(issue) = path.strip_prefix("/api/node/") => {
            // `owner/repo#N`, its `#` escaped.
            let issue = unescaped(issue);
            let help = "Ask for an issue /api/status lists among its dispatches";
            found(
                map::node(ctx, &issue),
                format!("{issue} has no Dispatch"),
                help,
            )
        }
        ("GET", "/api/wikis") => reply(wiki::list(ctx)),
        ("GET", path) if let Some(id) = path.strip_prefix("/api/wiki/") => {
            let id = unescaped(id);
            let help = "Ask for a Wiki /api/wikis lists, or build one: nico-agent wiki build <owner/name>";
            found(wiki::get(ctx, &id), format!("{id} has no Wiki"), help)
        }
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
            ran(body(request).and_then(|set| repo::switches(ctx, &unescaped(slug), &set)))
        }
        ("PATCH", path) if let Some(slug) = path.strip_prefix("/api/repo/") => {
            ran(body(request).and_then(|set| repo::set(ctx, &unescaped(slug), &set)))
        }
        ("PATCH", path) if let Some(name) = path.strip_prefix("/api/project/") => {
            ran(body(request).and_then(|set| repo::set_project(ctx, &unescaped(name), &set)))
        }
        ("POST", "/api/repo") => ran(add(ctx, request)),
        ("DELETE", path) if let Some(slug) = path.strip_prefix("/api/repo/") => {
            ran(repo::rm_idle(ctx, &unescaped(slug)))
        }
        ("GET", path) if let Some(path) = path.strip_prefix("/bucket/") => {
            bucket::file(ctx, &unescaped(path))
        }
        (method, _) => {
            let help: Vec<String> = (ROUTES.iter())
                .map(|(route, answers)| format!("{route}: {answers}"))
                .collect();
            let no_route = format!("no route {method} {path}");
            error(404, &no_route, &help)
        }
    }
}

/// A 403 for what another site's page sends through the browser: a request
/// on a host not serve's (a name rebound to 127.0.0.1 included), or a POST,
/// PATCH or DELETE from a page on another host; `None` for one serve answers.
fn foreign(ctx: &Context, port: u16, request: &HttpRequest) -> Option<Answer> {
    let mut hosts = vec![format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    // Read each time, as the Bucket's links are: the tunnel's host is in once it is set.
    let tunnel = config::load(&ctx.config_dir)
        .ok()
        .and_then(|c| c.bucket.url);
    hosts.extend(tunnel.map(|url| host_of(&url).to_string()));
    let header = |name: &str| {
        (request.headers.iter())
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    };
    // Not the tunnel's host itself: a page rebound to 127.0.0.1 reads this.
    let help = [format!(
        "Ask serve on 127.0.0.1:{port}, localhost:{port} or bucket.url's host"
    )];
    let Some(host) = header("Host") else {
        return Some(error(403, "the request names no Host", &help));
    };
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case(host)) {
        return Some(error(403, &format!("Host {host} is not serve's"), &help));
    }
    let origin = header("Origin")
        .filter(|_| matches!(request.method.as_str(), "POST" | "PATCH" | "DELETE"))?;
    // `null`, a sandboxed page's or a file's, is no host of serve's: foreign too.
    if host_of(origin).eq_ignore_ascii_case(host) {
        return None;
    }
    let help = ["Send it from the app serve answers, or with no Origin"];
    Some(error(
        403,
        &format!("Origin {origin} is not the request's Host"),
        &help,
    ))
}

/// `url`'s host[:port]: what follows its `://`, up to its path.
fn host_of(url: &str) -> &str {
    let at = url.split_once("://").map_or(url, |(_, at)| at);
    at.split('/').next().unwrap_or_default()
}

/// `status`'s answer from the Sources' caches alone, plus per Repo when its
/// PRs were last read and the Harnesses its Dispatch form offers.
fn status(ctx: &Context) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let prs = stage::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let mut shown = status::shown(ctx, &config, &dispatches, &prs, false)?;
    let paused = shown["sources"]["github"]["paused_until"].clone();
    let harnesses: Map<String, Value> = (config.harnesses.iter())
        .map(|(name, h)| {
            (
                name.clone(),
                json!({ "models": h.models, "efforts": h.efforts }),
            )
        })
        .collect();
    // `status` shows a row per Repo of the config, in its order.
    let rows = shown["repos"].as_array_mut().into_iter().flatten();
    for (shown, slug) in rows.zip(config.repos.keys()) {
        let checked = (prs.values())
            .filter(|pr| pr.repo == *slug)
            .filter_map(|pr| pr.checked_at.as_ref())
            .max();
        let page = json!({
            "prs_checked_at": checked,
            "github_paused_until": paused,
            "harnesses": harnesses,
        });
        for (key, value) in page.as_object().into_iter().flatten() {
            shown[key] = value.clone();
        }
    }
    // shortcut: an unreadable morning.md shows as none, like a missing one; say why if one ever is.
    shown["morning_summary"] = json!(fs::read_to_string(ctx.config_dir.join(away::SUMMARY)).ok());
    Ok(shown)
}

/// `changed`, with no payload, whenever a look every 10 seconds sees other
/// state than the last one did; a comment otherwise, which browsers ignore,
/// so a proxy never sees the stream idle (Cloudflare closes it at 100 seconds).
fn events(ctx: &Context) -> Answer {
    let dir = ctx.config_dir.clone();
    let mut last = (files(&dir), agents(ctx.world, &dir));
    Answer::Events {
        every: Duration::from_secs(10),
        poll: Box::new(move |world| {
            let now = (files(&dir), agents(world, &dir));
            if now == last {
                return ": keepalive\n\n".into();
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
        Err(no) => error(500, &no.error, &no.help),
    }
}

/// A read of what the path names, answered as [`reply`] does; 404 with
/// `missing` and `help` when it names nothing.
fn found(answer: Result<Option<Value>, Refusal>, missing: String, help: &str) -> Answer {
    match answer {
        Ok(None) => error(404, &missing, &[help]),
        answer => reply(answer.map(Option::unwrap_or_default)),
    }
}

/// A command the app ran, answered as [`reply`] does but with its refusal a
/// 4xx: 400 for a bad request (exit 2), 409 for one the state refuses.
fn ran(answer: Result<Value, Refusal>) -> Answer {
    match answer {
        Err(no) => {
            let status = if no.exit_code == 2 { 400 } else { 409 };
            error(status, &no.error, &no.help)
        }
        ok => reply(ok),
    }
}

/// `dispatch <issue> --harness --model --effort`, from the body's
/// `{issue, harness, model, effort}`; a launch null or left out is unset.
fn dispatch(ctx: &Context, request: &HttpRequest) -> Result<Value, Refusal> {
    let argv = argv(
        request,
        "dispatch",
        &["issue", "harness", "model", "effort"],
    )?;
    let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
    dispatch::dispatch(&argv, ctx)
}

/// `repo add <slug> --path --project`, from the body's `{slug, path, project}`.
fn add(ctx: &Context, request: &HttpRequest) -> Result<Value, Refusal> {
    let argv = argv(request, "repo add", &["slug", "path", "project"])?;
    let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
    repo::add(&argv, ctx)
}

/// `command`'s arguments from the body's `{first, flag...}`: `first`'s value,
/// then `--<flag>=<value>`; one null or left out is unset.
fn argv(request: &HttpRequest, command: &str, names: &[&str]) -> Result<Vec<String>, Refusal> {
    let body = body(request)?;
    let mut args = vec![];
    for (i, name) in names.iter().enumerate() {
        match &body[name] {
            Value::Null => {}
            Value::String(first) if i == 0 => args.push(first.clone()),
            Value::String(flag) => args.push(format!("--{name}={flag}")),
            other => {
                let error = format!("{name} is a string, not {other}");
                return Err(bad_invocation(error, command));
            }
        }
    }
    Ok(args)
}

/// The request's body, which is JSON, or a bad request.
fn body(request: &HttpRequest) -> Result<Value, Refusal> {
    serde_json::from_str(&request.body).map_err(|e| Refusal {
        error: format!("the body is not JSON: {e}"),
        help: vec![],
        exit_code: 2,
    })
}

/// `path` as a URL's path: each byte but `/` and the unreserved ones `%XX`-escaped.
pub fn escaped(path: &str) -> String {
    (path.bytes())
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                char::from(b).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// `text` with each `%XX` escape decoded; any other `%` kept as is.
pub fn unescaped(text: &str) -> String {
    let (bytes, mut out, mut i) = (text.as_bytes(), vec![], 0);
    while i < bytes.len() {
        let hex = (bytes.get(i + 1..i + 3))
            .and_then(|hex| u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(byte)) => (out.push(byte), i += 3),
            (byte, _) => (out.push(byte), i += 1),
        };
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `{error, help}`, what every refusal answers, with `status`.
pub(crate) fn error(status: u16, error: &str, help: &[impl Serialize]) -> Answer {
    json(status, json!({ "error": error, "help": help }))
}

pub(crate) fn json(status: u16, body: Value) -> Answer {
    Answer::Whole(HttpResponse {
        status,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: body.to_string().into(),
    })
}
