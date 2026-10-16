mod common;

use std::time::Duration;

use common::{Ran, Setup, github_issue, pull_request, setup};
use nico_agent::world::{Answer, Mergeable, PrState, PullRequest, PullRequestActivity};
use serde_json::{Value, json};

const BUCKET: &str = "/mnt/agents-land/nico-agent-bucket";

/// Repo `acme/api` added, its issue 7 dispatched into `/worktrees/api-7`,
/// its PR 9 at `sha9` found, and no calls recorded yet.
fn with_pr() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.tick();
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.world.advance(Duration::from_secs(600));
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

/// Repo `acme/api` with its `review` switch off, its issue 7 dispatched into
/// `/worktrees/api-7` and its PR 9 opened on its branch, for the next tick to
/// find; no calls recorded yet.
fn opened() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { review = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.tick();
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.world.advance(Duration::from_secs(600));
    t.world.calls.borrow_mut().clear();
    t
}

/// The Implementer pushes: PR 9's head is now `sha`, and `state`.
fn push(t: &Setup, sha: &str, state: PrState) {
    t.world.activity.borrow_mut().insert(
        "acme/api#9".into(),
        PullRequestActivity {
            state,
            draft: true,
            head_sha: sha.into(),
            base_branch: "main".into(),
            mergeable: Mergeable::Mergeable,
            updated_at: "2026-09-30T12:30:00Z".into(),
            merged_at: None,
        },
    );
    t.world.advance(Duration::from_secs(600));
}

/// The calls since the last ones taken that touch the Bucket or a worktree's Evidence.
fn bucket_calls(t: &Setup) -> Vec<String> {
    let calls = t.world.calls.borrow_mut().drain(..).collect::<Vec<_>>();
    (calls.into_iter())
        .filter(|c| c.contains(BUCKET) || c.contains(".evidence"))
        .collect()
}

/// The Bucket's commit of what `add` holds, with `message`.
fn commit(add: &str, message: &str) -> String {
    format!(
        "git -C {BUCKET} add -- {add} && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m {message}"
    )
}

/// The Bucket made, as the first keep finds it missing.
fn made() -> Vec<String> {
    vec![
        format!("git remotes {BUCKET}"),
        format!("git init {BUCKET}"),
        format!("write {BUCKET}/README.md"),
        commit("README.md", "nico-agent's Bucket"),
    ]
}

/// Copying issue 7's Evidence to `<sha>/` and asking git whether it changed there.
fn copied(sha: &str) -> Vec<String> {
    vec![
        format!("cp -r /worktrees/api-7/.evidence/7/. {BUCKET}/acme/api/7/{sha}"),
        format!("git -C {BUCKET} status --porcelain -- acme/api/7/{sha}"),
    ]
}

#[test]
fn a_pr_found_keeps_its_evidence_in_the_bucket_with_no_verdict_and_its_same_head_again_nothing() {
    let t = opened();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");

    let said = t.tick();
    let found = bucket_calls(&t);
    let again = (t.tick(), bucket_calls(&t));
    let (status, _, body) = get(&t, "/bucket/acme/api/7/");

    assert_eq!(
        said,
        [
            "acme/api#7: PR https://github.com/acme/api/pull/9 found",
            "acme/api#7: Evidence at sha9 kept in the Bucket",
        ]
    );
    assert_eq!(
        found,
        [
            made(),
            copied("sha9"),
            vec![commit("acme/api/7/sha9", "pr acme/api#7 sha9")]
        ]
        .concat()
    );
    // The same head again: nothing looked at, nothing kept.
    assert_eq!(again, (vec![], vec![]));
    assert_eq!(kept(&t), pairs(&[("7/sha9/shot.png", "png")]));
    assert_eq!(status, 200);
    assert!(
        String::from_utf8(body)
            .unwrap()
            .contains("<a href=\"sha9/shot.png\">"),
    );
}

