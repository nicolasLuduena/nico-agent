//! Wiki builds as Runs of the loop: queued by the tick, one open at a time
//! in a herdr pane running `nico-agent wiki build`, closed on its outcome.

mod common;

use std::time::Duration;

use common::{Setup, setup};
use serde_json::{Value, json};

const BUCKET: &str = "/mnt/agents-land/nico-agent-bucket";
const TICK: Duration = Duration::from_secs(600);

/// Repos `acme/api` at `/src/api` and `acme/web` at `/src/web`, each set as
/// `toml` sets it, with no issues, on Wednesday at noon UTC; each one's
/// `origin/main` holds `src/lib.rs`.
fn with_repos(toml: &str) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let mut config = String::new();
    for (slug, path) in [("acme/api", "/src/api"), ("acme/web", "/src/web")] {
        t.world
            .add_clone(path, &[&format!("git@github.com:{slug}.git")]);
        t.world
            .add_tree_file(path, "origin/main", "src/lib.rs", "pub fn run() {}\n");
        config += &format!("[repos.\"{slug}\"]\npath = \"{path}\"\n{toml}\n\n");
    }
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_clone(BUCKET, &[]);
    t
}

/// What the build of the Wiki of `slug` the pane runs does: it answers its
/// one part with a leaf.
fn build(t: &Setup, slug: &str) {
    (t.world.headless.borrow_mut()).push((
        format!("## The part: {slug}"),
        json!({ "kind": "leaf", "overview": "A small crate." }).to_string(),
    ));
    let ran = t.cli(&["wiki", "build", slug, "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
}

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// The calls but the Source reads and the read of herdr's agents.
fn started(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| !c.starts_with("github ") && *c != "herdr agent list")
        .map(String::as_str)
        .collect()
}

/// What `status` shows of each Wiki.
fn wikis(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()["wikis"].clone()
}

#[test]
fn a_switch_turned_on_with_no_wiki_starts_its_build_in_a_herdr_pane_at_the_next_tick() {
    let t = with_repos("");
    let off = t.tick();
    let (status, _) = t.send("PATCH", "/api/repo/acme/api/switches", r#"{"wiki": true}"#);
    assert_eq!(status, 200);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(off, Vec::<String>::new());
    assert_eq!(
        said,
        [
            "acme/api: wiki queued, it has none",
            "acme/api: wiki started on opencode",
        ]
    );
    assert_eq!(
        started(&calls),
        [
            "herdr workspace create --cwd /src/api --label wiki-api --no-focus",
            "herdr tab rename w1:t1 wiki",
            "herdr pane run w1:p1 nico-agent wiki build acme/api; exit",
        ]
    );
    assert_eq!(
        wikis(&t),
        json!([{
            "wiki": "acme/api",
            "target": { "repo": "acme/api" },
            "state": "building",
            "commit": null,
            "built_at": null,
            "gaps": null,
            "pane": "w1:p1",
            "progress": null,
        }])
    );
}

const ON: &str = "switches = { wiki = true }";

#[test]
fn a_run_is_closed_on_its_builds_outcome_and_the_wiki_shown_built() {
    let t = with_repos(ON);
    t.tick();
    // The second Repo's build waits its turn.
    t.world.advance(TICK);
    let (building, asked) = calls_after(&t, || t.tick());
    build(&t, "acme/api");
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(building, Vec::<String>::new());
    assert_eq!(started(&asked), ["herdr pane get w1:p1"]);
    assert_eq!(
        said,
        [
            "acme/api: wiki built at abc1234; its workspace closed",
            "acme/web: wiki started on opencode",
        ]
    );
    assert_eq!(
        started(&calls)[..2],
        ["herdr pane get w1:p1", "herdr workspace close w1"]
    );
    assert_eq!(
        wikis(&t)[0],
        json!({
            "wiki": "acme/api",
            "target": { "repo": "acme/api" },
            "state": "built",
            "commit": "abc1234",
            "built_at": "2026-09-30T12:10:00Z",
            "gaps": 0,
            "pane": null,
            "progress": null,
        })
    );
    let runs: Value =
        serde_json::from_str(&std::fs::read_to_string(t.config_dir.join("runs.json")).unwrap())
            .unwrap();
    assert_eq!(runs[0]["trigger"], "wiki");
    assert_eq!(runs[0]["closed_at"], "2026-09-30T12:20:00Z");
}

#[test]
fn a_run_whose_pane_is_gone_without_an_outcome_is_closed_failed() {
    let t = with_repos(ON);
    t.tick();
    t.world.gone_panes.borrow_mut().push("w1:p1".into());
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said[0],
        "acme/api: wiki failed: its pane is gone without an outcome; its workspace closed"
    );
    assert_eq!(
        started(&calls)[..2],
        ["herdr pane get w1:p1", "herdr workspace close w1"]
    );
    let api = &wikis(&t)[0];
    assert_eq!(
        (&api["state"], &api["why"], &api["failed_at"]),
        (
            &json!("failed"),
            &json!("its pane is gone without an outcome"),
            &json!("2026-09-30T12:10:00Z")
        )
    );
    // Failed, it is not queued again till its Base is checked at the wiki hour.
    t.world.advance(TICK);
    assert_eq!(t.tick(), Vec::<String>::new());
    // Never in Needs you: no notification, and no Run Needs you reads.
    assert!(!calls.iter().any(|c| c.starts_with("notify ")));
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status.get("morning"), None);
    assert_eq!(status["repos"][0].get("last_scan"), None);
}

