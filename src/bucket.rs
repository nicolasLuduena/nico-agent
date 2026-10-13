//! The Bucket: a git repo outside the config directory where Evidence
//! outlives its worktree. It is committed at `<repo>/<issue>/<sha>/`, e.g.
//! `acme/api/7/<sha>/` for `acme/api#7` or `acme/api/BLE-12/<sha>/` for a
//! Linear issue, as each PR head is seen, on its Verdict and at Close: the
//! files of the worktree's `.evidence/<issue>/`, and a Verdict's `findings.md`.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io;

use crate::cli::{Context, Refusal};
use crate::config::{self, Config};
use crate::dispatch::{self, Dispatch};
use crate::http;
use crate::stage;
use crate::state;
use crate::world::{Answer, HttpResponse, World, WorldError, WorldResult};

const README: &str = "# nico-agent's Bucket\n\nEvidence, one commit per PR head, Verdict and Close: `<owner>/<repo>/<issue>/<sha>/`\nholds what the worktree's `.evidence/<issue>/` held while its PR was at `<sha>`,\nand a Verdict's `findings.md` from its Reviewer.\n\nEach Repo's Wiki, one commit per build: `wiki/<owner>/<repo>/wiki.json`.\n";

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

/// Commit `text` as the Wiki of the Repo `slug`, at `wiki/<slug>/wiki.json`,
/// with `message`, the Bucket made first if it is missing.
pub fn keep_wiki(
    ctx: &Context,
    config: &Config,
    slug: &str,
    text: &str,
    message: &str,
) -> Result<(), Refusal> {
    let (world, _lock) = (ctx.world, lock(ctx)?);
    made(world, config)?;
    let (bucket, kept) = (&config.bucket.path, wiki_file(slug));
    (world.write_file(&format!("{bucket}/{kept}"), text.as_bytes()))
        .and_then(|()| world.git_commit(bucket, &kept, message))
        .map_err(refused)
}

/// The text of the Wiki of the Repo `slug` the Bucket holds; none before its first build.
pub fn wiki(world: &dyn World, config: &Config, slug: &str) -> WorldResult<Option<Vec<u8>>> {
    world.read_file(&format!("{}/{}", config.bucket.path, wiki_file(slug)))
}

/// Where the Wiki of the Repo `slug` is in the Bucket.
fn wiki_file(slug: &str) -> String {
    format!("wiki/{slug}/wiki.json")
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
/// working tree, or for a folder (`path` ending in `/`) a page of what is
/// under it; never one outside it, nor its git store.
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

/// The Bucket's `folder` as a page: above an issue's folder, a link to each
/// issue's under it; at or under one, its Evidence, each file shown or linked.
fn listing(ctx: &Context, folder: &str) -> Answer {
    let page = config::load(&ctx.config_dir).and_then(|config| {
        let files = files(ctx.world, &config, folder.trim_end_matches('/'))?;
        if files.is_empty() {
            return Ok(None);
        }
        // An issue's folder, `<owner>/<repo>/<issue>/`, is three down from the Bucket.
        let depth = folder.split('/').filter(|part| !part.is_empty()).count();
        let body = if depth < 3 {
            issues(&files, 3 - depth)
        } else {
            let read =
                |f: &str| (ctx.world).read_file(&format!("{}/{folder}{f}", config.bucket.path));
            by_step(&files, read)?
        };
        Ok(Some(page(folder, &body)))
    });
    match page {
        Ok(Some(page)) => sandboxed("text/html; charset=utf-8", page.into()),
        Ok(None) => {
            let error = format!("no folder {folder} in the Bucket");
            let help = ["Each PR head's Evidence is under /bucket/<owner>/<repo>/<issue>/<sha>/"];
            http::error(404, &error, &help)
        }
        Err(no) => http::error(500, &no.error, &no.help),
    }
}

/// Text past this many bytes is linked, not shown.
const SHOWN: usize = 256 * 1024;
/// Text of up to this many lines is shown open; longer, folded.
const OPEN_LINES: usize = 30;

/// The page of the Bucket's `folder` around `body`, its path linked part by part.
fn page(folder: &str, body: &str) -> String {
    let (mut trail, mut at) = ("<a href=\"/bucket/\">Bucket</a>".to_string(), String::new());
    for part in folder.split('/').filter(|part| !part.is_empty()) {
        at = format!("{at}{part}/");
        trail += &format!(
            " / <a href=\"/bucket/{}\">{}</a>",
            http::escaped(&at),
            html(part)
        );
    }
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>Evidence · {}</title>\n<style>{STYLE}</style>\n\
         <main>\n<p class=\"label\">Evidence</p>\n<h1>{trail}</h1>\n{body}</main>\n",
        html(&format!("/bucket/{folder}"))
    )
}