#[test]
fn a_new_head_adds_a_sha_folder_and_a_head_with_no_evidence_keeps_and_says_nothing() {
    let t = opened();

    let found = (t.tick(), bucket_calls(&t));
    // The Implementer saves Evidence after opening the PR, then pushes.
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    push(&t, "sha10", PrState::Open);
    let pushed = (t.tick(), bucket_calls(&t));

    assert_eq!(
        found,
        (
            vec!["acme/api#7: PR https://github.com/acme/api/pull/9 found".to_string()],
            [made(), copied("sha9")].concat(),
        )
    );
    assert_eq!(
        pushed,
        (
            vec!["acme/api#7: Evidence at sha10 kept in the Bucket".to_string()],
            [
                vec![format!("git remotes {BUCKET}")],
                copied("sha10"),
                vec![commit("acme/api/7/sha10", "pr acme/api#7 sha10")],
            ]
            .concat(),
        )
    );
    assert_eq!(kept(&t), pairs(&[("7/sha10/shot.png", "png")]));
}

#[test]
fn a_failed_keep_is_said_and_tried_again_next_tick() {
    let t = opened();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    t.world.fail_call("cp -r", "No space left on device");

    let failed = t.tick();
    t.world.clear_failures();
    t.world.advance(Duration::from_secs(600));
    let retried = t.tick();

    assert_eq!(
        failed,
        [
            "acme/api#7: PR https://github.com/acme/api/pull/9 found",
            "could not keep the Evidence of acme/api#7 at sha9: No space left on device",
        ]
    );
    assert_eq!(retried, ["acme/api#7: Evidence at sha9 kept in the Bucket"]);
    assert_eq!(kept(&t), pairs(&[("7/sha9/shot.png", "png")]));
}

#[test]
fn a_head_whose_verdict_kept_its_evidence_before_the_tick_did_commits_nothing_more() {
    let t = opened();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    t.world.fail_call(
        &format!("git -C {BUCKET} status"),
        "fatal: unable to read the index",
    );
    let failed = t.tick();
    t.world.clear_failures();
    verdict(&t, &["pass", "--sha", "sha9"]);
    t.world.calls.borrow_mut().clear();
    t.world.advance(Duration::from_secs(600));

    let after = (t.tick(), bucket_calls(&t));

    assert_eq!(
        failed[1],
        "could not keep the Evidence of acme/api#7 at sha9: fatal: unable to read the index"
    );
    assert_eq!(
        after,
        (
            vec!["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready".to_string()],
            [vec![format!("git remotes {BUCKET}")], copied("sha9")].concat(),
        )
    );
}

#[test]
fn close_keeps_evidence_changed_since_its_head_was_kept_before_removing_the_worktree_and_leaves_it_when_the_keep_fails()
 {
    let t = opened();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    t.tick();
    // Updated after the PR was found, on the same head, which then merges.
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png, again");
    push(&t, "sha9", PrState::Merged);
    t.world.calls.borrow_mut().clear();
    // Copied, then not committed.
    let close = commit("acme/api/7/sha9", "close acme/api#7 sha9");
    t.world
        .fail_call(&close, "Unable to create index.lock: File exists");

    let failed = t.tick();
    let failed_calls: Vec<String> = t.world.calls.borrow_mut().drain(..).collect();
    t.world.clear_failures();
    t.world.advance(Duration::from_secs(600));
    let closed = t.tick();
    let closed_calls = t.world.calls();

    assert_eq!(
        failed,
        [
            "could not keep the Evidence of acme/api#7 at sha9: Unable to create index.lock: File exists"
        ]
    );
    let removed = |calls: &[String]| (calls.iter()).any(|c| c.starts_with("herdr worktree remove"));
    assert!(!removed(&failed_calls), "{failed_calls:?}");
    assert_eq!(
        closed,
        [
            "acme/api#7: Evidence at sha9 kept in the Bucket",
            "acme/api#7 Closed: its PR https://github.com/acme/api/pull/9 merged",
        ]
    );
    let kept_then_removed: Vec<String> = (closed_calls.into_iter())
        .filter(|c| c.contains(BUCKET) || c.starts_with("herdr worktree"))
        .collect();
    assert_eq!(
        kept_then_removed,
        [
            vec![format!("git remotes {BUCKET}")],
            copied("sha9"),
            vec![close, "herdr worktree remove --workspace w1 --force".into()],
        ]
        .concat()
    );
    assert_eq!(kept(&t), pairs(&[("7/sha9/shot.png", "png, again")]));
}

