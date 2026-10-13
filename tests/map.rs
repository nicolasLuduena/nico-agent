mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{GitHubBlocker, IssueState, PrState, PullRequest};
use serde_json::{Value, json};

/// Repo `acme/api` with `switches`, its issues `numbers` labelled
/// `ready-for-agent`, one created each day from 2026-09-01; no calls recorded yet.
fn with_issues(switches: &str, numbers: &[u64]) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config =
        format!("[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = {{ {switches} }}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    for (day, &n) in numbers.iter().enumerate() {
        let created_at = format!("2026-09-{:02}T00:00:00Z", day + 1);
        let issue = nico_agent::world::GitHubIssue {
            created_at,
            ..github_issue("acme/api", n)
        };
        t.world.add_issue("acme/api", issue);
    }
    t
}

/// `issue` of `acme/api` blocked by the open issues `blockers` of `acme/api`,
/// each titled `Blocker <N>` as GitHub gives a Blocker.
fn block(t: &Setup, issue: u64, blockers: &[u64]) {
    let mut issues = t.world.issues.borrow_mut();
    let issues = issues.get_mut("acme/api").unwrap();
    let blocked = issues.iter_mut().find(|i| i.number == issue).unwrap();
    blocked.blockers = (blockers.iter())
        .map(|&number| GitHubBlocker {
            slug: "acme/api".into(),
            number,
            title: format!("Blocker {number}"),
            state: IssueState::Open,
            closed_at: None,
        })
        .collect();
}

/// The node of `key` in a map.
fn node<'a>(map: &'a Value, key: &str) -> &'a Value {
    let nodes = map["nodes"].as_array().expect("nodes");
    (nodes.iter().find(|n| n["key"] == key)).unwrap_or_else(|| panic!("no node {key} in {map}"))
}

fn keys(map: &Value) -> Vec<&str> {
    let nodes = map["nodes"].as_array().expect("nodes");
    nodes.iter().map(|n| n["key"].as_str().unwrap()).collect()
}

#[test]
fn a_blocked_ready_for_agent_issue_is_a_node_with_a_blocker_edge_from_each_open_blocker_titled() {
    // #5 is open but not labelled: not the loop's, only a Blocker.
    let t = with_issues("dispatch = false", &[1, 2]);
    block(&t, 2, &[1, 5]);
    t.tick();

    let (status, map) = t.get("/api/map/acme/api");

    assert_eq!(status, 200, "{map}");
    assert_eq!(keys(&map), ["acme/api#1", "acme/api#2", "acme/api#5"]);
    assert_eq!(
        node(&map, "acme/api#1"),
        &json!({
            "key": "acme/api#1",
            "repo": "acme/api",
            "title": "Issue 1",
            "url": "https://github.com/acme/api/issues/1",
            "kind": "code",
            "stage": "Ready",
            "agent_state": null,
            "pr": null,
            "review": null,
            "verdict": null,
            "restarts": 0,
            "created_at": "2026-09-01T00:00:00Z",
            "merged_at": null,
        })
    );
    assert_eq!(node(&map, "acme/api#2")["stage"], "Waiting");
    assert_eq!(
        node(&map, "acme/api#5"),
        &json!({
            "key": "acme/api#5",
            "repo": "acme/api",
            "title": "Blocker 5",
            "url": "https://github.com/acme/api/issues/5",
            "kind": "code",
            "stage": null,
            "agent_state": null,
            "pr": null,
            "review": null,
            "verdict": null,
            "restarts": 0,
            "created_at": null,
            "merged_at": null,
        })
    );
    assert_eq!(
        map["edges"],
        json!([
            { "from": "acme/api#1", "to": "acme/api#2", "kind": "blocker" },
            { "from": "acme/api#5", "to": "acme/api#2", "kind": "blocker" },
        ])
    );
}