/// A link to each issue's folder among `files`, `below` parts under the
/// page's folder, and how many heads it holds.
fn issues(files: &[String], below: usize) -> String {
    let mut heads: BTreeMap<String, BTreeSet<&str>> = BTreeMap::new();
    for f in files {
        let parts: Vec<&str> = f.split('/').collect();
        if let Some(head) = parts.get(below) {
            heads
                .entry(parts[..below].join("/"))
                .or_default()
                .insert(head);
        }
    }
    let rows: String = (heads.iter())
        .map(|(issue, heads)| {
            let (href, heads) = (http::escaped(issue), count(heads.len(), "head"));
            format!(
                "<li><a href=\"{href}/\">{}</a> <span>{heads}</span>\n",
                html(issue)
            )
        })
        .collect();
    format!("<ul class=\"issues\">\n{rows}</ul>\n")
}

/// `files`, read by `read`, by folder then by step: a step is the files
/// sharing a name up to its first dot, as `01-list.cmd`, `.exit`, `.stdout`
/// and `.png` are written by a verification skill.
fn by_step(
    files: &[String],
    read: impl Fn(&str) -> WorldResult<Option<Vec<u8>>>,
) -> WorldResult<String> {
    let mut steps: BTreeMap<(&str, &str), Vec<(&str, &str)>> = BTreeMap::new();
    for f in files {
        let (dir, name) = f.rsplit_once('/').unwrap_or(("", f));
        let (step, kind) = name.split_once('.').unwrap_or((name, ""));
        steps.entry((dir, step)).or_default().push((kind, f));
    }
    let (mut out, mut last) = (String::new(), None);
    for ((dir, name), parts) in &steps {
        let (top, rest) = dir.split_once('/').unwrap_or((dir, ""));
        let (last_top, last_dir) = last.unwrap_or(("", "\0"));
        if top != last_top {
            out += &format!("<h2>{}</h2>\n", head(top));
        }
        if *dir != last_dir && !rest.is_empty() {
            out += &format!("<h3>{}</h3>\n", html(rest));
        }
        last = Some((top, *dir));
        out += &step_html(&read, name, parts)?;
    }
    Ok(out)
}

/// A folder under an issue's: `Head <sha>` for a PR head's, else its name.
fn head(folder: &str) -> String {
    match folder.len() == 40 && folder.bytes().all(|b| b.is_ascii_hexdigit()) {
        true => format!("Head <code>{}</code>", &folder[..7]),
        false => html(folder),
    }
}

/// One step: its number, name, command and exit code, then each other file:
/// text shown (JSON indented), images and video embedded, anything else linked.
fn step_html(
    read: &impl Fn(&str) -> WorldResult<Option<Vec<u8>>>,
    name: &str,
    parts: &[(&str, &str)],
) -> WorldResult<String> {
    let (number, name) = match name.split_once('-') {
        Some((n, rest)) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => (n, rest),
        _ => ("", name),
    };
    let (mut cmd, mut exit, mut shown) = (String::new(), String::new(), String::new());
    for &(kind, path) in parts {
        let (href, label) = (
            http::escaped(path),
            html(if kind.is_empty() { name } else { kind }),
        );
        let media = media_type(path);
        if media.starts_with("image/") {
            let alt = html(path);
            shown += &format!(
                "<figure><a href=\"{href}\"><img src=\"{href}\" alt=\"{alt}\" loading=\"lazy\"></a>\
                 <figcaption>{label}</figcaption></figure>\n"
            );
            continue;
        }
        if media.starts_with("video/") {
            shown += &format!(
                "<figure><video src=\"{href}\" controls></video><figcaption>{label}</figcaption></figure>\n"
            );
            continue;
        }
        let text = (read(path)?)
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|text| text.len() <= SHOWN && !text.contains('\0'));
        let Some(text) = text else {
            shown += &format!("<p class=\"part\"><a href=\"{href}\">{label}</a></p>\n");
            continue;
        };
        match kind {
            "cmd" => cmd = format!("<code class=\"cmd\">{}</code>", html(text.trim())),
            "exit" => exit = format!("<span class=\"exit\">exit {}</span>", html(text.trim())),
            _ if text.trim().is_empty() => {
                shown +=
                    &format!("<p class=\"part empty\"><a href=\"{href}\">{label}</a> empty</p>\n");
            }
            _ => {
                let text = indented(&text).unwrap_or(text);
                let lines = text.trim_end().lines().count();
                let open = if lines <= OPEN_LINES || kind == "md" {
                    " open"
                } else {
                    ""
                };
                shown += &format!(
                    "<details{open}><summary><a href=\"{href}\">{label}</a> {}</summary><pre>{}</pre></details>\n",
                    count(lines, "line"),
                    html(text.trim_end())
                );
            }
        }
    }
    Ok(format!(
        "<article class=\"step\">\n<header><span class=\"n\">{}</span><span class=\"name\">{}</span>\
         {exit}{cmd}</header>\n<div class=\"parts\">\n{shown}</div>\n</article>\n",
        html(number),
        html(name)
    ))
}

