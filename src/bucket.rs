//! The Bucket: a git repo outside the config directory where Evidence
//! outlives its worktree. Each Verdict's is committed at
//! `<repo>/<issue>/<sha>/`, e.g. `acme/api/7/<sha>/` for `acme/api#7` or
//! `acme/api/BLE-12/<sha>/` for a Linear issue: the files of the worktree's
//! `.evidence/<issue>/`, and `findings.md`.

use std::fs::File;

use serde_json::json;

use crate::cli::{Context, Refusal};
use crate::config::{self, Config};
use crate::dispatch::Dispatch;
use crate::http;
use crate::state;
use crate::world::{Answer, HttpResponse, World, WorldError};

const README: &str = "# nico-agent's Bucket\n\nEvidence, one commit per Verdict: `<owner>/<repo>/<issue>/<sha>/` holds what\nthe worktree's `.evidence/<issue>/` held when the Verdict on `<sha>` was\nrecorded, and the Reviewer's `findings.md`.\n";

/// Make the Bucket, a git repo with its README committed, unless there is one.
pub fn create(ctx: &Context, config: &Config) -> Result<(), Refusal> {
    let _lock = lock(ctx)?;
    made(ctx.world, config)
}

/// The Bucket, made under its lock if it is missing.
fn made(world: &dyn World, config: &Config) -> Result<(), Refusal> {
    let path = &config.bucket.path;
    if world.git_remotes(path).map_err(refused)?.is_some() {
        return Ok(());
    }
    (world.git_init(path))
        .and_then(|()| world.write_file(&format!("{path}/README.md"), README.as_bytes()))
        .and_then(|()| world.git_commit(path, "README.md", "nico-agent's Bucket"))
        .map_err(refused)
}

/// The Bucket's lock, held while a command changes it: two at once would
/// collide on git's index, or one commit the other's files.
fn lock(ctx: &Context) -> Result<File, Refusal> {
    Ok(state::lock(&ctx.config_dir.join("bucket"))?)
}

/// Commit `d`'s Evidence and `findings` to the Bucket with `message`, for
/// the Verdict on `sha`; the Bucket made first if it is missing.
pub fn keep(
    ctx: &Context,
    config: &Config,
    d: &Dispatch,
    sha: &str,
    findings: Option<&str>,
    message: &str,
) -> Result<(), Refusal> {
    let (world, _lock) = (ctx.world, lock(ctx)?);
    made(world, config)?;
    let bucket = &config.bucket.path;
    let kept = format!("{}/{sha}", folder(d));
    let to = format!("{bucket}/{kept}");
    if let Some(worktree) = &d.worktree {
        let from = format!("{worktree}/{}", evidence(d));
        world.copy_dir(&from, &to).map_err(refused)?;
    }
    if let Some(text) = findings {
        let file = format!("{to}/findings.md");
        world.write_file(&file, text.as_bytes()).map_err(refused)?;
    }
    world.git_commit(bucket, &kept, message).map_err(refused)
}

/// `GET /bucket/<path>`: the file at `path`, URL-escaped, in the Bucket's
/// working tree, or for a folder (`path` ending in `/`) a page of links to
/// every file under it; never one outside it, nor its git store.
pub fn file(ctx: &Context, path: &str) -> Answer {
    let path = unescaped(path);
    if path.split('/').any(|part| part == ".." || part == ".git") {
        let error = format!("{path} is not in the Bucket's working tree");
        let help = ["Ask for a file under /bucket/<owner>/<repo>/<issue>/<sha>/"];
        return http::json(403, json!({ "error": error, "help": help }));
    }
    if path.is_empty() || path.ends_with('/') {
        return listing(ctx, &path);
    }
    let read = config::load(&ctx.config_dir).and_then(|config| {
        let file = format!("{}/{path}", config.bucket.path);
        Ok(ctx.world.read_file(&file)?)
    });
    match read {
        Ok(Some(body)) => sandboxed(media_type(&path), body),
        Ok(None) => {
            let error = format!("no file {path} in the Bucket");
            let help = ["Each Verdict's Evidence is under /bucket/<owner>/<repo>/<issue>/<sha>/"];
            http::json(404, json!({ "error": error, "help": help }))
        }
        Err(no) => http::json(500, json!({ "error": no.error, "help": no.help })),
    }
}