#[test]
fn a_stacked_dispatch_has_a_stack_edge_to_the_pr_it_targets_and_no_blocker_edge_for_it() {
    // #2 is blocked by #1, worked outside the loop, with open PR 11 on agent/api-1.
    let t = with_issues("", &[2, 3]);
    block(&t, 2, &[1]);
    let pr = PullRequest {
        head_branch: Some("agent/api-1".into()),
        ..pull_request("acme/api", 11)
    };
    t.world.link_pr("acme/api", 1, pr);
    t.tick();
    // The next tick asks GitHub about the PR #2 sits on.
    t.world.advance(Duration::from_secs(600));
    t.tick();
    t.world.calls.borrow_mut().clear();

    let (status, map) = t.get("/api/map/acme/api");

    assert_eq!(status, 200, "{map}");
    assert_eq!(keys(&map), ["acme/api#1", "acme/api#2", "acme/api#3"]);
    assert_eq!(
        map["edges"],
        json!([{ "from": "acme/api#2", "to": "acme/api#1", "kind": "stack" }])
    );
    let stacked = node(&map, "acme/api#2");
    assert_eq!(stacked["stage"], "Implementing");
    assert_eq!(
        stacked["agent_state"],
        json!({ "implementer": "working", "reviewer": null })
    );
    assert_eq!(stacked["created_at"], "2026-09-01T00:00:00Z");
    assert_eq!(
        node(&map, "acme/api#1")["pr"],
        json!({ "url": "https://github.com/acme/api/pull/11", "draft": true })
    );
    // From the state files and herdr: GitHub is not asked.
    assert_eq!(t.world.calls(), ["herdr agent list"]);
}

/// GitHub merges PR `n` of `acme/api`, closing the issue it fixes, and a tick sees it.
fn merge(t: &Setup, n: u64, issue: u64) {
    {
        let mut prs = t.world.prs.borrow_mut();
        prs.iter_mut().find(|pr| pr.number == n).unwrap().state = PrState::Merged;
        let mut issues = t.world.issues.borrow_mut();
        let issues = issues.get_mut("acme/api").unwrap();
        issues.iter_mut().find(|i| i.number == issue).unwrap().state = IssueState::Closed;
    }
    t.world.advance(Duration::from_secs(600));
    t.tick();
}

#[test]
fn an_issue_merged_6_days_ago_is_a_node_with_its_merged_time_and_one_merged_8_days_ago_is_not() {
    let t = with_issues("", &[7, 8]);
    t.tick();
    for (n, issue) in [(9, 7), (10, 8)] {
        t.world.add_pr(PullRequest {
            head_branch: Some(format!("agent/api-{issue}")),
            ..pull_request("acme/api", n)
        });
    }
    t.world.advance(Duration::from_secs(600));
    t.tick();
    // At 2026-09-30T12:20:00Z.
    merge(&t, 10, 8);
    t.world.advance(Duration::from_secs(2 * 86_400 - 600));
    // At 2026-10-02T12:20:00Z.
    merge(&t, 9, 7);
    t.world.advance(Duration::from_secs(6 * 86_400));

    let (_, map) = t.get("/api/map/acme/api");

    assert_eq!(keys(&map), ["acme/api#7"]);
    let merged = node(&map, "acme/api#7");
    assert_eq!(merged["stage"], "Merged");
    assert_eq!(merged["merged_at"], "2026-10-02T12:20:00Z");
    assert_eq!(merged["agent_state"], json!(null));
    assert_eq!(merged["pr"]["url"], "https://github.com/acme/api/pull/9");
}

#[test]
fn the_map_answers_in_full_from_local_state_while_github_is_paused_and_404_for_no_project() {
    let t = with_issues("dispatch = false", &[1, 2]);
    block(&t, 2, &[1]);
    t.tick();
    let (_, before) = t.get("/api/map/acme/api");
    let limited = "GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z";
    t.world.fail_call("github", limited);
    t.world.advance(Duration::from_secs(600));
    t.tick();
    t.world.calls.borrow_mut().clear();

    let paused = t.get("/api/map/acme%2Fapi");
    let unknown = t.get("/api/map/acme/web");

    assert_eq!(paused, (200, before));
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(
        unknown,
        (
            404,
            json!({
                "error": "acme/web is not a Project",
                "help": ["Ask for a Project /api/status lists"],
            })
        )
    );
}