#[test]
fn a_run_whose_start_failed_is_closed_failed_with_why_at_the_next_tick() {
    let t = with_repos(ON);
    t.world.fail_call(
        "herdr workspace create --cwd /src/api",
        "`herdr workspace create` failed: no server",
    );

    let failed = t.tick();
    t.world.advance(TICK);
    let closed = t.tick();

    assert_eq!(
        failed[2],
        "could not start the wiki of acme/api: `herdr workspace create` failed: no server"
    );
    assert_eq!(
        closed[0],
        "acme/api: wiki failed: `herdr workspace create` failed: no server"
    );
    assert_eq!(wikis(&t)[0]["state"], "failed");
}

#[test]
fn with_two_builds_queued_one_run_is_open_and_the_other_shows_queued_till_it_closes() {
    let t = with_repos(ON);

    let said = t.tick();
    let both = wikis(&t);
    build(&t, "acme/api");
    t.world.advance(TICK);
    t.tick();

    assert_eq!(
        said,
        [
            "acme/api: wiki queued, it has none",
            "acme/web: wiki queued, it has none",
            "acme/api: wiki started on opencode",
        ]
    );
    let states = |shown: &Value| -> Vec<(String, String)> {
        let field = |w: &Value, key: &str| w[key].as_str().unwrap().to_string();
        (shown.as_array().unwrap().iter())
            .map(|w| (field(w, "wiki"), field(w, "state")))
            .collect()
    };
    let state = |wiki: &str, state: &str| (wiki.to_string(), state.to_string());
    assert_eq!(
        states(&both),
        [state("acme/api", "building"), state("acme/web", "queued")]
    );
    assert_eq!(both[1]["pane"], Value::Null);
    assert_eq!(
        states(&wikis(&t)),
        [state("acme/api", "built"), state("acme/web", "building")]
    );
    assert_eq!(wikis(&t)[1]["pane"], "w2:p1");
}

#[test]
fn a_wiki_run_never_takes_room_from_a_dispatch() {
    let t = with_repos(&format!("room = 1\n{ON}"));
    let started = t.tick();
    t.world
        .add_issue("acme/api", common::github_issue("acme/api", 7));
    t.world.advance(TICK);

    let said = t.tick();

    assert!(started.contains(&"acme/api: wiki started on opencode".to_string()));
    assert_eq!(said, ["acme/api#7 dispatched"]);
}