/// The Bucket's `folder` as a page linking each file under it.
fn listing(ctx: &Context, folder: &str) -> Answer {
    let files = config::load(&ctx.config_dir)
        .and_then(|config| files(ctx.world, &config, folder.trim_end_matches('/')));
    match files {
        Ok(files) if !files.is_empty() => {
            let html = |text: &str| text.replace('&', "&amp;").replace('<', "&lt;");
            let links: String = (files.iter())
                .map(|f| format!("<li><a href=\"{}\">{}</a>\n", escaped(f), html(f)))
                .collect();
            let title = html(&format!("/bucket/{folder}"));
            let page = format!("<!doctype html>\n<title>{title}</title>\n<ul>\n{links}</ul>\n");
            sandboxed("text/html; charset=utf-8", page.into())
        }
        Ok(_) => {
            let error = format!("no folder {folder} in the Bucket");
            let help = ["Each Verdict's Evidence is under /bucket/<owner>/<repo>/<issue>/<sha>/"];
            http::json(404, json!({ "error": error, "help": help }))
        }
        Err(no) => http::json(500, json!({ "error": no.error, "help": no.help })),
    }
}

/// `body`, of `media_type`, served so that no script in it runs on the app's
/// origin: Evidence is an agent's output.
fn sandboxed(media_type: &str, body: Vec<u8>) -> Answer {
    Answer::Whole(HttpResponse {
        status: 200,
        headers: vec![
            ("Content-Type".into(), media_type.into()),
            ("Content-Security-Policy".into(), "sandbox".into()),
        ],
        body,
    })
}

/// Every file under the Bucket's `folder`, by its path in it; none of its git store.
pub fn files(world: &dyn World, config: &Config, folder: &str) -> Result<Vec<String>, Refusal> {
    let path = format!("{}/{folder}", config.bucket.path);
    let files = world
        .list_files(path.trim_end_matches('/'))
        .map_err(refused)?;
    Ok((files.into_iter())
        .filter(|f| !f.split('/').any(|part| part == ".git"))
        .collect())
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

/// What a browser should take a file for, by its extension; bytes to save if none it shows.
fn media_type(path: &str) -> &'static str {
    let extension = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    match extension.as_deref().unwrap_or_default() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "html" => "text/html; charset=utf-8",
        "md" | "txt" | "log" | "json" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Where the app serves `d`'s folder: on `bucket.url`, else on serve's own port.
pub fn url(config: &Config, d: &Dispatch) -> String {
    let local = format!("http://127.0.0.1:{}", http::PORT);
    let base = config.bucket.url.as_deref().unwrap_or(&local);
    format!("{}/bucket/{}/", base.trim_end_matches('/'), folder(d))
}

/// Where in its worktree `d`'s Evidence is saved for the Bucket to keep: `.evidence/<issue>`.
pub fn evidence(d: &Dispatch) -> String {
    format!(".evidence/{}", id(&d.issue))
}

/// The Bucket's folder for `d`'s issue: `<repo>/<issue>`.
pub fn folder(d: &Dispatch) -> String {
    format!("{}/{}", d.repo, id(&d.issue))
}

/// An issue as one path segment: the number of `owner/repo#N`, a Linear identifier as is.
fn id(issue: &str) -> &str {
    issue.rsplit_once('#').map_or(issue, |(_, number)| number)
}

fn refused(e: WorldError) -> Refusal {
    let help =
        "Set bucket.path in config.toml to a folder you can write, then run the command again";
    Refusal::new(e.0, vec![help.into()])
}
