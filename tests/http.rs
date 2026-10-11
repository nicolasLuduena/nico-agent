mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{Answer, PullRequest};
use serde_json::json;

/// Repo `acme/api`, with no Dispatch and no calls recorded yet.
fn with_repo() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.calls.borrow_mut().clear();
    t
}

#[test]
fn serve_listens_on_127_0_0_1_42069_before_its_first_tick_and_ticks_on_schedule() {
    let t = with_repo();
    t.world.timer_runs.set(1);

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let calls = t.world.calls();
    assert_eq!(calls[0], "listen 127.0.0.1:42069");
    // The Source is read at 12:00 and 12:10.
    let reads = calls.iter().filter(|c| *c == "github issues acme/api");
    assert_eq!(reads.count(), 2);
    let (status, body) = t.get("/api/status");
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["repos"][0]["slug"], json!("acme/api"));
}

#[test]
fn serve_listens_on_the_port_config_toml_sets() {
    let t = with_repo();
    let config = std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap();
    std::fs::write(
        t.config_dir.join("config.toml"),
        format!("port = 4321\n{config}"),
    )
    .unwrap();

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(t.world.calls()[0], "listen 127.0.0.1:4321");
}

#[test]
fn status_is_the_status_command_s_plus_per_repo_its_times_switches_room_launches_and_harnesses() {
    let t = with_repo();
    t.tick();

    let (status, body) = t.get("/api/status");

    assert_eq!(status, 200, "{body}");
    let command = t.cli(&["status", "--json"]).json();
    assert_eq!(body["sources"], command["sources"]);
    assert_eq!(body["dispatches"], command["dispatches"]);
    let mut repo = command["repos"][0].clone();
    let page = json!({
        "prs_checked_at": null,
        "github_paused_until": null,
        "switches": {
            "dispatch": true, "stack": true, "review": true, "restart": true, "flip": true,
            "answer": false, "gardening": false, "quality_scan": false,
        },
        "room": 3,
        "implementer": { "harness": "claude", "model": null, "effort": null },
        "reviewer": { "harness": "codex", "model": null, "effort": null },
        "harnesses": {
            "claude": {
                "models": ["fable", "opus", "sonnet", "haiku"],
                "efforts": ["low", "medium", "high", "xhigh", "max"],
            },
            "codex": { "models": null, "efforts": null },
            "opencode": { "models": null, "efforts": null },
        },
    });
    for (key, value) in page.as_object().unwrap() {
        repo[key] = value.clone();
    }
    assert_eq!(repo["read_at"], "2026-09-30T12:00:00Z");
    assert_eq!(body["repos"], json!([repo]));
}

#[test]
fn status_asks_no_source_and_shows_its_cache_however_old() {
    let t = with_repo();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { dispatch = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    t.world.fail_call("github", "GitHub is down");
    t.tick();
    t.world.calls.borrow_mut().clear();
    let (_, never_read) = t.get("/api/status");
    let asked_never_read = t.world.calls();
    t.world.clear_failures();
    t.tick();
    t.world.advance(Duration::from_secs(3600));
    t.world.calls.borrow_mut().clear();

    let (_, old) = t.get("/api/status");

    assert_eq!(asked_never_read, Vec::<String>::new());
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(never_read["repos"][0]["read_at"], json!(null));
    assert_eq!(never_read["repos"][0]["ready"], json!([]));
    assert_eq!(old["repos"][0]["read_at"], "2026-09-30T12:00:00Z");
    assert_eq!(old["repos"][0]["ready"][0]["key"], "acme/api#1");
}

#[test]
fn status_shows_when_github_was_last_asked_about_a_repo_s_prs_and_till_when_it_is_paused() {
    let t = with_repo();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.cli(&["dispatch", "acme/api#7"]);
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.tick();
    t.world.advance(Duration::from_secs(600));
    let limited = "GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z";
    t.world.fail_call("github", limited);
    t.tick();

    let (_, body) = t.get("/api/status");

    let repo = &body["repos"][0];
    assert_eq!(repo["prs_checked_at"], "2026-09-30T12:00:00Z");
    assert_eq!(repo["github_paused_until"], "2026-09-30T13:00:00Z");
}

#[test]
fn an_unknown_path_or_method_answers_404_with_the_routes_as_help() {
    let t = with_repo();
    t.tick();

    let unknown = t.get("/api/frobnicate");
    let Answer::Whole(posted) = t.request("POST", "/api/status", "{}") else {
        panic!("POST /api/status answered with a stream");
    };

    let help = json!([
        "GET /: the app",
        "GET /api/status: the status of every Repo and Dispatch",
        "GET /api/map/<owner/name>: the Repo's issues and how they block and stack on each other",
        "GET /api/node/<issue>: the issue's Dispatch, its restarts, its Verdict's findings and its Evidence",
        "GET /api/events: a stream of `changed`, sent when state or an Agent state changes, and a keepalive comment otherwise",
        "POST /api/dispatch {issue, harness, model, effort}: `nico-agent dispatch` of the issue",
        "POST /api/refresh: `nico-agent refresh`",
        "PATCH /api/repo/<owner/name>/switches {name: bool}: set the Repo's switches",
        "GET /bucket/<path>: a file of the Bucket, where each Verdict's Evidence is kept, or links to a folder's",
    ]);
    assert_eq!(
        unknown,
        (
            404,
            json!({ "error": "no route GET /api/frobnicate", "help": help })
        )
    );
    assert_eq!(posted.status, 404);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&posted.body).unwrap()["error"],
        "no route POST /api/status"
    );
}

