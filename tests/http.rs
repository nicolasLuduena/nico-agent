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
        "switches": { "dispatch": true, "stack": true, "review": true, "restart": true, "flip": true },
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
        "GET /api/status: the status of every Repo and Dispatch",
        "GET /api/events: a stream of `changed`, sent when state or an Agent state changes",
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
        serde_json::from_str::<serde_json::Value>(&posted.body).unwrap()["error"],
        "no route POST /api/status"
    );
}

const CHANGED: &str = "event: changed\ndata: {}\n\n";

#[test]
fn events_sends_changed_after_a_state_file_is_written_and_nothing_till_the_next_change() {
    let t = with_repo();
    t.tick();
    let mut events = t.events();
    let before = events.next();
    t.world.advance(Duration::from_secs(600));
    // Reads the Source again, into its cache.
    t.tick();

    let after = events.next();
    let again = events.next();

    assert_eq!([before, after, again], ["", CHANGED, ""]);
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

    assert_eq!([before, after, again], ["", CHANGED, ""]);
}

#[test]
fn events_sends_nothing_across_a_tick_that_changed_no_state_nor_a_dispatch_s_agent_state() {
    let t = dispatched();
    let mut events = t.events();
    t.world.calls.borrow_mut().clear();
    t.tick();
    // The user's own agent in herdr is not the page's.
    (t.world.agents.borrow_mut()).insert("my-shell".into(), "working".into());

    let quiet = events.next();

    assert_eq!(quiet, "");
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