/// Both Repos' Wikis built at `abc1234` by 12:20 on the first day.
fn both_built(t: &Setup) {
    t.tick();
    build(t, "acme/api");
    t.world.advance(TICK);
    t.tick();
    build(t, "acme/web");
    t.world.advance(TICK);
    let said = t.tick();
    assert_eq!(
        said,
        ["acme/web: wiki built at abc1234; its workspace closed"]
    );
}

/// The Base checks of the Wikis each call of `calls` makes.
fn checks(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| c.contains(" rev-parse origin/"))
        .map(String::as_str)
        .collect()
}

/// From 12:20 to 01:50 the next day.
const TO_1_50AM: Duration = Duration::from_secs(13 * 3600 + 30 * 60);

#[test]
fn at_the_wiki_hour_a_moved_base_queues_a_build_and_an_unmoved_one_does_not_once_a_day() {
    let t = with_repos(ON);
    both_built(&t);
    t.world.advance(TO_1_50AM);
    let (before, unchecked) = calls_after(&t, || t.tick());
    (t.world.heads.borrow_mut()).insert("/src/api origin/main".into(), "def5678".into());
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    (t.world.heads.borrow_mut()).insert("/src/web origin/main".into(), "fed8765".into());
    t.world.advance(TICK);
    let (later, rechecked) = calls_after(&t, || t.tick());

    assert_eq!(before, Vec::<String>::new());
    assert_eq!(checks(&unchecked), Vec::<&str>::new());
    assert_eq!(
        said,
        [
            "acme/api: wiki queued, origin/main moved from abc1234 to def5678",
            "acme/api: wiki started on opencode",
        ]
    );
    assert_eq!(
        started(&calls)[..6],
        [
            "git -C /src/api default-branch",
            "git -C /src/api fetch origin",
            "git -C /src/api rev-parse origin/main",
            "git -C /src/web default-branch",
            "git -C /src/web fetch origin",
            "git -C /src/web rev-parse origin/main",
        ]
    );
    // Checked once a day: the Base moved since is the next day's.
    assert_eq!(later, Vec::<String>::new());
    assert_eq!(checks(&rechecked), Vec::<&str>::new());
    t.world
        .advance(Duration::from_secs(86_400 - TICK.as_secs()));
    let next_day = t.tick();
    assert!(
        next_day
            .contains(&"acme/web: wiki queued, origin/main moved from abc1234 to fed8765".into()),
        "{next_day:?}"
    );
}

#[test]
fn the_wiki_hour_is_local_and_a_failed_build_is_tried_again_there() {
    let t = with_repos(ON);
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, config + "[wiki]\nhour = 4\n").unwrap();
    // Buenos Aires: 04:00 there is 07:00 UTC.
    t.world.utc_offset.set(-3 * 3600);
    t.tick();
    t.world.gone_panes.borrow_mut().push("w1:p1".into());
    t.world.advance(TICK);
    t.tick();
    build(&t, "acme/web");
    t.world.advance(TICK);
    t.tick();
    // 06:50 UTC the next day.
    t.world.advance(Duration::from_secs(18 * 3600 + 30 * 60));
    let before = t.tick();
    t.world.advance(TICK);

    let said = t.tick();

    assert_eq!(before, Vec::<String>::new());
    assert_eq!(
        said,
        [
            "acme/api: wiki queued, it has none",
            "acme/api: wiki started on opencode",
        ]
    );
}

