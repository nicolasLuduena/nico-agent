//! The Bucket: a git repo outside the config directory where Evidence
//! outlives its worktree. It is committed at `<repo>/<issue>/<sha>/`, e.g.
//! `acme/api/7/<sha>/` for `acme/api#7` or `acme/api/BLE-12/<sha>/` for a
//! Linear issue, as each PR head is seen, on its Verdict and at Close: the
//! files of the worktree's `.evidence/<issue>/`, and a Verdict's `findings.md`.

use std::fs::File;
use std::io;

use crate::cli::{Context, Refusal};
use crate::config::{self, Config};
use crate::dispatch::{self, Dispatch};
use crate::http;
use crate::stage;
use crate::state;
use crate::world::{Answer, HttpResponse, World, WorldError};

const README: &str = "# nico-agent's Bucket\n\nEvidence, one commit per PR head, Verdict and Close: `<owner>/<repo>/<issue>/<sha>/`\nholds what the worktree's `.evidence/<issue>/` held while its PR was at `<sha>`,\nand a Verdict's `findings.md` from its Reviewer.\n";

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

/// Commit `d`'s Evidence and `findings` to the Bucket at `sha` with
/// `message`, even when nothing changed there: a Verdict is recorded so.
pub fn keep(
    ctx: &Context,
    config: &Config,
    d: &Dispatch,
    sha: &str,
    findings: Option<&str>,
    message: &str,
) -> Result<(), Refusal> {
    let (world, _lock) = (ctx.world, lock(ctx)?);
    let kept = copied(world, config, d, sha)?;
    let bucket = &config.bucket.path;
    if let Some(text) = findings {
        let file = format!("{bucket}/{kept}/findings.md");
        world.write_file(&file, text.as_bytes()).map_err(refused)?;
    }
    world.git_commit(bucket, &kept, message).map_err(refused)
}

/// Keep the Evidence of each live Dispatch at its open PR's head, once a
/// head, so the PR's link to the Bucket opens before any Verdict: `pr <issue>
/// <sha>`. A failed keep is said and tried again next tick. Says what it kept.
pub fn step(ctx: &Context, config: &Config) -> io::Result<Vec<String>> {
    let mut said = vec![];
    let prs = stage::load(&ctx.config_dir)?;
    let live = dispatch::load(&ctx.config_dir)?.into_iter();
    for d in live.filter(|d| d.closed_at.is_none()) {
        let Some((_, pr)) = stage::pr_of(&prs, &d).filter(|(_, pr)| !pr.r#final) else {
            continue;
        };
        let sha = &pr.head_sha;
        if d.kept.as_ref() == Some(sha) {
            continue;
        }
        let message = format!("pr {} {sha}", d.issue);
        match keep_evidence(ctx, config, &d, sha, &message) {
            Ok(line) => {
                said.extend(line);
                dispatch::update(&ctx.config_dir, |all| {
                    if let Some(live) = all.iter_mut().find(|l| dispatch::is_live(l, &d.issue)) {
                        live.kept = Some(sha.clone());
                    }
                })?;
            }
            Err(line) => said.push(line),
        }
    }
    Ok(said)
}

/// Commit `d`'s Evidence to the Bucket at `sha` with `message` when it is
/// not what the Bucket's last commit there holds: nothing when its worktree
/// has none. What to say of it, or why it could not be kept.
pub fn keep_evidence(
    ctx: &Context,
    config: &Config,
    d: &Dispatch,
    sha: &str,
    message: &str,
) -> Result<Option<String>, String> {
    let (world, bucket) = (ctx.world, &config.bucket.path);
    let committed = lock(ctx).and_then(|_lock| {
        let kept = copied(world, config, d, sha)?;
        let changed = world.git_changed(bucket, &kept).map_err(refused)?;
        if changed {
            world.git_commit(bucket, &kept, message).map_err(refused)?;
        }
        Ok(changed)
    });
    match committed {
        Ok(true) => Ok(Some(format!(
            "{}: Evidence at {sha} kept in the Bucket",
            d.issue
        ))),
        Ok(false) => Ok(None),
        Err(no) => Err(format!(
            "could not keep the Evidence of {} at {sha}: {}",
            d.issue, no.error
        )),
    }
}

/// Copy `d`'s Evidence into the Bucket at `sha`, the Bucket made first if it
/// is missing: the folder it is in there, `<repo>/<issue>/<sha>`.
fn copied(world: &dyn World, config: &Config, d: &Dispatch, sha: &str) -> Result<String, Refusal> {
    made(world, config)?;
    let kept = format!("{}/{sha}", folder(d));
    if let Some(worktree) = &d.worktree {
        let from = format!("{worktree}/{}", evidence(d));
        let to = format!("{}/{kept}", config.bucket.path);
        world.copy_dir(&from, &to).map_err(refused)?;
    }
    Ok(kept)
}

/// `GET /bucket/<path>`: the file at `path`, its escapes decoded, in the Bucket's
/// working tree, or for a folder (`path` ending in `/`) a page of links to
/// every file under it; never one outside it, nor its git store.
pub fn file(ctx: &Context, path: &str) -> Answer {
    if path.split('/').any(|part| part == ".." || part == ".git") {
        let error = format!("{path} is not in the Bucket's working tree");
        let help = ["Ask for a file under /bucket/<owner>/<repo>/<issue>/<sha>/"];
        return http::error(403, &error, &help);
    }
    if path.is_empty() || path.ends_with('/') {
        return listing(ctx, path);
    }
    let read = config::load(&ctx.config_dir).and_then(|config| {
        let file = format!("{}/{path}", config.bucket.path);
        Ok(ctx.world.read_file(&file)?)
    });
    match read {
        Ok(Some(body)) => sandboxed(media_type(path), body),
        Ok(None) => {
            let error = format!("no file {path} in the Bucket");
            let help = ["Each PR head's Evidence is under /bucket/<owner>/<repo>/<issue>/<sha>/"];
            http::error(404, &error, &help)
        }
        Err(no) => http::error(500, &no.error, &no.help),
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
                .map(|f| format!("<li><a href=\"{}\">{}</a>\n", http::escaped(f), html(f)))
                .collect();
            let title = html(&format!("/bucket/{folder}"));
            let page = format!("<!doctype html>\n<title>{title}</title>\n<ul>\n{links}</ul>\n");
            sandboxed("text/html; charset=utf-8", page.into())
        }
        Ok(_) => {
            let error = format!("no folder {folder} in the Bucket");
            let help = ["Each PR head's Evidence is under /bucket/<owner>/<repo>/<issue>/<sha>/"];
            http::error(404, &error, &help)
        }
        Err(no) => http::error(500, &no.error, &no.help),
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
    world
        .list_files(path.trim_end_matches('/'))
        .map_err(refused)
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
    let local = format!("http://127.0.0.1:{}", config.port);
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
