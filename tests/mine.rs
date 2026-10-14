//! The `mine` Switch: a Repo that takes only the issues assigned to the user.

mod common;

use common::{Setup, github_issue, linear_issue, pull_request, setup};
use nico_agent::world::{GitHubBlocker, GitHubIssue, IssueState, PullRequest};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// `config` as config.toml.
fn with_config(config: &str) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t
}

/// The Project `shop` defaulting `mine` on, `acme/api` taking it and
/// `acme/web` setting it off; `acme/cli`, in no Project, never told.
const SHOP: &str = r#"[projects.shop]
switches = { mine = true }

[repos."acme/api"]
path = "/src/api"
project = "shop"

[repos."acme/cli"]
path = "/src/cli"

[repos."acme/web"]
path = "/src/web"
project = "shop"
switches = { mine = false }
"#;

#[test]
fn mine_is_off_by_default_on_from_its_project_and_off_where_a_repo_sets_it() {
    let t = with_config(SHOP);
    t.tick();

    let shown = t.get("/api/status").1;

    let mine: Vec<_> = (shown["repos"].as_array().unwrap().iter())
        .map(|r| (r["slug"].clone(), r["switches"]["mine"].clone()))
        .collect();
    assert_eq!(
        mine,
        [
            (
                json!("acme/api"),
                json!({ "value": true, "from": "project" })
            ),
            (
                json!("acme/cli"),
                json!({ "value": false, "from": "default" })
            ),
            (json!("acme/web"), json!({ "value": false, "from": "repo" })),
        ]
    );
}

#[test]
fn patch_sets_mine_and_null_takes_the_project_s_again() {
    let t = with_config(SHOP);
    t.tick();

    let set = t.send("PATCH", "/api/repo/acme/cli/switches", r#"{"mine": true}"#);
    let undone = t.send("PATCH", "/api/repo/acme/web/switches", r#"{"mine": null}"#);

    assert_eq!(set.0, 200, "{}", set.1);
    assert_eq!(set.1["switches"]["mine"], true);
    assert_eq!(undone.1["switches"]["mine"], true);
    let config = std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap();
    assert_eq!(
        config,
        SHOP.replace(
            "path = \"/src/cli\"\n",
            "path = \"/src/cli\"\nswitches = { mine = true }\n"
        )
        .replace("switches = { mine = false }\n", "")
    );
    let shown = t.get("/api/status").1;
    assert_eq!(
        shown["repos"][2]["switches"]["mine"],
        json!({ "value": true, "from": "project" })
    );
}

/// Repo `acme/api`, reading Linear's team BLE too, set as `toml` sets it,
/// in the Project `shop` whose defaults `shop` sets: its GitHub issue #1 and
/// Linear BLE-1 unassigned, #2 and BLE-2 the user's.
fn in_shop(shop: &str, toml: &str) -> Setup {
    let t = with_config(&format!(
        "[projects.shop]\n{shop}\n\n[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"shop\"\nlinear = {{ team = \"BLE\" }}\nroom = 4\n{toml}\n"
    ));
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    t.world.add_issue(
        "acme/api",
        GitHubIssue {
            assignees: vec!["me".into()],
            ..github_issue("acme/api", 2)
        },
    );
    t.world.add_linear_issue(linear_issue("BLE-1"));
    let mut mine = linear_issue("BLE-2");
    mine.assignee = Some("linear-me".into());
    t.world.add_linear_issue(mine);
    t
}

/// [`in_shop`] with no Project defaults.
fn with_assigned(toml: &str) -> Setup {
    in_shop("", toml)
}

/// What a tick said, in order of the text.
fn sorted(mut said: Vec<String>) -> Vec<String> {
    said.sort();
    said
}

#[test]
fn with_mine_on_a_tick_dispatches_the_issues_assigned_to_the_user_and_leaves_the_unassigned() {
    // On as its Project's default.
    let t = in_shop("switches = { mine = true }", "");

    let said = t.tick();

    assert_eq!(sorted(said), ["BLE-2 dispatched", "acme/api#2 dispatched"]);
}

#[test]
fn with_mine_off_an_unassigned_issue_is_dispatched_as_one_assigned_to_the_user() {
    let t = with_assigned("");

    let said = t.tick();

    assert_eq!(
        sorted(said),
        [
            "BLE-1 dispatched",
            "BLE-2 dispatched",
            "acme/api#1 dispatched",
            "acme/api#2 dispatched",
        ]
    );
}

/// Repo `acme/api` with `mine` on and `switches`, holding `issues`.
fn with_mine(switches: &str, issues: Vec<GitHubIssue>) -> Setup {
    let t = with_config(&format!(
        "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = {{ mine = true{switches} }}\n"
    ));
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    for issue in issues {
        t.world.add_issue("acme/api", issue);
    }
    t
}

/// Issue `n` of `acme/api`, `labels` added, assigned to `assignees`.
fn issue(n: u64, labels: &[&str], assignees: &[&str]) -> GitHubIssue {
    let mut issue = github_issue("acme/api", n);
    issue.labels.extend(labels.iter().map(|l| l.to_string()));
    issue.assignees = assignees.iter().map(|a| a.to_string()).collect();
    issue
}

#[test]
fn with_mine_on_only_the_user_s_stackable_and_gardening_issues_are_dispatched() {
    // #2 and #3 sit on #1's open PR 11.
    let stacked = |n: u64, assignees: &[&str]| GitHubIssue {
        blockers: vec![GitHubBlocker {
            slug: "acme/api".into(),
            number: 1,
            title: "Issue 1".into(),
            state: IssueState::Open,
            closed_at: None,
        }],
        ..issue(n, &[], assignees)
    };
    let stacking = with_mine("", vec![stacked(2, &[]), stacked(3, &["me"])]);
    let on_pr = PullRequest {
        head_branch: Some("agent/api-1".into()),
        ..pull_request("acme/api", 11)
    };
    stacking.world.link_pr("acme/api", 1, on_pr);
    let gardening = with_mine(
        ", gardening = true",
        vec![
            issue(4, &["gardening"], &[]),
            issue(5, &["gardening"], &["me"]),
        ],
    );

    assert_eq!(stacking.tick(), ["acme/api#3 dispatched"]);
    assert_eq!(gardening.tick(), ["acme/api#5 dispatched"]);
}

#[test]
fn a_hand_dispatch_of_an_unassigned_issue_in_a_mine_repo_is_refused_with_how_to_take_it() {
    let t = with_assigned("switches = { mine = true }");

    let ran = t.cli(&["dispatch", "acme/api#1", "--json"]);

    assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
    assert_eq!(
        ran.json(),
        json!({
            "error": "acme/api#1 is not assigned to you, and acme/api takes only issues assigned to you",
            "help": ["Assign it to yourself, or turn `mine` off for acme/api"],
        })
    );
    assert_eq!(
        t.world.calls(),
        [
            "github viewer",
            "github issues acme/api",
            "linear viewer",
            "linear issues BLE"
        ]
    );
}

/// Each issue's key and assignees in `rows`, by key.
fn assignees(rows: &Value) -> BTreeMap<String, Value> {
    (rows.as_array().unwrap().iter())
        .map(|r| (r["key"].as_str().unwrap().into(), r["assignees"].clone()))
        .collect()
}

/// The node of `key` in a map.
fn node<'a>(map: &'a Value, key: &str) -> &'a Value {
    let nodes = map["nodes"].as_array().expect("nodes");
    (nodes.iter().find(|n| n["key"] == key)).unwrap_or_else(|| panic!("no node {key} in {map}"))
}