/// `GET path` of `serve`: its status, Content-Type and body.
fn fetch(t: &Setup, path: &str) -> (u16, String, Vec<u8>) {
    let Answer::Whole(response) = t.request("GET", path, "") else {
        panic!("GET {path} answered with a stream");
    };
    let header = response
        .headers
        .iter()
        .find(|(name, _)| name == "Content-Type");
    let kind = header.map(|(_, kind)| kind.clone()).unwrap_or_default();
    (response.status, kind, response.body)
}

/// The paths of the built files `text` loads, as Vite writes them: `/assets/<name>`.
fn assets(text: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(text);
    (text.split("/assets/").skip(1))
        .map(|rest| rest.split(['"', '\'', ')']).next().unwrap())
        .map(|name| format!("/assets/{name}"))
        .collect()
}

#[test]
fn the_app_is_served_at_slash_from_the_binary_with_every_file_it_loads() {
    let t = with_repo();
    t.tick();

    let (status, kind, page) = fetch(&t, "/");

    assert_eq!((status, kind.as_str()), (200, "text/html; charset=utf-8"));
    assert!(String::from_utf8_lossy(&page).contains("<div id=\"app\">"));
    let loaded = assets(&page);
    let kinds: Vec<(u16, String)> = (loaded.iter())
        .map(|path| fetch(&t, path))
        .map(|(status, kind, _)| (status, kind))
        .collect();
    assert!(
        kinds.contains(&(200, "text/javascript".into())),
        "{loaded:?}"
    );
    assert!(kinds.contains(&(200, "text/css".into())), "{loaded:?}");
    let css = loaded.iter().find(|path| path.ends_with(".css")).unwrap();
    let fonts: Vec<String> = (assets(&fetch(&t, css).2).into_iter())
        .filter(|path| path.ends_with(".woff2"))
        .collect();
    assert_eq!(fonts.len(), 3, "Barlow 400, 600 and 700");
    let (status, kind, font) = fetch(&t, &fonts[0]);
    assert_eq!(
        (status, kind.as_str(), &font[..4]),
        (200, "font/woff2", &b"wOF2"[..])
    );
    assert_eq!(fetch(&t, "/assets/nothing.js").0, 404);
}

const CHANGED: &str = "event: changed\ndata: {}\n\n";
const KEEPALIVE: &str = ": keepalive\n\n";

#[test]
fn events_sends_a_keepalive_comment_on_every_quiet_poll_so_a_proxy_never_sees_it_idle() {
    let t = dispatched();
    let mut events = t.events();

    // Cloudflare closes a response that sends nothing for 100 seconds.
    let sent: String = (0..10)
        .map(|_| {
            t.world.advance(Duration::from_secs(10));
            events.next()
        })
        .collect();

    assert_eq!(sent, KEEPALIVE.repeat(10));
}