#[test]
fn a_switch_turned_off_drops_its_queued_build_and_stops_updates_and_its_wiki_stays_shown() {
    let t = with_repos(ON);
    t.tick();
    let off = |slug: &str| {
        let path = format!("/api/repo/{slug}/switches");
        assert_eq!(t.send("PATCH", &path, r#"{"wiki": false}"#).0, 200);
    };
    off("acme/web");
    build(&t, "acme/api");
    t.world.advance(TICK);
    let closed = t.tick();
    off("acme/api");
    (t.world.heads.borrow_mut()).insert("/src/api origin/main".into(), "def5678".into());
    // 02:00 the next day.
    t.world.advance(Duration::from_secs(13 * 3600 + 50 * 60));

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        closed,
        ["acme/api: wiki built at abc1234; its workspace closed"]
    );
    assert_eq!(said, Vec::<String>::new());
    assert_eq!(checks(&calls), Vec::<&str>::new());
    let shown = wikis(&t);
    assert_eq!(shown.as_array().unwrap().len(), 1, "{shown}");
    assert_eq!(
        (&shown[0]["wiki"], &shown[0]["state"]),
        (&json!("acme/api"), &json!("built"))
    );
}

#[test]
fn a_run_whose_pane_did_not_take_its_command_is_closed_failed_and_the_next_one_starts() {
    let t = with_repos(ON);
    t.world
        .fail_call("herdr pane run w1:p1", "`herdr pane run` failed: pane busy");

    t.tick();
    t.world.advance(TICK);
    let said = t.tick();

    assert_eq!(
        said,
        [
            "acme/api: wiki failed: `herdr pane run` failed: pane busy; its workspace closed",
            "acme/web: wiki started on opencode",
        ]
    );
}

#[test]
fn a_build_that_ends_while_the_tick_asks_for_its_pane_closes_its_run_built() {
    let t = with_repos(ON);
    t.tick();
    t.world.advance(TICK);
    // The build writes its outcome and exits, and its pane goes with it.
    let file = t.config_dir.join("wikis.json");
    let built = r#"{"acme/api": {"outcome": "built", "at": "2026-09-30T12:10:00Z", "commit": "abc1234", "components": 1, "gaps": {}}}"#;
    t.world.during_call("herdr pane get w1:p1", move || {
        std::fs::write(&file, built).unwrap()
    });
    t.world.gone_panes.borrow_mut().push("w1:p1".into());

    let said = t.tick();

    assert_eq!(
        said[0],
        "acme/api: wiki built at abc1234; its workspace closed"
    );
    assert_eq!(wikis(&t)[0]["state"], "built");
}

#[test]
fn a_failed_build_after_a_good_one_keeps_its_wiki_shown_and_unmoved_it_is_not_built_again() {
    let t = with_repos(ON);
    both_built(&t);
    (t.world.heads.borrow_mut()).insert("/src/api origin/main".into(), "def5678".into());
    t.world.advance(TO_1_50AM + TICK);
    t.tick();
    t.world.gone_panes.borrow_mut().push("w3:p1".into());
    (t.world.heads.borrow_mut()).remove("/src/api origin/main");
    t.world.advance(TICK);
    let failed = t.tick();
    let shown = wikis(&t)[0].clone();

    t.world.advance(Duration::from_secs(86_400));
    let next_day = t.tick();

    assert_eq!(
        failed,
        ["acme/api: wiki failed: its pane is gone without an outcome; its workspace closed"]
    );
    assert_eq!(
        (
            &shown["state"],
            &shown["commit"],
            &shown["built_at"],
            &shown["gaps"]
        ),
        (
            &json!("failed"),
            &json!("abc1234"),
            &json!("2026-09-30T12:00:00Z"),
            &json!(0)
        )
    );
    // Its Base is back at its Wiki's commit: a quiet night.
    assert_eq!(next_day, Vec::<String>::new());
}

#[test]
fn a_switch_turned_off_and_on_again_checks_its_wiki_at_once() {
    let t = with_repos(ON);
    t.tick();
    t.world.gone_panes.borrow_mut().push("w1:p1".into());
    t.world.advance(TICK);
    t.tick();
    let switch = |on: bool| {
        let body = format!(r#"{{"wiki": {on}}}"#);
        assert_eq!(t.send("PATCH", "/api/repo/acme/api/switches", &body).0, 200);
        t.world.advance(TICK);
        t.tick()
    };
    build(&t, "acme/web");

    let off = switch(false);
    let on = switch(true);

    assert_eq!(
        off,
        ["acme/web: wiki built at abc1234; its workspace closed"]
    );
    assert_eq!(
        on,
        [
            "acme/api: wiki queued, it has none",
            "acme/api: wiki started on opencode",
        ]
    );
}

#[test]
fn a_build_of_a_repo_that_has_a_wiki_is_an_update() {
    let t = with_repos(ON);
    both_built(&t);
    t.world.advance(TO_1_50AM);
    t.tick();
    (t.world.heads.borrow_mut()).insert("/src/api origin/main".into(), "def5678".into());
    t.world.advance(TICK);

    let (_, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        ran(&calls),
        ["nico-agent wiki build acme/api --update; exit"]
    );
}

/// The command the pane of each wiki Run started in `calls` runs.
fn ran(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter_map(|c| c.strip_prefix("herdr pane run "))
        .map(|c| c.split_once(' ').unwrap().1)
        .collect()
}

#[test]
fn a_button_queues_its_build_first_and_the_tick_starts_it_as_asked_once_the_open_run_closes() {
    let t = with_repos(ON);
    t.tick();

    let (status, queued) = t.send("POST", "/api/wiki/acme%2Fapi/rebuild", "");
    let shown = wikis(&t);
    build(&t, "acme/api");
    t.world.advance(TICK);
    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        (status, queued),
        (
            200,
            json!({ "wiki": "acme/api", "build": "rebuild", "waiting": ["acme/api", "acme/web"] })
        )
    );
    // Asked again while it builds: it shows building, then queued.
    assert_eq!(
        (&shown[0]["state"], &shown[1]["state"]),
        (&json!("building"), &json!("queued"))
    );
    assert_eq!(
        said,
        [
            "acme/api: wiki built at abc1234; its workspace closed",
            "acme/api: wiki started on opencode",
        ]
    );
    assert_eq!(
        ran(&calls),
        ["nico-agent wiki build acme/api --rebuild; exit"]
    );
    let shown = wikis(&t);
    assert_eq!(
        (&shown[0]["state"], &shown[1]["state"]),
        (&json!("building"), &json!("queued"))
    );
}

#[test]
fn update_and_continue_start_their_own_build_even_with_the_wiki_switch_off() {
    let t = with_repos("");
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    // One call: acme/api's division leaves its part a budget Gap.
    std::fs::write(&file, config + "[wiki]\ncalls = 1\n").unwrap();
    let core = json!({ "name": "Core", "summary": "The crate.", "files": ["src/lib.rs"] });
    (t.world.headless.borrow_mut()).push((
        "## The part: acme/api".into(),
        json!({ "kind": "division", "overview": "An API.", "components": [core] }).to_string(),
    ));
    build(&t, "acme/api");
    build(&t, "acme/web");
    t.tick();

    let update = t.send("POST", "/api/wiki/acme/web/update", "");
    let continued = t.send("POST", "/api/wiki/acme/api/continue", "");
    let (_, first) = calls_after(&t, || t.tick());
    build(&t, "acme/api");
    t.world.advance(TICK);
    let (_, second) = calls_after(&t, || t.tick());

    assert_eq!(update.0, 200, "{}", update.1);
    let budget = |listed: &Value| (listed[0]["budget"].clone(), listed[1]["budget"].clone());
    assert_eq!(budget(&t.get("/api/wikis").1), (json!(1), json!(0)));
    assert_eq!(
        continued.1["waiting"],
        json!(["acme/api", "acme/web"]),
        "{}",
        continued.1
    );
    assert_eq!(
        ran(&first),
        ["nico-agent wiki build acme/api --continue; exit"]
    );
    assert_eq!(
        ran(&second),
        ["nico-agent wiki build acme/web --update; exit"]
    );
}

#[test]
fn continue_is_offered_and_queued_for_a_wiki_with_an_unanswered_gap() {
    let t = with_repos("");
    // Core has no answer scripted: its call errors, and it is an unanswered Gap.
    let core = json!({ "name": "Core", "summary": "The crate.", "files": ["src/lib.rs"] });
    (t.world.headless.borrow_mut()).push((
        "## The part: acme/api".into(),
        json!({ "kind": "division", "overview": "An API.", "components": [core] }).to_string(),
    ));
    build(&t, "acme/api");
    t.tick();

    let continued = t.send("POST", "/api/wiki/acme/api/continue", "");

    assert_eq!(t.get("/api/wikis").1[0]["budget"], 1);
    assert_eq!(continued.0, 200, "{}", continued.1);
    assert_eq!(continued.1["build"], "continue");
}

#[test]
fn a_button_is_refused_for_no_repo_and_continue_for_a_wiki_with_no_budget_gaps() {
    let t = with_repos("");
    build(&t, "acme/api");
    t.tick();

    let unknown = t.send("POST", "/api/wiki/acme/nope/rebuild", "");
    let unbuilt = t.send("POST", "/api/wiki/acme/web/continue", "");
    let whole = t.send("POST", "/api/wiki/acme/api/continue", "");
    let other = t.send("POST", "/api/wiki/acme/api/delete", "");

    assert_eq!(unknown.0, 409);
    assert_eq!(
        unknown.1["error"], "acme/nope is not a configured Repo",
        "{}",
        unknown.1
    );
    assert_eq!(
        unbuilt,
        (
            409,
            json!({ "error": "acme/web has no Wiki to continue", "help": ["Build it first: nico-agent wiki build acme/web"] })
        )
    );
    assert_eq!(
        whole,
        (
            409,
            json!({ "error": "the Wiki of acme/api has no budget or unanswered Gaps to continue", "help": ["Update it, or Rebuild it from nothing"] })
        )
    );
    assert_eq!(other.0, 404);
    // Nothing queued.
    assert_eq!(t.tick(), Vec::<String>::new());
}

#[test]
fn the_wikis_listed_show_their_build_building_with_its_pane_queued_or_failed_with_why() {
    let t = with_repos(ON);
    both_built(&t);
    t.send("POST", "/api/wiki/acme/api/rebuild", "");
    t.send("POST", "/api/wiki/acme/web/update", "");
    t.tick();
    let building = t.get("/api/wikis");
    t.world.gone_panes.borrow_mut().push("w3:p1".into());
    t.world.advance(TICK);
    t.tick();

    let failed = t.get("/api/wikis");

    let shown = |id: &str, state: &str, pane: Value, why: Value| {
        json!({
            "id": id,
            "target": { "repo": id },
            "commit": "abc1234",
            "builtAt": if id == "acme/api" { "2026-09-30T12:00:00Z" } else { "2026-09-30T12:10:00Z" },
            "gaps": 0,
            "budget": 0,
            "calls": 48,
            "state": state,
            "pane": pane,
            "why": why,
            "progress": null,
        })
    };
    assert_eq!(
        building,
        (
            200,
            json!([
                shown("acme/api", "queued", Value::Null, Value::Null),
                shown("acme/web", "building", json!("w3:p1"), Value::Null),
            ])
        )
    );
    assert_eq!(
        failed.1,
        json!([
            shown("acme/api", "building", json!("w4:p1"), Value::Null),
            shown(
                "acme/web",
                "failed",
                Value::Null,
                json!("its pane is gone without an outcome")
            ),
        ])
    );
}

#[test]
fn a_build_a_button_queued_at_the_wiki_hour_leaves_its_base_check_till_it_is_built() {
    let t = with_repos(ON);
    both_built(&t);
    t.world.advance(TO_1_50AM);
    t.tick();
    (t.world.heads.borrow_mut()).insert("/src/api origin/main".into(), "def5678".into());
    assert_eq!(t.send("POST", "/api/wiki/acme/api/rebuild", "").0, 200);
    t.world.advance(TICK);
    let (started, calls) = calls_after(&t, || t.tick());
    // Built at the commit its Wiki describes, as a Continue is.
    build(&t, "acme/api");
    t.world.advance(TICK);

    let said = t.tick();

    assert_eq!(started, ["acme/api: wiki started on opencode"]);
    assert_eq!(checks(&calls), ["git -C /src/web rev-parse origin/main"]);
    assert_eq!(
        said,
        [
            "acme/api: wiki built at abc1234; its workspace closed",
            "acme/api: wiki queued, origin/main moved from abc1234 to def5678",
            "acme/api: wiki started on opencode",
        ]
    );
}

/// The progress of a build of `acme/api` started at `at`, half-way
/// through its calls.
fn half_way_progress(at: &str) -> Value {
    json!({
        "at": at, "calls": 48, "made": 17, "depth": 7, "reached": 2,
        "asked": 15, "sent_back": 2, "gaps": 1, "now": ["acme/api > Core", "acme/api > Web"],
    })
}

/// The build of `acme/api` started at `at`, half-way through its calls, as
/// `nico-agent wiki build` keeps its progress while it runs.
fn half_way(t: &Setup, at: &str) {
    let file = t.config_dir.join("wiki/acme/api/progress.json");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, half_way_progress(at).to_string()).unwrap();
}