#[test]
fn a_node_is_its_dispatch_with_restarts_its_verdict_s_findings_and_every_bucket_file_of_the_issue()
{
    let t = with_issues("", &[7]);
    t.tick();
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.world.advance(Duration::from_secs(600));
    t.tick();
    t.world
        .add_file("/worktrees/api-7/.evidence/7/sign in.png", b"png");
    let findings = t.config_dir.with_file_name("f.md");
    std::fs::write(&findings, "The search box is gone.\n").unwrap();
    let findings = findings.display().to_string();
    let ran = t.cli(&[
        "verdict",
        "acme/api#7",
        "fail",
        "--sha",
        "sha9",
        "--findings",
        &findings,
    ]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    // The tick restarts the Implementer with the findings, then GitHub pauses.
    t.world.advance(Duration::from_secs(600));
    t.tick();
    let limited = "GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z";
    t.world.fail_call("github", limited);
    t.world.advance(Duration::from_secs(600));
    t.tick();
    t.world.calls.borrow_mut().clear();

    let (status, node) = t.get("/api/node/acme%2Fapi%237");
    let unknown = t.get("/api/node/acme/api%2399");

    assert_eq!(status, 200, "{node}");
    assert_eq!(node["issue"], "acme/api#7");
    assert_eq!(node["stage"], "PR draft");
    assert_eq!(
        node["restarts"],
        json!([{ "at": "2026-09-30T12:20:00Z", "reason": "verdict", "by": "loop" }])
    );
    assert_eq!(
        node["verdict"],
        json!({
            "result": "fail",
            "sha": "sha9",
            "at": "2026-09-30T12:10:00Z",
            "findings": "The search box is gone.\n",
        })
    );
    assert_eq!(node["evidence_folder"], "/bucket/acme/api/7/");
    assert_eq!(
        node["evidence"],
        json!([
            { "path": "sha9/findings.md", "url": "/bucket/acme/api/7/sha9/findings.md" },
            { "path": "sha9/sign in.png", "url": "/bucket/acme/api/7/sha9/sign%20in.png" },
        ])
    );
    assert_eq!(
        t.world.calls(),
        [
            "herdr agent list",
            "find /mnt/agents-land/nico-agent-bucket/acme/api/7 -name .git -prune -o -type f -print",
        ]
    );
    assert_eq!(
        unknown,
        (
            404,
            json!({
                "error": "acme/api#99 has no Dispatch",
                "help": ["Ask for an issue /api/status lists among its dispatches"],
            })
        )
    );
}

#[test]
fn a_project_s_map_holds_every_repo_s_nodes_each_naming_its_repo_with_blocker_edges_across_them() {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let off = "switches = { dispatch = false }";
    let config = format!(
        "[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"acme shop\"\n{off}\n\n\
         [repos.\"acme/web\"]\npath = \"/src/web\"\nproject = \"acme shop\"\n{off}\n\n\
         [repos.\"acme/cli\"]\npath = \"/src/cli\"\n{off}\n"
    );
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    t.world.add_issue("acme/cli", github_issue("acme/cli", 4));
    // Blocked by acme/api#1 in its Project, as GitHub cases its slug, acme/cli#4 in another
    // Project, other/lib#9 in none.
    let blocker = |slug: &str, number| GitHubBlocker {
        slug: slug.into(),
        number,
        title: format!("Blocker {number}"),
        state: IssueState::Open,
        closed_at: None,
    };
    t.world.add_issue(
        "acme/web",
        nico_agent::world::GitHubIssue {
            blockers: vec![
                blocker("Acme/API", 1),
                blocker("acme/cli", 4),
                blocker("other/lib", 9),
            ],
            ..github_issue("acme/web", 3)
        },
    );
    t.tick();

    let (status, map) = t.get("/api/map/acme%20shop");
    let in_shop = t.get("/api/map/acme/api");
    let (_, own) = t.get("/api/map/acme/cli");

    assert_eq!(status, 200, "{map}");
    assert_eq!(
        keys(&map),
        ["acme/api#1", "acme/cli#4", "acme/web#3", "other/lib#9"]
    );
    let shown = |key: &str| {
        let n = node(&map, key);
        (n["stage"].clone(), n["repo"].clone())
    };
    assert_eq!(shown("acme/api#1"), (json!("Ready"), json!("acme/api")));
    assert_eq!(shown("acme/web#3"), (json!("Waiting"), json!("acme/web")));
    // Outside the Project, a Blocker is a link node with no Stage, configured or not.
    assert_eq!(
        node(&map, "acme/cli#4"),
        &json!({
            "key": "acme/cli#4",
            "repo": null,
            "title": "Blocker 4",
            "url": "https://github.com/acme/cli/issues/4",
            "kind": "code",
            "stage": null,
            "agent_state": null,
            "pr": null,
            "review": null,
            "verdict": null,
            "restarts": 0,
            "created_at": null,
            "merged_at": null,
        })
    );
    assert_eq!(shown("other/lib#9"), (json!(null), json!(null)));
    assert_eq!(
        map["edges"],
        json!([
            { "from": "acme/api#1", "to": "acme/web#3", "kind": "blocker" },
            { "from": "acme/cli#4", "to": "acme/web#3", "kind": "blocker" },
            { "from": "other/lib#9", "to": "acme/web#3", "kind": "blocker" },
        ])
    );
    // A Repo in a Project has no map of its own; one without is its own Project.
    assert_eq!(
        in_shop,
        (
            404,
            json!({
                "error": "acme/api is not a Project",
                "help": ["Ask for a Project /api/status lists"],
            })
        )
    );
    assert_eq!(keys(&own), ["acme/cli#4"]);
    assert_eq!(node(&own, "acme/cli#4")["repo"], "acme/cli");
    assert_eq!(node(&own, "acme/cli#4")["stage"], "Ready");
}

#[test]
fn a_node_waiting_on_a_blocker_in_another_repo_says_why_with_an_edge_from_it_till_it_is_installed()
{
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"acme shop\"\nlinear = { team = \"BLE\" }\nswitches = { dispatch = false }\n\n\
                  [repos.\"acme/web\"]\npath = \"/src/web\"\nproject = \"acme shop\"\nlinear = { team = \"WEB\" }\ninstall = \"make install\"\nswitches = { dispatch = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue(
        "acme/api",
        nico_agent::world::GitHubIssue {
            blockers: vec![GitHubBlocker {
                slug: "acme/web".into(),
                number: 1,
                title: "Blocker 1".into(),
                state: IssueState::Closed,
                closed_at: Some("2026-09-30T11:00:00Z".into()),
            }],
            ..github_issue("acme/api", 3)
        },
    );
    let mut linear = common::linear_issue("BLE-2");
    linear.blockers = vec![nico_agent::world::LinearBlocker {
        identifier: "WEB-5".into(),
        title: "Blocker WEB-5".into(),
        state: "completed".into(),
        closed_at: Some("2026-09-30T11:00:00.000Z".into()),
    }];
    t.world.add_linear_issue(linear);
    t.tick();

    let (status, map) = t.get("/api/map/acme%20shop");

    assert_eq!(status, 200, "{map}");
    let shown = |key: &str| {
        let n = node(&map, key);
        (
            n["stage"].clone(),
            n["repo"].clone(),
            n.get("waits").cloned(),
        )
    };
    assert_eq!(
        shown("acme/api#3"),
        (
            json!("Waiting"),
            json!("acme/api"),
            Some(json!(
                "acme/api#3 waits on acme/web#1 to be installed in acme/web"
            ))
        )
    );
    assert_eq!(
        shown("BLE-2"),
        (
            json!("Waiting"),
            json!("acme/api"),
            Some(json!("BLE-2 waits on WEB-5 to be installed in acme/web"))
        )
    );
    assert_eq!(shown("acme/web#1"), (json!(null), json!("acme/web"), None));
    assert_eq!(shown("WEB-5"), (json!(null), json!("acme/web"), None));
    assert_eq!(
        map["edges"],
        json!([
            { "from": "acme/web#1", "to": "acme/api#3", "kind": "blocker" },
            { "from": "WEB-5", "to": "BLE-2", "kind": "blocker" },
        ])
    );

    assert_eq!(t.cli(&["install", "acme/web"]).exit_code, 0);
    let (_, map) = t.get("/api/map/acme%20shop");

    assert_eq!(keys(&map), ["BLE-2", "acme/api#3"]);
    assert_eq!(node(&map, "acme/api#3")["stage"], "Ready");
    assert_eq!(node(&map, "acme/api#3").get("waits"), None);
    assert_eq!(map["edges"], json!([]));
}