#[test]
fn events_sends_changed_after_a_state_file_is_written_and_a_keepalive_till_the_next_change() {
    let t = with_repo();
    t.tick();
    let mut events = t.events();
    let before = events.next();
    t.world.advance(Duration::from_secs(600));
    // Reads the Source again, into its cache.
    t.tick();

    let after = events.next();
    let again = events.next();

    assert_eq!([before, after, again], [KEEPALIVE, CHANGED, KEEPALIVE]);
}

/// Repo `acme/api` with issue 7 dispatched, its Implementer working.
fn dispatched() -> Setup {
    let t = with_repo();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    assert_eq!(t.tick(), ["acme/api#7 dispatched"]);
    assert_eq!(t.world.agents.borrow()["impl-api-7"], "working");
    t
}

#[test]
fn events_sends_changed_after_a_live_dispatch_s_agent_state_changes() {
    let t = dispatched();
    let mut events = t.events();
    let before = events.next();
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "blocked".into());

    let after = events.next();
    let again = events.next();

    assert_eq!([before, after, again], [KEEPALIVE, CHANGED, KEEPALIVE]);
}

#[test]
fn events_sends_only_a_keepalive_across_a_tick_that_changed_no_state_nor_a_dispatch_s_agent_state()
{
    let t = dispatched();
    let mut events = t.events();
    t.world.calls.borrow_mut().clear();
    t.tick();
    // The user's own agent in herdr is not the page's.
    (t.world.agents.borrow_mut()).insert("my-shell".into(), "working".into());

    let quiet = events.next();

    assert_eq!(quiet, KEEPALIVE);
    assert!(
        t.world
            .calls()
            .contains(&"github branch prs acme/api:agent/api-7".into())
    );
}

#[test]
fn serve_that_cannot_listen_logs_it_and_the_loop_runs_on() {
    let t = with_repo();
    let taken = "could not listen on 127.0.0.1:42069: Address already in use (os error 98)";
    t.world.fail_call("listen", taken);

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(t.world.logged(), [format!("2026-09-30T12:00:00Z {taken}")]);
    assert!(
        t.world
            .calls()
            .contains(&"github issues acme/api".to_string())
    );
}