#[test]
fn a_building_wiki_shows_its_builds_progress_from_its_runs_start_and_a_queued_one_none() {
    let t = with_repos(ON);
    t.tick();
    // The build starts a few seconds after its Run.
    half_way(&t, "2026-09-30T12:00:04Z");

    let shown = wikis(&t);

    assert_eq!(
        shown[0]["progress"],
        half_way_progress("2026-09-30T12:00:00Z")
    );
    assert_eq!(
        (&shown[1]["state"], &shown[1]["progress"]),
        (&json!("queued"), &Value::Null)
    );
}

#[test]
fn a_build_whose_pane_died_shows_no_progress_once_its_run_closed_nor_in_the_next_run() {
    let t = with_repos("");
    t.tick();
    t.send("PATCH", "/api/repo/acme/api/switches", r#"{"wiki": true}"#);
    t.tick();
    half_way(&t, "2026-09-30T12:00:00Z");
    t.world.gone_panes.borrow_mut().push("w1:p1".into());
    t.world.advance(TICK);
    t.tick();
    let failed = wikis(&t);
    t.send("POST", "/api/wiki/acme/api/rebuild", "");
    t.world.advance(TICK);
    t.tick();

    let again = wikis(&t);

    assert_eq!(
        (&failed[0]["state"], &failed[0]["progress"]),
        (&json!("failed"), &Value::Null)
    );
    assert_eq!(
        (&again[0]["state"], &again[0]["pane"], &again[0]["progress"]),
        (&json!("building"), &json!("w2:p1"), &Value::Null)
    );
}

#[test]
fn the_wikis_listed_hold_one_not_built_yet_while_queued_building_with_its_progress_or_failed() {
    let t = with_repos(ON);
    t.tick();
    half_way(&t, "2026-09-30T12:00:00Z");
    let building = t.get("/api/wikis");
    t.world.gone_panes.borrow_mut().push("w1:p1".into());
    t.world.advance(TICK);
    t.tick();

    let failed = t.get("/api/wikis");

    let shown = |id: &str, state: &str, pane: Value, why: Value, progress: Value| {
        json!({
            "id": id,
            "target": { "repo": id },
            "commit": null,
            "builtAt": null,
            "gaps": 0,
            "budget": 0,
            "calls": 48,
            "state": state,
            "pane": pane,
            "why": why,
            "progress": progress,
        })
    };
    let progress = half_way_progress("2026-09-30T12:00:00Z");
    assert_eq!(
        building,
        (
            200,
            json!([
                shown(
                    "acme/api",
                    "building",
                    json!("w1:p1"),
                    Value::Null,
                    progress
                ),
                shown("acme/web", "queued", Value::Null, Value::Null, Value::Null),
            ])
        )
    );
    let why = json!("its pane is gone without an outcome");
    assert_eq!(
        failed.1,
        json!([
            shown("acme/api", "failed", Value::Null, why, Value::Null),
            shown(
                "acme/web",
                "building",
                json!("w2:p1"),
                Value::Null,
                Value::Null
            ),
        ])
    );
}
