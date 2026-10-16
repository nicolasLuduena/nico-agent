mod common;

use std::path::PathBuf;
use std::time::Duration;

use common::{HOST, Setup, github_issue, pull_request, setup};
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
    let at = |call: &str| calls.iter().position(|c| c == call).unwrap();
    assert!(at("listen 127.0.0.1:42069") < at("github issues acme/api"));
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
    assert!(t.world.calls().contains(&"listen 127.0.0.1:4321".into()));
}

#[test]
fn status_is_the_status_command_s_plus_per_repo_its_times_and_harnesses() {
    let t = with_repo();
    t.tick();

    let (status, body) = t.get("/api/status");

    assert_eq!(status, 200, "{body}");
    let command = t.cli(&["status", "--json"]).json();
    assert_eq!(body["projects"], command["projects"]);
    assert_eq!(body["sources"], command["sources"]);
    assert_eq!(body["dispatches"], command["dispatches"]);
    let mut repo = command["repos"][0].clone();
    let page = json!({
        "prs_checked_at": null,
        "github_paused_until": null,
        "harnesses": {
            "claude": {
                "models": ["fable", "opus", "sonnet", "haiku"],
                "efforts": ["low", "medium", "high", "xhigh", "max"],
            },
            "codex": { "models": null, "efforts": null, "suggested": { "models": [], "efforts": [] } },
            "opencode": { "models": null, "efforts": null, "suggested": { "models": [], "efforts": [] } },
        },
    });
    for (key, value) in page.as_object().unwrap() {
        repo[key] = value.clone();
    }
    assert_eq!(repo["read_at"], "2026-09-30T12:00:00Z");
    assert_eq!(body["repos"], json!([repo]));
}