/// `text` indented when it is a JSON object or array, its keys kept in their order.
fn indented(text: &str) -> Option<String> {
    let text = text.trim();
    let json =
        text.starts_with(['{', '[']) && serde_json::from_str::<serde_json::Value>(text).is_ok();
    if !json {
        return None;
    }
    let (mut out, mut depth, mut quoted, mut escaped) = (String::new(), 0, false, false);
    let newline = |out: &mut String, depth: usize| *out += &format!("\n{}", "  ".repeat(depth));
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            out.push(c);
            (quoted, escaped) = (escaped || c != '"', !escaped && c == '\\');
            continue;
        }
        match c {
            '"' => {
                quoted = true;
                out.push(c);
            }
            '{' | '[' if matches!(chars.peek(), Some('}' | ']')) => {
                out.push(c);
                out.extend(chars.next());
            }
            '{' | '[' => {
                depth += 1;
                out.push(c);
                newline(&mut out, depth);
            }
            '}' | ']' => {
                depth -= 1;
                newline(&mut out, depth);
                out.push(c);
            }
            ',' => {
                out.push(c);
                newline(&mut out, depth);
            }
            ':' => out += ": ",
            c if c.is_whitespace() => {}
            c => out.push(c),
        }
    }
    Some(out)
}

/// `n` of `what`, plural but for one.
fn count(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// `text` safe in HTML, in an element or a quoted attribute.
fn html(text: &str) -> String {
    (text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;"))
    .replace('"', "&quot;")
}

/// The Bucket's pages in DESIGN.md's timetable: inline, as the sandbox loads nothing else.
const STYLE: &str = "
:root{--ground:#f4f5f2;--surface:#fff;--ink:#111214;--muted:#50545b;--hairline:#cfd2d6;--live:#1d4f91;--reversed:#111214;--reversed-ink:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ground:#0b1220;--surface:#121a2b;--ink:#eef1f4;--muted:#a9b1bd;--hairline:#2a3447;--live:#7fb0ff;--reversed:#eef1f4;--reversed-ink:#0b1220}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.45 Barlow,system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
a{color:var(--live)}
code,pre,.exit{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.label,h2,h3{font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.label{margin:0;color:var(--muted)}
h1{margin:4px 0 24px;font-size:22px;font-weight:600;line-height:1.2;overflow-wrap:anywhere}
h1 a{color:inherit;text-decoration:none}
h1 a:hover{text-decoration:underline}
h2{margin:32px 0 0;padding:8px 12px;background:var(--reversed);color:var(--reversed-ink)}
h2 code{font-size:14px;text-transform:none}
h3{margin:24px 0 0;padding-bottom:4px;border-bottom:2px solid var(--ink)}
.step{padding:12px;background:var(--surface);border-bottom:1px solid var(--hairline)}
.step>header{display:grid;grid-template-columns:40px 1fr auto;gap:2px 12px;align-items:baseline}
.n{font-size:22px;font-weight:700;line-height:1.1;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.name{font-weight:600;overflow-wrap:anywhere}
.cmd{grid-column:2/-1;color:var(--muted);overflow-wrap:anywhere}
.exit{padding:2px 6px;border:1px solid var(--hairline);border-radius:2px;white-space:nowrap}
.parts{margin-left:52px}
.parts>*{margin:8px 0 0}
summary{cursor:pointer;color:var(--muted)}
pre{margin:4px 0 0;padding:8px 12px;max-height:60vh;overflow:auto;background:var(--ground);white-space:pre-wrap;overflow-wrap:anywhere}
.empty{color:var(--muted)}
figure img,figure video{display:block;max-width:100%;border:1px solid var(--hairline)}
figcaption{color:var(--muted)}
.issues{margin:0;padding:0;list-style:none;background:var(--surface)}
.issues li{padding:8px 12px;border-bottom:1px solid var(--hairline)}
.issues span{color:var(--muted)}
@media (max-width:600px){.parts{margin-left:0}}
";

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