#[test]
fn close_with_the_evidence_the_bucket_holds_commits_nothing() {
    let t = opened();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    t.tick();
    push(&t, "sha9", PrState::Merged);
    t.world.calls.borrow_mut().clear();

    let said = t.tick();

    assert_eq!(
        said,
        ["acme/api#7 Closed: its PR https://github.com/acme/api/pull/9 merged"]
    );
    assert_eq!(
        bucket_calls(&t),
        [vec![format!("git remotes {BUCKET}")], copied("sha9")].concat()
    );
}

/// A findings file the Reviewer wrote, outside the config directory.
fn findings(t: &Setup, text: &str) -> String {
    let file = t.config_dir.with_file_name("f.md");
    std::fs::write(&file, text).unwrap();
    file.display().to_string()
}

fn verdict(t: &Setup, args: &[&str]) -> Ran {
    let ran = t.cli(&[&["verdict", "acme/api#7"], args, &["--json"]].concat());
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran
}

/// What the Bucket holds for acme/api, by path under `acme/api/`, as text.
fn kept(t: &Setup) -> Vec<(String, String)> {
    let under = format!("{BUCKET}/acme/api/");
    (t.world.files.borrow().iter())
        .filter_map(|(path, bytes)| {
            let path = path.strip_prefix(&under)?.to_string();
            Some((path, String::from_utf8_lossy(bytes).into_owned()))
        })
        .collect()
}

fn pairs(expected: &[(&str, &str)]) -> Vec<(String, String)> {
    (expected.iter())
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect()
}

#[test]
fn a_verdict_commits_the_evidence_and_findings_to_the_bucket_under_repo_issue_and_sha_once() {
    let t = with_pr();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    t.world
        .add_file("/worktrees/api-7/.evidence/7/run/log.txt", b"ok");
    t.world
        .add_file("/worktrees/api-7/.evidence/8/other.txt", b"not 7's");
    let file = findings(&t, "Signing in works.\n");

    verdict(&t, &["pass", "--sha", "sha9", "--findings", &file]);
    let calls = t.world.calls();
    t.world.calls.borrow_mut().clear();
    verdict(&t, &["pass", "--sha", "sha9", "--findings", &file]);

    assert_eq!(
        kept(&t),
        pairs(&[
            ("7/sha9/findings.md", "Signing in works.\n"),
            ("7/sha9/run/log.txt", "ok"),
            ("7/sha9/shot.png", "png"),
        ])
    );
    assert_eq!(
        calls,
        [
            "git -C /worktrees/rev-api-7 rev-parse HEAD".to_string(),
            "git -C /worktrees/rev-api-7 status --porcelain --untracked-files=no".into(),
            format!("git remotes {BUCKET}"),
            format!("cp -r /worktrees/api-7/.evidence/7/. {BUCKET}/acme/api/7/sha9"),
            format!("write {BUCKET}/acme/api/7/sha9/findings.md"),
            format!(
                "git -C {BUCKET} add -- acme/api/7/sha9 && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m verdict acme/api#7 pass sha9"
            ),
        ]
    );
    // The same Verdict again is no new one: its Reviewer's worktree is checked, nothing is kept twice.
    assert_eq!(t.world.calls(), calls[..2]);
}