#[test]
fn status_suggests_the_models_and_efforts_codex_and_opencode_name_in_their_own_files() {
    let t = with_repo();
    let codex = json!({ "models": [
        { "slug": "gpt-6-sol", "visibility": "list", "supported_reasoning_levels": [{ "effort": "low" }, { "effort": "high" }] },
        { "slug": "codex-auto-review", "visibility": "hide", "supported_reasoning_levels": [{ "effort": "max" }] },
        { "slug": "gpt-6-luna", "visibility": "list", "supported_reasoning_levels": [{ "effort": "low" }, { "effort": "xhigh" }] },
    ] });
    let opencode = json!({
        "recent": [{ "providerID": "opencode-go", "modelID": "glm-5.3" }],
        "favorite": [{ "providerID": "openrouter", "modelID": "z-ai/glm-5.3-flash" }],
        "variant": { "opencode-go/glm-5.3": "max", "opencode/hy3-free": "high" },
    });
    t.world
        .add_file("~/.codex/models_cache.json", codex.to_string().as_bytes());
    t.world.add_file(
        "~/.local/state/opencode/model.json",
        opencode.to_string().as_bytes(),
    );
    t.tick();

    let harnesses = t.get("/api/status").1["repos"][0]["harnesses"].clone();

    assert_eq!(
        harnesses["codex"]["suggested"],
        json!({ "models": ["gpt-6-sol", "gpt-6-luna"], "efforts": ["low", "high", "xhigh"] })
    );
    assert_eq!(
        harnesses["opencode"]["suggested"],
        json!({
            "models": ["openrouter/z-ai/glm-5.3-flash", "opencode-go/glm-5.3", "opencode/hy3-free"],
            "efforts": ["max", "high"],
        })
    );
    assert_eq!(harnesses["claude"].get("suggested"), None);
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

    // Only the Harnesses' own files, for the models and Efforts they suggest.
    let suggestions = vec![
        "read ~/.codex/models_cache.json".to_string(),
        "read ~/.local/state/opencode/model.json".to_string(),
    ];
    assert_eq!(asked_never_read, suggestions);
    assert_eq!(t.world.calls(), suggestions);
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
        "GET /wiki/<id>: the app at the Wiki's page, its Component in the fragment",
        "GET /api/status: the status of every Repo and Dispatch, and what each GitHub identity has used of its rate limits",
        "GET /api/map/<project>: the issues of the Project's Repos and how they block and stack on each other",
        "GET /api/node/<issue>: the issue's Dispatch, its restarts, its Verdict's findings, its Evidence and, while it is Asking, its Implementer's pane",
        "GET /api/events: a stream of `changed`, sent when state or an Agent state changes, and a keepalive comment otherwise",
        "GET /api/wikis: each Wiki of a Repo or a Library version, with the commit it describes, when it was built, its Gaps and the state of its build",
        "GET /api/wiki/<id>: the Wiki, a Repo's by its slug or a Library version's as owner/name@tag[:path]: its Components, Interpretations, Anchors and Gaps",
        "POST /api/dispatch {issue, harness, model, effort}: `nico-agent dispatch` of the issue",
        "POST /api/refresh: `nico-agent refresh`",
        "POST /api/assign {issue}: assign the issue to the user on its Source, unless someone else has it, and keep that in its Repo's last read",
        "POST /api/review {issue}: start a Reviewer on the head of the issue's PR now, its failed starts for that head cleared, whatever the review switch says",
        "POST /api/answer {issue, text|keys}: `nico-agent answer` of the issue, in words or keys",
        "POST /api/wiki/<id>/update|rebuild|continue: queue the Wiki's build first: an Update, one from nothing, or one asking only its budget Gaps",
        "PATCH /api/repo/<owner/name>/switches {name: bool}: set the Repo's switches; null takes its Project's or the default",
        "PATCH /api/repo/<owner/name> {implementer, reviewer, room, base, project, install, switches, libraries}: set the Repo's own settings; null takes its Project's or the default",
        "PATCH /api/project/<name> {implementer, reviewer, room, base, switches}: set the Project's defaults for its Repos; null removes one",
        "PATCH /api/wiki/settings {hour, launch, calls, depth, concurrency, embed_model}: set what every Wiki is built on; null takes the default",
        "POST /api/repo {slug, path, project}: `nico-agent repo add`",
        "DELETE /api/repo/<owner/name>: `nico-agent repo rm`, refused while the Repo has a Dispatch In flight",
        "POST /api/libraries {repo, tag, path}: add a Library version no Repo links, under [wiki] libraries, and queue its Wiki",
        "DELETE /api/libraries/<owner/name@tag[:path]>: remove a Library version [wiki] libraries adds, its Wiki taken out of the Bucket's files; refused while a Repo links it",
        "GET /bucket/<path>: a file of the Bucket, where each Verdict's Evidence is kept, or a page of a folder's",
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

#[test]
fn a_wiki_s_page_is_the_app_at_wiki_slash_its_id_a_repo_s_a_library_version_s_or_one_never_built() {
    let t = with_repo();
    t.tick();
    let app = fetch(&t, "/");

    for path in [
        "/wiki/acme/api",
        "/wiki/Effect-TS/effect@effect@3.17.0:packages/effect",
        "/wiki/nobody/nothing",
    ] {
        let (status, kind, page) = fetch(&t, path);
        assert_eq!((status, kind.as_str()), (200, app.1.as_str()), "{path}");
        assert!(page == app.2, "{path} answers another page than /");
    }
    let tunnel = config(&t) + "\n[bucket]\nurl = \"https://nico.example.com/\"\n";
    std::fs::write(t.config_dir.join("config.toml"), tunnel).unwrap();
    let headers = [("host", "nico.example.com")];
    let Answer::Whole(through) = t.request_with("GET", "/wiki/acme/api", &headers, "") else {
        panic!("GET /wiki/acme/api answered with a stream");
    };
    assert_eq!(through.status, 200);
    assert!(
        through.body == app.2,
        "the tunnel's host answers another page"
    );
}

const CHANGED: &str = "event: changed\ndata: {}\n\n";
const KEEPALIVE: &str = ": keepalive\n\n";

#[test]
fn events_sends_a_keepalive_comment_on_every_quiet_poll_so_a_proxy_never_sees_it_idle() {
    let t = dispatched();
    let mut events = t.events();

    // Cloudflare closes a response that sends nothing for 100 seconds: ten polls.
    let sent: String = (0..10).map(|_| events.next()).collect();

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
fn post_dispatch_while_github_is_paused_claims_nothing_and_warns_of_the_pause() {
    let t = ready_7();
    t.world.add_issue("acme/api", github_issue("acme/api", 8));
    t.cli(&["refresh"]);
    let limited = "GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z";
    t.world.fail_call("github assign", limited);
    t.send("POST", "/api/dispatch", r#"{"issue": "acme/api#7"}"#);
    t.world.clear_failures();
    t.world.calls.borrow_mut().clear();

    let (status, body) = t.send("POST", "/api/dispatch", r#"{"issue": "acme/api#8"}"#);

    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["warnings"],
        json!([format!(
            "could not Claim acme/api#8: {limited}; assign it to yourself by hand"
        )])
    );
    let github: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("github "))
        .collect();
    assert_eq!(github, ["github app repos"]);
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
        r#"{"stack": false, "gardening": true, "wiki": true}"#,
    );

    let defaults = json!({
        "dispatch": true, "mine": false, "stack": true, "review": true, "restart": true, "flip": true,
        "answer": false, "gardening": false, "quality_scan": false, "wiki": false,
    });
    let mut no_review = defaults.clone();
    no_review["review"] = json!(false);
    let mut no_stack_gardening = defaults;
    no_stack_gardening["stack"] = json!(false);
    no_stack_gardening["gardening"] = json!(true);
    no_stack_gardening["wiki"] = json!(true);
    assert_eq!(api, (200, json!({ "switches": no_review })));
    assert_eq!(web, (200, json!({ "switches": no_stack_gardening })));
    let expected = WRITTEN
        .replace("review = true }", "review = false }")
        .replace(
            "room = 1\n",
            "room = 1\nswitches = { gardening = true, stack = false, wiki = true }\n",
        );
    assert_eq!(config(&t), expected);
    assert_eq!(
        t.get("/api/status").1["repos"][0]["switches"]["review"],
        json!({ "value": false, "from": "repo" })
    );
}

#[test]
fn patch_switches_refuses_an_unknown_switch_slug_or_value_and_writes_nothing() {
    let t = written();
    let patch = |path: &str, body: &str| t.send("PATCH", path, body);
    let help = json!([
        "Switches: dispatch, mine, stack, review, restart, flip, answer, gardening, quality_scan, wiki"
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

/// Every file under the config dir, by its path there, with what it holds.
fn files(t: &Setup) -> Vec<(PathBuf, Vec<u8>)> {
    let (mut files, mut dirs) = (vec![], vec![t.config_dir.clone()]);
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path);
            } else {
                let held = std::fs::read(&path).unwrap();
                files.push((path.strip_prefix(&t.config_dir).unwrap().into(), held));
            }
        }
    }
    files.sort();
    files
}