#[test]
fn status_and_the_map_name_each_issue_s_assignees_and_mark_the_user() {
    let t = with_assigned("switches = { dispatch = false }");
    t.world.add_issue("acme/api", issue(3, &[], &["colleague"]));
    let mut named = t.world.linear.borrow_mut();
    let ble_2 = named.iter_mut().find(|i| i.identifier == "BLE-2").unwrap();
    ble_2.assignee_name = Some("nico".into());
    let mut theirs = linear_issue("BLE-3");
    theirs.assignee = Some("user-ada".into());
    theirs.assignee_name = Some("ada".into());
    named.push(theirs);
    drop(named);
    t.tick();

    let status = t.get("/api/status").1;
    let (_, map) = t.get("/api/map/shop");

    let you = |name: &str| json!([{ "name": name, "you": true }]);
    assert_eq!(
        assignees(&status["repos"][0]["ready"]),
        BTreeMap::from([
            ("BLE-1".into(), json!([])),
            ("BLE-2".into(), you("nico")),
            ("acme/api#1".into(), json!([])),
            ("acme/api#2".into(), you("me")),
        ])
    );
    assert_eq!(assignees(&map["nodes"])["BLE-2"], you("nico"));
    assert_eq!(assignees(&map["nodes"])["acme/api#1"], json!([]));
    let colleague = node(&map, "acme/api#3");
    assert_eq!(
        (
            &colleague["stage"],
            &colleague["assignees"],
            &colleague["waits"]
        ),
        (
            &json!("Waiting"),
            &json!([{ "name": "colleague", "you": false }]),
            &json!("acme/api#3 is assigned to colleague"),
        )
    );
    assert_eq!(colleague["assignee_holds"], true);
    let ada = node(&map, "BLE-3");
    assert_eq!(
        (&ada["assignees"], &ada["waits"]),
        (
            &json!([{ "name": "ada", "you": false }]),
            &json!("BLE-3 is assigned to ada")
        )
    );
    assert_eq!(node(&map, "acme/api#1").get("assignee_holds"), None);
}