#[test]
fn a_verdict_with_no_evidence_still_commits_its_findings_and_one_on_another_sha_is_another_folder()
{
    let t = with_pr();
    let file = findings(&t, "The search box is gone.\n");
    verdict(&t, &["fail", "--sha", "sha9", "--findings", &file]);
    // The Implementer pushes a fix, with Evidence this time.
    t.world.activity.borrow_mut().insert(
        "acme/api#9".into(),
        PullRequestActivity {
            state: PrState::Open,
            draft: true,
            head_sha: "sha10".into(),
            base_branch: "main".into(),
            mergeable: Mergeable::Mergeable,
            updated_at: "2026-09-30T12:30:00Z".into(),
            merged_at: None,
        },
    );
    t.world
        .add_file("/worktrees/api-7/.evidence/7/shot.png", b"png");
    t.world.advance(Duration::from_secs(600));
    t.tick();
    t.world.calls.borrow_mut().clear();

    verdict(&t, &["pass", "--sha", "sha10"]);

    assert_eq!(
        kept(&t),
        pairs(&[
            ("7/sha10/shot.png", "png"),
            ("7/sha9/findings.md", "The search box is gone.\n"),
        ])
    );
    assert_eq!(
        t.world.calls().last().unwrap(),
        &format!(
            "git -C {BUCKET} add -- acme/api/7/sha10 && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m verdict acme/api#7 pass sha10"
        )
    );
}

/// `GET path` of serve: its status, headers and body.
fn get(t: &Setup, path: &str) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let Answer::Whole(response) = t.request("GET", path, "") else {
        panic!("GET {path} answered with a stream");
    };
    (response.status, response.headers, response.body)
}

#[test]
fn get_bucket_serves_a_file_of_the_bucket_s_working_tree_and_refuses_any_path_outside_it() {
    let t = setup();
    t.tick();
    let png = [0x89, b'P', b'N', b'G', 0xff];
    t.world
        .add_file(&format!("{BUCKET}/acme/api/7/abc/sign in.png"), &png);
    t.world
        .add_file("/mnt/agents-land/secret.txt", b"not the Bucket's");
    t.world
        .add_file(&format!("{BUCKET}/.git/config"), b"[core]");
    t.world.calls.borrow_mut().clear();

    let (status, headers, body) = get(&t, "/bucket/acme/api/7/abc/sign%20in.png");
    let outside: Vec<(u16, Value)> = [
        "/bucket/../secret.txt",
        "/bucket/acme/%2e%2e/%2E%2E/../secret.txt",
        "/bucket/.git/config",
    ]
    .iter()
    .map(|path| {
        let (status, _, body) = get(&t, path);
        (status, serde_json::from_slice(&body).unwrap())
    })
    .collect();
    let (missing, _, _) = get(&t, "/bucket/acme/api/7/abc/gone.png");

    assert_eq!((status, body), (200, png.to_vec()));
    assert_eq!(
        headers,
        [
            ("Content-Type".to_string(), "image/png".to_string()),
            // An HTML file kept as Evidence runs no script on the app's origin.
            ("Content-Security-Policy".into(), "sandbox".into()),
        ]
    );
    assert_eq!(
        outside[0],
        (
            403,
            json!({
                "error": "../secret.txt is not in the Bucket's working tree",
                "help": ["Ask for a file under /bucket/<owner>/<repo>/<issue>/<sha>/"],
            })
        )
    );
    assert_eq!(
        outside
            .iter()
            .map(|(status, _)| *status)
            .collect::<Vec<_>>(),
        [403, 403, 403]
    );
    assert_eq!(missing, 404);
    assert_eq!(
        t.world.calls(),
        [
            format!("read {BUCKET}/acme/api/7/abc/sign in.png"),
            format!("read {BUCKET}/acme/api/7/abc/gone.png"),
        ]
    );
}