#[test]
fn a_request_on_a_foreign_or_missing_host_answers_403_and_reads_nothing() {
    let t = ready_7();
    let before = files(&t);

    let foreign = t.send_with("GET", "/api/status", &[("Host", "evil.example")], "");
    let other_port = t.send_with("GET", "/api/status", &[("host", "127.0.0.1:4321")], "");
    let missing = t.send_with("GET", "/api/status", &[], "");

    let help = ["Ask serve on 127.0.0.1:42069, localhost:42069 or bucket.url's host"];
    assert_eq!(
        foreign,
        (
            403,
            json!({ "error": "Host evil.example is not serve's", "help": help })
        )
    );
    assert_eq!(other_port.0, 403, "{}", other_port.1);
    assert_eq!(
        missing,
        (
            403,
            json!({ "error": "the request names no Host", "help": help })
        )
    );
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(files(&t), before);
}

/// What the app sends that changes something: a refresh, a Dispatch of
/// Ready issue 7, a Switch turned off, a setting, the Repo added again and removed.
const WRITES: [(&str, &str, &str); 6] = [
    ("POST", "/api/refresh", ""),
    ("POST", "/api/dispatch", r#"{"issue": "acme/api#7"}"#),
    (
        "PATCH",
        "/api/repo/acme/api/switches",
        r#"{"review": false}"#,
    ),
    ("PATCH", "/api/repo/acme/api", r#"{"room": 2}"#),
    (
        "POST",
        "/api/repo",
        r#"{"slug": "acme/api", "path": "/src/api"}"#,
    ),
    ("DELETE", "/api/repo/acme/api", ""),
];

#[test]
fn a_post_patch_or_delete_from_a_page_on_another_host_answers_403_and_does_nothing() {
    let t = ready_7();
    let before = files(&t);

    for (method, path, body) in WRITES {
        for origin in ["https://evil.example", "null", "http://127.0.0.1:4321"] {
            let headers = [("Host", HOST), ("origin", origin)];

            let answered = t.send_with(method, path, &headers, body);

            let help = ["Send it from the app serve answers, or with no Origin"];
            let error = format!("Origin {origin} is not the request's Host");
            let refused = (403, json!({ "error": error, "help": help }));
            assert_eq!(answered, refused, "{method} {path}");
        }
    }
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(files(&t), before);
}

/// `ready_7`, set since serve started to serve the Bucket on the tunnel's `https://nico.example.com`.
fn on_tunnel() -> Setup {
    let t = ready_7();
    let tunnel = config(&t) + "\n[bucket]\nurl = \"https://nico.example.com/\"\n";
    std::fs::write(t.config_dir.join("config.toml"), tunnel).unwrap();
    t
}

#[test]
fn the_same_requests_from_the_app_on_127_0_0_1_localhost_or_bucket_url_s_host_answer_as_curl_s() {
    for (host, origin) in [
        (HOST, "http://127.0.0.1:42069"),
        ("localhost:42069", "http://localhost:42069"),
        ("nico.example.com", "https://nico.example.com"),
    ] {
        for (method, path, body) in WRITES.into_iter().chain([("GET", "/api/status", "")]) {
            let (app, curl) = (on_tunnel(), on_tunnel());

            let headers = [("host", host), ("Origin", origin)];
            let answered = app.send_with(method, path, &headers, body);
            let curl_s = curl.send(method, path, body);

            assert_eq!(answered.0, 200, "{method} {path} on {host}: {}", answered.1);
            assert_eq!(answered, curl_s, "{method} {path} on {host}");
            assert_eq!(app.world.calls(), curl.world.calls());
            assert_eq!(files(&app), files(&curl));
        }
    }
}

#[test]
fn patch_room_writes_room_in_the_repo_s_table_alone_and_answers_it() {
    let t = written();

    let api = t.send("PATCH", "/api/repo/acme/api", r#"{"room": 5}"#);
    let web = t.send("PATCH", "/api/repo/ACME/WEB", r#"{"room": 2}"#);

    assert_eq!(api.0, 200, "{}", api.1);
    assert_eq!(
        (&api.1["slug"], &api.1["room"]),
        (&json!("acme/api"), &json!({ "value": 5, "from": "repo" }))
    );
    assert_eq!(
        (&web.1["slug"], &web.1["room"]),
        (&json!("acme/web"), &json!({ "value": 2, "from": "repo" }))
    );
    let expected = WRITTEN
        .replace("# trust it\n", "# trust it\nroom = 5\n")
        .replace("room = 1\n", "room = 2\n");
    assert_eq!(config(&t), expected);
    assert_eq!(
        t.get("/api/status").1["repos"][0]["room"],
        json!({ "value": 5, "from": "repo" })
    );
}

#[test]
fn patch_repo_refuses_a_bad_value_of_any_setting_and_writes_nothing() {
    let t = written();
    let room = "room is how many Dispatches the Repo may have In flight at once, a whole number of at least 1";
    let settings = "Settings: implementer, reviewer, room, base, project, install, switches, libraries; null takes the Project's or the default";
    let switches = "Switches: dispatch, mine, stack, review, restart, flip, answer, gardening, quality_scan, wiki";
    let harnesses = "Harnesses: claude, codex, opencode";

    let bodies = [
        (
            r#"{"room": 0}"#,
            "room is a whole number of at least 1, not 0",
            room,
        ),
        (
            r#"{"room": -1}"#,
            "room is a whole number of at least 1, not -1",
            room,
        ),
        (
            r#"{"room": 1.5}"#,
            "room is a whole number of at least 1, not 1.5",
            room,
        ),
        (
            r#"{"room": "5"}"#,
            "room is a whole number of at least 1, not \"5\"",
            room,
        ),
        (
            r#"{"room": 4294967296}"#,
            "room is a whole number of at least 1, not 4294967296",
            room,
        ),
        ("{}", "{} sets nothing", settings),
        ("[5]", "[5] sets nothing", settings),
        (
            r#"{"room": 2, "rom": 2}"#,
            "`rom` is not a setting the page sets",
            settings,
        ),
        (
            r#"{"base": ""}"#,
            "base is a name, not \"\"",
            "base is the branch a Dispatch starts from unless stacked",
        ),
        (
            r#"{"base": " dev"}"#,
            "base is a name, not \" dev\"",
            "base is the branch a Dispatch starts from unless stacked",
        ),
        (
            r#"{"project": 7}"#,
            "project is a name, not 7",
            "project is the name of the Project the Repo joins",
        ),
        (
            r#"{"implementer": "claude"}"#,
            "implementer is {harness, model, effort}, not \"claude\"",
            harnesses,
        ),
        (
            r#"{"reviewer": {"harness": "claude", "modle": "opus"}}"#,
            "reviewer is {harness, model, effort}, not {\"harness\":\"claude\",\"modle\":\"opus\"}",
            harnesses,
        ),
        (
            r#"{"reviewer": {"harness": "pi"}}"#,
            "unknown Harness `pi`",
            "Valid Harnesses: claude, codex, opencode",
        ),
        (
            r#"{"implementer": {"harness": "claude", "model": "gpt-5"}}"#,
            "unknown model `gpt-5` for claude",
            "Valid models for claude: fable, opus, sonnet, haiku",
        ),
        (
            r#"{"switches": {"reveiw": false}}"#,
            "`reveiw` is not a switch",
            switches,
        ),
        (
            r#"{"switches": {"review": "no"}}"#,
            "review is true or false, not \"no\"",
            switches,
        ),
        (
            r#"{"switches": [true]}"#,
            "[true] is not an object of switches",
            switches,
        ),
    ];
    for (body, error, help) in bodies {
        assert_eq!(
            t.send("PATCH", "/api/repo/acme/api", body),
            (400, json!({ "error": error, "help": [help] })),
            "{body}"
        );
    }
    let unknown = t.send("PATCH", "/api/repo/acme/www", r#"{"room": 2}"#);

    assert_eq!(
        unknown,
        (
            409,
            json!({
                "error": "acme/www is not a configured Repo",
                "help": ["Run `nico-agent repo add acme/www --path <clone>` first"],
            })
        )
    );
    assert_eq!(config(&t), WRITTEN);
}

#[test]
fn patch_repo_writes_only_the_named_settings_keeping_the_user_s_comments_and_answers_its_settings()
{
    let t = written();

    let api = t.send(
        "PATCH",
        "/api/repo/acme%2Fapi",
        r#"{
            "implementer": {"harness": "codex", "model": "gpt-5"},
            "reviewer": {"harness": "claude", "model": "opus", "effort": null},
            "base": "dev",
            "switches": {"review": false, "gardening": true}
        }"#,
    );
    let web = t.send(
        "PATCH",
        "/api/repo/ACME/WEB",
        r#"{"room": 2, "project": "shop"}"#,
    );

    let expected = WRITTEN
        .replace(
            "switches = { dispatch = true, review = true } # trust it\n",
            "switches = { dispatch = true, review = false , gardening = true } # trust it\n\
             base = \"dev\"\n\
             implementer = { harness = \"codex\", model = \"gpt-5\" }\n\
             reviewer = { harness = \"claude\", model = \"opus\" }\n",
        )
        .replace("room = 1\n", "room = 2\nproject = \"shop\"\n");
    assert_eq!(config(&t), expected);
    assert_eq!(api.0, 200, "{}", api.1);
    assert_eq!(api.1["slug"], "acme/api");
    assert_eq!(
        api.1["implementer"],
        json!({ "value": { "harness": "codex", "model": "gpt-5", "effort": null }, "from": "repo" })
    );
    assert_eq!(
        api.1["reviewer"],
        json!({ "value": { "harness": "claude", "model": "opus", "effort": null }, "from": "repo" })
    );
    assert_eq!(api.1["base"], json!({ "value": "dev", "from": "repo" }));
    assert_eq!(
        api.1["switches"]["gardening"],
        json!({ "value": true, "from": "repo" })
    );
    assert_eq!(web, (200, web.1.clone()));
    assert_eq!(web.1["room"], json!({ "value": 2, "from": "repo" }));
    // The answer is the Repo's settings as status shows them.
    let status = t.get("/api/status").1;
    for (answer, shown) in [(&api.1, &status["repos"][0]), (&web.1, &status["repos"][1])] {
        for (key, setting) in answer.as_object().unwrap() {
            assert_eq!(&shown[key], setting, "{key}");
        }
    }
    let projects: Vec<_> = (status["projects"].as_array().unwrap().iter())
        .map(|p| (&p["name"], &p["repos"], &p["defaults"]))
        .collect();
    assert_eq!(
        projects,
        [
            (&json!("acme/api"), &json!(["acme/api"]), &json!({})),
            (&json!("shop"), &json!(["acme/web"]), &json!({})),
        ]
    );
}

/// `serve` listening, on `acme/api` in Project `shop`, each setting its own.
const IN_SHOP: &str = r#"[repos."acme/api"]
path = "/src/api"
project = "shop" # with web, one day
room = 2 # mine
reviewer = { harness = "opencode" }
switches = { review = true, stack = false }

[projects.shop]
room = 4
switches = { review = false }
"#;

fn in_shop() -> Setup {
    let t = with_repo();
    std::fs::write(t.config_dir.join("config.toml"), IN_SHOP).unwrap();
    t.tick();
    t
}

#[test]
fn null_removes_the_repo_s_own_value_and_status_shows_the_project_s_or_the_default() {
    let t = in_shop();

    let removed = t.send(
        "PATCH",
        "/api/repo/acme/api",
        r#"{"room": null, "reviewer": null, "switches": {"review": null}}"#,
    );

    assert_eq!(
        config(&t),
        IN_SHOP
            .replace(
                "room = 2 # mine\nreviewer = { harness = \"opencode\" }\n",
                ""
            )
            .replace("{ review = true, stack = false }", "{ stack = false }")
    );
    let shown = &t.get("/api/status").1["repos"][0];
    assert_eq!(shown["room"], json!({ "value": 4, "from": "project" }));
    assert_eq!(
        shown["switches"]["review"],
        json!({ "value": false, "from": "project" })
    );
    assert_eq!(
        shown["reviewer"],
        json!({ "value": { "harness": "codex", "model": null, "effort": null }, "from": "default" })
    );
    assert_eq!(removed.1["room"], shown["room"]);

    let last_switch = t.send(
        "PATCH",
        "/api/repo/acme/api",
        r#"{"switches": {"stack": null}}"#,
    );
    let out_of_shop = t.send("PATCH", "/api/repo/acme/api", r#"{"project": null}"#);

    assert_eq!((last_switch.0, out_of_shop.0), (200, 200));
    assert_eq!(
        config(&t),
        "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n[projects.shop]\nroom = 4\nswitches = { review = false }\n"
    );
    let shown = &t.get("/api/status").1["repos"][0];
    assert_eq!(shown["room"], json!({ "value": 3, "from": "default" }));
    assert_eq!(
        shown["switches"]["stack"],
        json!({ "value": true, "from": "default" })
    );
}

#[test]
fn patch_project_writes_its_defaults_which_its_repos_take_and_null_removes_one() {
    let t = in_shop();

    let set = t.send(
        "PATCH",
        "/api/project/shop",
        r#"{"room": 5, "implementer": {"harness": "codex"}, "switches": {"gardening": true}}"#,
    );
    let removed = t.send("PATCH", "/api/project/shop", r#"{"room": null}"#);
    // A Repo with no `project` is its own, named by its slug: its table is made.
    let mine = written();
    let own = mine.send("PATCH", "/api/project/acme%2Fapi", r#"{"base": "dev"}"#);

    assert_eq!(
        (set.0, &set.1["name"], &set.1["defaults"]),
        (
            200,
            &json!("shop"),
            &json!({
                "room": 5,
                "implementer": { "harness": "codex", "model": null, "effort": null },
                "switches": { "review": false, "gardening": true },
            })
        )
    );
    assert_eq!(removed.1["defaults"]["room"], json!(null));
    assert_eq!(
        (own.0, &own.1["name"], &own.1["defaults"]),
        (200, &json!("acme/api"), &json!({ "base": "dev" }))
    );
    assert_eq!(
        config(&t),
        IN_SHOP.replace(
            "room = 4\nswitches = { review = false }\n",
            "switches = { review = false , gardening = true }\nimplementer = { harness = \"codex\" }\n"
        )
    );
    assert_eq!(
        config(&mine),
        format!("{WRITTEN}\n[projects.\"acme/api\"]\nbase = \"dev\"\n")
    );
    assert_eq!(
        mine.get("/api/status").1["repos"][0]["base"],
        json!({ "value": "dev", "from": "project" })
    );
    let shown = &t.get("/api/status").1["repos"][0];
    assert_eq!(
        shown["implementer"],
        json!({ "value": { "harness": "codex", "model": null, "effort": null }, "from": "project" })
    );
    assert_eq!(
        shown["switches"]["gardening"],
        json!({ "value": true, "from": "project" })
    );
}

#[test]
fn a_project_shows_each_setting_from_itself_or_the_default_and_patch_project_answers_them() {
    let t = in_shop();
    let shop = |status: serde_json::Value| {
        let projects = status["projects"].as_array().unwrap().clone();
        projects.into_iter().find(|p| p["name"] == "shop").unwrap()
    };
    let before = shop(t.get("/api/status").1);

    let set = t.send(
        "PATCH",
        "/api/project/shop",
        r#"{"room": null, "base": "dev"}"#,
    );

    let setting = |value: serde_json::Value, from: &str| json!({ "value": value, "from": from });
    let launch = |harness: &str| json!({ "harness": harness, "model": null, "effort": null });
    assert_eq!(before["room"], setting(json!(4), "project"));
    assert_eq!(before["base"], setting(json!(null), "default"));
    assert_eq!(before["implementer"], setting(launch("claude"), "default"));
    // The default Reviewer: another Harness than the Implementer's.
    assert_eq!(before["reviewer"], setting(launch("codex"), "default"));
    assert_eq!(
        before["switches"]["review"],
        setting(json!(false), "project")
    );
    assert_eq!(before["switches"]["stack"], setting(json!(true), "default"));
    assert_eq!(set.0, 200, "{}", set.1);
    assert_eq!(set.1["room"], setting(json!(3), "default"));
    assert_eq!(set.1["base"], setting(json!("dev"), "project"));
    // The answer is the Project as status shows it.
    let after = shop(t.get("/api/status").1);
    for (key, answered) in set.1.as_object().unwrap() {
        assert_eq!(&after[key], answered, "{key}");
    }
}

#[test]
fn patch_project_refuses_project_a_bad_value_or_a_name_no_project_has_and_writes_nothing() {
    let t = in_shop();

    let project = t.send("PATCH", "/api/project/shop", r#"{"project": "mall"}"#);
    let bad = t.send("PATCH", "/api/project/shop", r#"{"room": 0}"#);
    let unknown = t.send("PATCH", "/api/project/mall", r#"{"room": 2}"#);

    assert_eq!(
        project,
        (
            400,
            json!({
                "error": "`project` is not a setting the page sets",
                "help": ["Settings: implementer, reviewer, room, base, switches; null takes the Project's or the default"],
            })
        )
    );
    assert_eq!(bad.0, 400);
    assert_eq!(
        unknown,
        (
            409,
            json!({ "error": "mall is not a Project", "help": ["Projects: shop"] })
        )
    );
    assert_eq!(config(&t), IN_SHOP);
}

/// `serve` listening on no Repo, `/src/web` a clone of acme/web; no calls recorded yet.
fn no_repo() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/web", &["git@github.com:acme/web.git"]);
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

#[test]
fn post_repo_adds_as_repo_add_does_and_delete_removes_as_repo_rm_does() {
    let (app, cli) = (no_repo(), no_repo());

    let posted = app.send(
        "POST",
        "/api/repo",
        r#"{"slug": "acme/web", "path": "/src/web", "project": "shop"}"#,
    );
    let added = cli.cli(&[
        "repo",
        "add",
        "acme/web",
        "--path",
        "/src/web",
        "--project",
        "shop",
        "--json",
    ]);

    assert_eq!(
        posted,
        (200, json!({ "repo": "acme/web added", "path": "/src/web" }))
    );
    assert_eq!(posted.1, added.json());
    assert_eq!(app.world.calls(), cli.world.calls());
    assert_eq!(
        config(&app),
        "[repos.\"acme/web\"]\npath = \"/src/web\"\nproject = \"shop\"\n"
    );
    assert_eq!(config(&app), config(&cli));

    let deleted = app.send("DELETE", "/api/repo/acme%2Fweb", "");
    let removed = cli.cli(&["repo", "rm", "acme/web", "--json"]);

    assert_eq!(
        deleted,
        (
            200,
            json!({ "repo": "acme/web removed", "stays": ["the clone at /src/web"] })
        )
    );
    assert_eq!(deleted.1, removed.json());
    assert_eq!(config(&app), config(&cli));
    assert_eq!(app.get("/api/status").1["repos"], json!([]));
}

#[test]
fn post_repo_refuses_as_repo_add_does_and_writes_nothing() {
    let t = no_repo();
    let usage = "Run `nico-agent repo add <owner/name> --path <clone> [--project <name>] [--linear-team <team> --linear-project <project> --linear-label <label>]` to add a Repo";

    let no_path = t.send("POST", "/api/repo", r#"{"slug": "acme/web"}"#);
    let not_a_string = t.send("POST", "/api/repo", r#"{"slug": "acme/web", "path": 7}"#);
    let not_a_clone = t.send(
        "POST",
        "/api/repo",
        r#"{"slug": "acme/api", "path": "/src/web"}"#,
    );

    assert_eq!(
        no_path,
        (
            400,
            json!({ "error": "missing required flag --path", "help": [usage] })
        )
    );
    assert_eq!(
        not_a_string,
        (
            400,
            json!({ "error": "path is a string, not 7", "help": [usage] })
        )
    );
    assert_eq!(not_a_clone.0, 409);
    assert_eq!(
        not_a_clone.1["error"],
        "/src/web is not a clone of acme/api (its remotes: git@github.com:acme/web.git)"
    );
    assert!(!t.config_dir.join("config.toml").exists());
}

#[test]
fn delete_repo_is_refused_while_the_repo_has_a_dispatch_in_flight() {
    let t = dispatched();
    let before = config(&t);

    let refused = t.send("DELETE", "/api/repo/ACME/API", "");

    assert_eq!(
        refused,
        (
            409,
            json!({
                "error": "ACME/API has a Dispatch In flight: acme/api#7",
                "help": ["Remove it once each is Closed, or run `nico-agent repo rm ACME/API`, which keeps them In flight till they are Closed"],
            })
        )
    );
    assert_eq!(config(&t), before);
}

#[test]
fn a_launch_written_as_its_own_table_keeps_its_header_and_comments() {
    let t = with_repo();
    let written = "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n# codex is cheaper\n[repos.\"acme/api\".reviewer]\nharness = \"codex\" # for now\neffort = \"high\"\n";
    std::fs::write(t.config_dir.join("config.toml"), written).unwrap();
    t.tick();

    let set = t.send(
        "PATCH",
        "/api/repo/acme/api",
        r#"{"reviewer": {"harness": "claude", "model": "opus"}}"#,
    );

    assert_eq!(set.0, 200, "{}", set.1);
    assert_eq!(
        config(&t),
        "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n# codex is cheaper\n[repos.\"acme/api\".reviewer]\nharness = \"claude\" # for now\nmodel = \"opus\"\n"
    );
}

/// `serve` listening, on `acme/api`, its `[wiki]` written with comments.
const WIKI_WRITTEN: &str = r#"[repos."acme/api"]
path = "/src/api"

# Wikis overnight, on the cheap model
[wiki]
hour = 3 # after the scan
calls = 20
"#;

fn wiki_written() -> Setup {
    let t = with_repo();
    std::fs::write(t.config_dir.join("config.toml"), WIKI_WRITTEN).unwrap();
    t.tick();
    t
}

#[test]
fn patch_wiki_settings_writes_wiki_keeping_the_user_s_comments_and_answers_every_wiki_s_settings() {
    let t = wiki_written();

    let set = t.send(
        "PATCH",
        "/api/wiki/settings",
        r#"{
            "hour": 4,
            "launch": {"harness": "claude", "model": "sonnet", "effort": null},
            "calls": null,
            "depth": 5,
            "concurrency": 2,
            "embed_model": "mxbai-embed-large"
        }"#,
    );

    assert_eq!(
        config(&t),
        "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n# Wikis overnight, on the cheap model\n[wiki]\nhour = 4 # after the scan\nconcurrency = 2\ndepth = 5\nembed_model = \"mxbai-embed-large\"\nlaunch = { harness = \"claude\", model = \"sonnet\" }\n"
    );
    let settings = json!({
        "hour": 4,
        "launch": { "harness": "claude", "model": "sonnet", "effort": null },
        "calls": 48,
        "depth": 5,
        "concurrency": 2,
        "embed_model": "mxbai-embed-large",
        "harnesses": {
            "claude": {
                "models": ["fable", "opus", "sonnet", "haiku"],
                "efforts": ["low", "medium", "high", "xhigh", "max"],
            },
            "codex": { "models": null, "efforts": null },
            "opencode": { "models": null, "efforts": null },
        },
    });
    assert_eq!(set, (200, settings.clone()));
    assert_eq!(t.get("/api/status").1["wiki_settings"], settings);
}

#[test]
fn patch_wiki_settings_refuses_an_unknown_harness_with_help_or_a_bad_value_and_writes_nothing() {
    let t = wiki_written();
    let settings =
        "Settings: hour, launch, calls, depth, concurrency, embed_model; null takes the default";
    let builds = "Harnesses that build a Wiki: claude, codex, opencode";

    let bodies = [
        ("{}", "{} sets nothing", settings),
        (
            r#"{"ollama": "x"}"#,
            "`ollama` is not a setting the page sets",
            settings,
        ),
        (
            r#"{"launch": {"harness": "pi"}}"#,
            "unknown Harness `pi`",
            builds,
        ),
        (
            r#"{"launch": "claude"}"#,
            "launch is {harness, model, effort}, not \"claude\"",
            builds,
        ),
        (
            r#"{"launch": {"harness": "claude", "model": "gpt-5"}}"#,
            "unknown model `gpt-5` for claude",
            "Valid models for claude: fable, opus, sonnet, haiku",
        ),
        (
            r#"{"hour": 24}"#,
            "hour is an hour from 0 to 23, not 24",
            "hour is when the loop checks each Repo's Wiki against its Base, daily, local time",
        ),
        (
            r#"{"calls": 0}"#,
            "calls is a whole number of at least 1, not 0",
            "calls is how many model calls a build may make",
        ),
        (
            r#"{"depth": 1.5}"#,
            "depth is a whole number of at least 1, not 1.5",
            "depth is how deep a build divides the code",
        ),
        (
            r#"{"concurrency": "4"}"#,
            "concurrency is a whole number of at least 1, not \"4\"",
            "concurrency is how many calls a build makes at once",
        ),
        (
            r#"{"embed_model": " "}"#,
            "embed_model is a model's name, not \" \"",
            "embed_model is the Ollama model that embeds each Wiki for `ask`",
        ),
    ];
    for (body, error, help) in bodies {
        assert_eq!(
            t.send("PATCH", "/api/wiki/settings", body),
            (400, json!({ "error": error, "help": [help] })),
            "{body}"
        );
    }
    assert_eq!(config(&t), WIKI_WRITTEN);
}

#[test]
fn patch_wiki_settings_refuses_a_harness_with_no_headless_form() {
    let t = with_repo();
    let written = "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n[harnesses.aider]\nlaunch_mode = \"pane-command\"\ncommand = \"aider\"\nsigil = \"/\"\nmodel_args = []\neffort_args = []\n";
    std::fs::write(t.config_dir.join("config.toml"), written).unwrap();
    t.tick();

    let refused = t.send(
        "PATCH",
        "/api/wiki/settings",
        r#"{"launch": {"harness": "aider"}}"#,
    );

    assert_eq!(
        refused,
        (
            400,
            json!({
                "error": "aider has no headless form: a Wiki builds on claude, codex or opencode",
                "help": ["Harnesses that build a Wiki: claude, codex, opencode"],
            })
        )
    );
    assert_eq!(config(&t), written);
    // The settings list only the Harnesses a Wiki builds on.
    let harnesses = &t.get("/api/status").1["wiki_settings"]["harnesses"];
    let names: Vec<&String> = harnesses.as_object().unwrap().keys().collect();
    assert_eq!(names, ["claude", "codex", "opencode"]);
}