#[test]
fn in_a_mine_repo_the_map_shows_an_unassigned_issue_waiting_on_its_assignee_with_why() {
    let t = with_assigned("switches = { mine = true, dispatch = false }");
    t.tick();

    let (_, map) = t.get("/api/map/shop");

    let unassigned = node(&map, "acme/api#1");
    assert_eq!(unassigned["stage"], "Waiting");
    assert_eq!(
        unassigned["waits"],
        "acme/api#1 is not assigned to you, and acme/api takes only issues assigned to you"
    );
    assert_eq!(unassigned["assignee_holds"], true);
    assert_eq!(node(&map, "acme/api#2")["stage"], "Ready");
    assert_eq!(node(&map, "BLE-1")["stage"], "Waiting");
    assert_eq!(node(&map, "BLE-2")["stage"], "Ready");
}

/// The Repo `acme/api`'s kept read of its Sources, as written.
fn kept(t: &Setup) -> String {
    std::fs::read_to_string(t.config_dir.join("issues/acme/api.json")).unwrap()
}

#[test]
fn assign_to_me_assigns_an_issue_on_its_source_and_keeps_it_so_a_mine_repo_has_it_ready_at_once() {
    let t = with_assigned("switches = { mine = true, dispatch = false }");
    t.tick();
    t.world.calls.borrow_mut().clear();

    let github = t.send("POST", "/api/assign", r#"{"issue": "acme/api#1"}"#);
    let linear = t.send("POST", "/api/assign", r#"{"issue": "BLE-1"}"#);

    assert_eq!(github, (200, json!({ "assigned": "acme/api#1" })));
    assert_eq!(linear, (200, json!({ "assigned": "BLE-1" })));
    assert_eq!(
        t.world.calls(),
        ["github assign acme/api#1 @me", "linear assign BLE-1"]
    );
    let read: Value = serde_json::from_str(&kept(&t)).unwrap();
    let assigned = |key: &str| {
        let issues = read["issues"].as_array().unwrap();
        issues.iter().find(|i| i["key"] == key).unwrap()["assignees"].clone()
    };
    assert_eq!(assigned("acme/api#1"), json!(["me"]));
    assert_eq!(assigned("BLE-1"), json!(["linear-me"]));
    let ready = &t.get("/api/status").1["repos"][0]["ready"];
    assert_eq!(
        assignees(ready),
        BTreeMap::from([
            (
                "BLE-1".into(),
                json!([{ "name": "linear-me", "you": true }])
            ),
            (
                "BLE-2".into(),
                json!([{ "name": "linear-me", "you": true }])
            ),
            ("acme/api#1".into(), json!([{ "name": "me", "you": true }])),
            ("acme/api#2".into(), json!([{ "name": "me", "you": true }])),
        ])
    );
}

#[test]
fn a_failed_or_paused_assign_and_one_of_an_issue_someone_else_has_are_refused_changing_nothing() {
    let t = with_assigned("switches = { dispatch = false }");
    t.world.add_issue("acme/api", issue(3, &[], &["colleague"]));
    t.tick();
    let before = kept(&t);
    let limited = "GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z";
    t.world.fail_call("github assign", limited);
    t.world.calls.borrow_mut().clear();

    let failed = t.send("POST", "/api/assign", r#"{"issue": "acme/api#1"}"#);
    let paused = t.send("POST", "/api/assign", r#"{"issue": "acme/api#1"}"#);
    let theirs = t.send("POST", "/api/assign", r#"{"issue": "acme/api#3"}"#);
    let unknown = t.send("POST", "/api/assign", r#"{"issue": "acme/api#9"}"#);

    let again = "Assign it to yourself on GitHub or Linear, or try again once it answers";
    assert_eq!(
        failed,
        (
            409,
            json!({ "error": format!("could not assign acme/api#1 to you: {limited}"), "help": [again] })
        )
    );
    assert_eq!(
        paused,
        (
            409,
            json!({ "error": "could not assign acme/api#1 to you: GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z", "help": [again] })
        )
    );
    assert_eq!(
        theirs,
        (
            409,
            json!({
                "error": "acme/api#3 is assigned to colleague",
                "help": ["Take it from them on GitHub or Linear: nico-agent assigns you only an issue no one has"],
            })
        )
    );
    assert_eq!(
        unknown,
        (
            409,
            json!({
                "error": "acme/api#9 is in no Repo's last read of its Source",
                "help": ["Assign an issue the map shows, or Refresh to read the Sources again"],
            })
        )
    );
    assert_eq!(t.world.calls(), ["github assign acme/api#1 @me"]);
    assert_eq!(kept(&t), before);
}

#[test]
fn a_parent_issue_no_one_has_in_a_mine_repo_is_not_held_by_its_assignee_on_the_map() {
    let mut parent = issue(3, &[], &[]);
    parent.has_sub_issues = true;
    let t = with_mine(", dispatch = false", vec![parent]);
    t.tick();

    let (_, map) = t.get("/api/map/acme/api");

    let parent = node(&map, "acme/api#3");
    assert_eq!(parent["stage"], "Waiting");
    assert_eq!(parent.get("assignee_holds"), None);
    let refused = t.cli(&["dispatch", "acme/api#3", "--json"]).json();
    assert_eq!(
        refused["help"][0],
        "acme/api#3 is a parent issue; dispatch its sub-issues instead"
    );
}