#[test]
fn get_bucket_of_an_issue_s_folder_shows_its_evidence_by_head_folder_and_step_sandboxed() {
    let t = setup();
    t.tick();
    let sha = "abcdef0123456789abcdef0123456789abcdef01";
    let at = format!("{BUCKET}/acme/api/7/{sha}");
    t.world
        .add_file(&format!("{at}/findings.md"), b"# Findings\n- ok\n");
    let step = format!("{at}/status/01-list");
    t.world
        .add_file(&format!("{step}.cmd"), b"nico-agent status --json\n");
    t.world.add_file(&format!("{step}.exit"), b"2\n");
    t.world.add_file(&format!("{step}.stderr"), b"");
    t.world.add_file(
        &format!("{step}.stdout"),
        br#"{"z":[1,{"b":"x,y:"}],"a":{}}"#,
    );
    t.world
        .add_file(&format!("{at}/status/02-page.png"), b"png");
    t.world.add_file(&format!("{at}/status/<b>&.txt"), b"odd");
    t.world
        .add_file(&format!("{BUCKET}/acme/api/70/abc/shot.txt"), b"not 7's");
    t.world.calls.borrow_mut().clear();

    let (status, headers, body) = get(&t, "/bucket/acme/api/7/");

    assert_eq!(status, 200);
    assert_eq!(
        headers,
        [
            (
                "Content-Type".to_string(),
                "text/html; charset=utf-8".to_string()
            ),
            // Evidence is an agent's output: its page runs no script either.
            ("Content-Security-Policy".into(), "sandbox".into()),
        ]
    );
    let body = String::from_utf8(body).unwrap();
    for shown in [
        "<h1><a href=\"/bucket/\">Bucket</a> / <a href=\"/bucket/acme/\">acme</a> / \
         <a href=\"/bucket/acme/api/\">api</a> / <a href=\"/bucket/acme/api/7/\">7</a></h1>",
        "<h2>Head <code>abcdef0</code></h2>",
        // The Verdict's findings, shown open.
        &format!(
            "<details open><summary><a href=\"{sha}/findings.md\">md</a> 2 lines</summary>\
             <pre># Findings\n- ok</pre></details>"
        ),
        "<h3>status</h3>",
        "<header><span class=\"n\">01</span><span class=\"name\">list</span>\
         <span class=\"exit\">exit 2</span><code class=\"cmd\">nico-agent status --json</code></header>",
        &format!(
            "<p class=\"part empty\"><a href=\"{sha}/status/01-list.stderr\">stderr</a> empty</p>"
        ),
        // JSON indented, its keys in their order.
        "<pre>{\n  &quot;z&quot;: [\n    1,\n    {\n      &quot;b&quot;: &quot;x,y:&quot;\n    }\n  ],\n  &quot;a&quot;: {}\n}</pre>",
        &format!("<img src=\"{sha}/status/02-page.png\""),
        &format!("<a href=\"{sha}/status/%3Cb%3E%26.txt\">txt</a>"),
        "<span class=\"name\">&lt;b&gt;&amp;</span>",
    ] {
        assert!(body.contains(shown), "{shown}\nnot in\n{body}");
    }
    assert!(!body.contains("not 7's"), "{body}");
    assert_eq!(
        t.world.calls(),
        [
            format!("find {BUCKET}/acme/api/7 -name .git -prune -o -type f -print"),
            format!("read {at}/findings.md"),
            format!("read {step}.cmd"),
            format!("read {step}.exit"),
            format!("read {step}.stderr"),
            format!("read {step}.stdout"),
            // An image is embedded, never read.
            format!("read {at}/status/<b>&.txt"),
        ]
    );
}

#[test]
fn get_bucket_above_an_issue_s_folder_links_each_issue_s_with_its_heads() {
    let t = setup();
    t.tick();
    t.world
        .add_file(&format!("{BUCKET}/acme/api/7/abc/a.txt"), b"a");
    t.world
        .add_file(&format!("{BUCKET}/acme/api/7/def/b.txt"), b"b");
    t.world
        .add_file(&format!("{BUCKET}/acme/api/70/abc/shot.png"), b"png");
    t.world
        .add_file(&format!("{BUCKET}/README.md"), b"# Bucket");
    t.world.add_file(&format!("{BUCKET}/.git/HEAD"), b"ref");
    t.world.calls.borrow_mut().clear();

    let (status, _, repo) = get(&t, "/bucket/acme/api/");
    let (_, _, root) = get(&t, "/bucket/");
    let (missing, _, _) = get(&t, "/bucket/acme/api/8/");
    let (git, _, _) = get(&t, "/bucket/.git/");

    assert_eq!((status, missing, git), (200, 404, 403));
    let repo = String::from_utf8(repo).unwrap();
    assert!(
        repo.contains(
            "<ul class=\"issues\">\n<li><a href=\"7/\">7</a> <span>2 heads</span>\n\
             <li><a href=\"70/\">70</a> <span>1 head</span>\n</ul>"
        ),
        "{repo}"
    );
    let root = String::from_utf8(root).unwrap();
    assert!(
        root.contains("<a href=\"acme/api/70/\">acme/api/70</a>")
            && !root.contains("README")
            && !root.contains(".git"),
        "{root}"
    );
    assert_eq!(
        t.world.calls(),
        [
            format!("find {BUCKET}/acme/api -name .git -prune -o -type f -print"),
            // The Bucket's git store is not walked.
            format!("find {BUCKET} -name .git -prune -o -type f -print"),
            format!("find {BUCKET}/acme/api/8 -name .git -prune -o -type f -print"),
        ]
    );
}