/// Repo `acme/api` with Ready issue 7, which the loop leaves alone, and
/// `serve` listening; no calls recorded yet.
fn ready_7() -> Setup {
    let t = with_repo();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { dispatch = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

fn dispatches(t: &Setup) -> String {
    std::fs::read_to_string(t.config_dir.join("dispatches.json")).unwrap_or_default()
}

#[test]
fn post_dispatch_dispatches_a_ready_issue_as_the_dispatch_command_does() {
    let (app, cli) = (ready_7(), ready_7());
    let body = r#"{"issue": "acme/api#7", "harness": "claude", "model": "opus", "effort": "high"}"#;

    let answered = app.send("POST", "/api/dispatch", body);
    let ran = cli.cli(&[
        "dispatch",
        "acme/api#7",
        "--harness",
        "claude",
        "--model",
        "opus",
        "--effort",
        "high",
        "--json",
    ]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(answered, (200, ran.json()));
    assert_eq!(answered.1["dispatched"], "acme/api#7");
    assert_eq!(app.world.calls(), cli.world.calls());
    let start =
        "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high";
    assert!(app.world.calls().contains(&start.into()));
    assert_eq!(dispatches(&app), dispatches(&cli));
    assert_ne!(dispatches(&app), "");
}

#[test]
fn post_dispatch_on_an_issue_not_ready_answers_409_with_the_command_s_refusal_and_records_nothing()
{
    let t = ready_7();
    let mut triage = github_issue("acme/api", 5);
    triage.labels = vec!["needs-triage".into()];
    t.world.add_issue("acme/api", triage);

    let answered = t.send("POST", "/api/dispatch", r#"{"issue": "acme/api#5"}"#);

    let why = "acme/api#5 was not an open issue labelled ready-for-agent when its Source was read, at 2026-09-30T12:00:00Z";
    assert_eq!(
        answered,
        (
            409,
            json!({
                "error": "acme/api#5 is not Ready",
                "help": [why, "Run `nico-agent status` to see the Ready issues"],
            })
        )
    );
    assert_eq!(dispatches(&t), "[]\n");
    assert!(t.world.calls().iter().all(|c| !c.starts_with("herdr ")));
    assert!(
        !t.world
            .calls()
            .iter()
            .any(|c| c.starts_with("github assign"))
    );
}

#[test]
fn post_dispatch_without_an_issue_or_with_a_body_not_json_answers_400() {
    let t = ready_7();

    let (no_issue, _) = t.send("POST", "/api/dispatch", r#"{"harness": "claude"}"#);
    let (not_json, body) = t.send("POST", "/api/dispatch", "issue=acme/api#7");

    assert_eq!((no_issue, not_json), (400, 400));
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .starts_with("the body is not JSON")
    );
    assert_eq!(dispatches(&t), "[]\n");
}

/// `dispatched`, with its PR 9 open and seen by a tick; no calls recorded yet.
fn with_pr() -> Setup {
    let t = dispatched();
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

#[test]
fn post_refresh_rereads_every_source_and_every_watched_pr_as_the_refresh_command_does() {
    let (app, cli) = (with_pr(), with_pr());

    let answered = app.send("POST", "/api/refresh", "");
    let ran = cli.cli(&["refresh", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(answered, (200, ran.json()));
    assert_eq!(app.world.calls(), cli.world.calls());
    assert_eq!(
        app.world.calls()[..3],
        [
            "github viewer",
            "github issues acme/api",
            "github pr activity acme/api#9"
        ]
    );
}

/// `serve` listening, on a config of two Repos as the user wrote it.
const WRITTEN: &str = r#"# Mine.
tick_minutes = 10

[repos."acme/api"]
path = "/src/api" # the clone
switches = { dispatch = true, review = true } # trust it

# Not yet.
[repos."acme/web"]
path = "/src/web"
room = 1
"#;

fn written() -> Setup {
    let t = with_repo();
    std::fs::write(t.config_dir.join("config.toml"), WRITTEN).unwrap();
    t.tick();
    t
}

fn config(t: &Setup) -> String {
    std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap()
}

#[test]
fn patch_switches_writes_only_the_named_switches_and_answers_the_repo_s_switches() {
    let t = written();

    let api = t.send(
        "PATCH",
        "/api/repo/acme/api/switches",
        r#"{"review": false}"#,
    );
    let web = t.send(
        "PATCH",
        "/api/repo/acme/web/switches",
        r#"{"stack": false, "gardening": true}"#,
    );

    let defaults = json!({
        "dispatch": true, "stack": true, "review": true, "restart": true, "flip": true,
        "answer": false, "gardening": false, "quality_scan": false,
    });
    let mut no_review = defaults.clone();
    no_review["review"] = json!(false);
    let mut no_stack_gardening = defaults;
    no_stack_gardening["stack"] = json!(false);
    no_stack_gardening["gardening"] = json!(true);
    assert_eq!(api, (200, json!({ "switches": no_review })));
    assert_eq!(web, (200, json!({ "switches": no_stack_gardening })));
    let expected = WRITTEN
        .replace("review = true }", "review = false }")
        .replace(
            "room = 1\n",
            "room = 1\nswitches = { gardening = true, stack = false }\n",
        );
    assert_eq!(config(&t), expected);
    assert_eq!(t.get("/api/status").1["repos"][0]["switches"], no_review);
}

#[test]
fn patch_switches_refuses_an_unknown_switch_slug_or_value_and_writes_nothing() {
    let t = written();
    let patch = |path: &str, body: &str| t.send("PATCH", path, body);
    let help = json!([
        "Switches: dispatch, stack, review, restart, flip, answer, gardening, quality_scan"
    ]);

    let unknown_switch = patch(
        "/api/repo/acme/api/switches",
        r#"{"review": false, "reveiw": false}"#,
    );
    let unknown_slug = patch("/api/repo/acme/www/switches", r#"{"review": false}"#);
    let not_bool = patch("/api/repo/acme/api/switches", r#"{"review": "no"}"#);

    assert_eq!(
        unknown_switch,
        (
            400,
            json!({ "error": "`reveiw` is not a switch", "help": help })
        )
    );
    assert_eq!(
        unknown_slug,
        (
            409,
            json!({
                "error": "acme/www is not a configured Repo",
                "help": ["Run `nico-agent repo add acme/www --path <clone>` first"],
            })
        )
    );
    assert_eq!(
        not_bool,
        (
            400,
            json!({ "error": "review is true or false, not \"no\"", "help": help })
        )
    );
    assert_eq!(config(&t), WRITTEN);
}