/// The implement prompt a tick sends for issue 7 of `acme/api`, with `toml` in
/// the config; and its Setup, kept till the test ends.
fn implement_prompt(toml: &str) -> (String, Setup) {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    std::fs::write(t.config_dir.join("config.toml"), toml).unwrap();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.tick();
    let calls = t.world.calls();
    let prompt = calls
        .iter()
        .find_map(|c| c.strip_prefix("herdr agent prompt impl-api-7 "));
    (prompt.expect("an implement prompt").to_string(), t)
}

#[test]
fn the_implement_prompt_names_the_evidence_folder_and_links_the_bucket_on_serve_or_bucket_url() {
    let (on_serve, _t) = implement_prompt("");
    let (on_tunnel, _t2) = implement_prompt("[bucket]\nurl = \"https://nico.example.com/\"\n");
    let (on_port, _t3) = implement_prompt("port = 4321\n");

    assert_eq!(
        on_serve,
        "/implement https://github.com/acme/api/issues/7 as draft PR against main, saving its Evidence under .evidence/7/ in the worktree and linking it to http://127.0.0.1:42069/bucket/acme/api/7/"
    );
    assert!(
        on_port.ends_with(" linking it to http://127.0.0.1:4321/bucket/acme/api/7/"),
        "{on_port}"
    );
    assert!(
        on_tunnel.ends_with(" linking it to https://nico.example.com/bucket/acme/api/7/"),
        "{on_tunnel}"
    );
}

#[test]
fn repo_add_makes_the_bucket_when_it_is_missing_and_leaves_one_that_is_there_untouched() {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.world
        .add_clone("/src/web", &["git@github.com:acme/web.git"]);
    let elsewhere = setup();
    std::fs::create_dir_all(&elsewhere.config_dir).unwrap();
    let config = "[bucket]\npath = \"/data/bucket\"\n";
    std::fs::write(elsewhere.config_dir.join("config.toml"), config).unwrap();
    elsewhere
        .world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    elsewhere.world.add_clone("/data/bucket", &[]);

    let first = t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    let made = t.world.calls();
    t.world.calls.borrow_mut().clear();
    t.cli(&["repo", "add", "acme/web", "--path", "/src/web"]);
    elsewhere.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);

    assert_eq!(first.exit_code, 0, "{}", first.stdout);
    assert_eq!(
        made,
        [
            "git remotes /src/api".to_string(),
            format!("git remotes {BUCKET}"),
            format!("git init {BUCKET}"),
            format!("write {BUCKET}/README.md"),
            format!(
                "git -C {BUCKET} add -- README.md && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m nico-agent's Bucket"
            ),
        ]
    );
    assert!(t.world.files.borrow()[&format!("{BUCKET}/README.md")].starts_with(b"# "));
    assert_eq!(
        t.world.calls(),
        [
            "git remotes /src/web".to_string(),
            format!("git remotes {BUCKET}")
        ]
    );
    assert_eq!(
        elsewhere.world.calls(),
        ["git remotes /src/api", "git remotes /data/bucket"]
    );
}
