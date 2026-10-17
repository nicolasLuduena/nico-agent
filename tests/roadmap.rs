mod common;

use std::time::Duration;

use common::{Setup, github_issue, linear_issue, setup};
use nico_agent::world::{GitHubBlocker, GitHubIssue, IssueState, LinearBlocker};
use serde_json::{Value, json};

/// Repo `acme/api`, dispatch off, `serve` listening on its first read.
fn read(issues: Vec<GitHubIssue>) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { dispatch = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    for issue in issues {
        t.world.add_issue("acme/api", issue);
    }
    t.tick();
    t
}

/// The issue `number` of `acme/api` with `labels`.
fn labelled(number: u64, labels: &[&str]) -> GitHubIssue {
    GitHubIssue {
        labels: labels.iter().map(|l| l.to_string()).collect(),
        ..github_issue("acme/api", number)
    }
}

fn blocked_by(issue: GitHubIssue, numbers: &[u64]) -> GitHubIssue {
    let blockers = (numbers.iter())
        .map(|&number| GitHubBlocker {
            slug: "acme/api".into(),
            number,
            title: format!("Issue {number}"),
            state: IssueState::Open,
            closed_at: None,
        })
        .collect();
    GitHubIssue { blockers, ..issue }
}

fn link(number: u64) -> Value {
    json!({
        "key": format!("acme/api#{number}"),
        "title": format!("Issue {number}"),
        "url": format!("https://github.com/acme/api/issues/{number}"),
    })
}

#[test]
fn the_roadmap_lays_each_not_ready_open_issue_in_its_labels_lane_with_blocker_edges() {
    let t = read(vec![
        // Ready: on the map, not here, but #4 blocks it.
        blocked_by(labelled(1, &["ready-for-agent"]), &[4]),
        GitHubIssue {
            body: "## Why\n\nBecause.".into(),
            assignees: vec!["me".into(), "ana".into()],
            ..labelled(2, &["needs-triage", "bug"])
        },
        // The first lane that matches.
        labelled(3, &["needs-info", "needs-triage"]),
        labelled(4, &["bug"]),
        blocked_by(labelled(5, &["wontfix"]), &[2]),
        GitHubIssue {
            state: IssueState::Closed,
            ..labelled(6, &["needs-triage"])
        },
    ]);
    t.world.calls.borrow_mut().clear();

    let (status, roadmap) = t.get("/api/roadmap/acme/api");

    assert_eq!(status, 200, "{roadmap}");
    assert_eq!(
        roadmap["lanes"],
        json!(["needs-triage", "wontfix", "no label"])
    );
    let node = |number: u64, lane: &str, labels: &[&str]| {
        json!({
            "key": format!("acme/api#{number}"),
            "repo": "acme/api",
            "title": format!("Issue {number}"),
            "url": format!("https://github.com/acme/api/issues/{number}"),
            "lane": lane,
            "labels": labels,
            "assignees": [],
            "body": "",
            "blocked_by": [],
            "blocks": [],
        })
    };
    let mut second = node(2, "needs-triage", &["needs-triage", "bug"]);
    second["body"] = json!("## Why\n\nBecause.");
    second["assignees"] = json!([{ "name": "me", "you": true }, { "name": "ana", "you": false }]);
    second["blocks"] = json!([link(5)]);
    let mut fourth = node(4, "no label", &["bug"]);
    fourth["blocks"] = json!([link(1)]);
    let mut fifth = node(5, "wontfix", &["wontfix"]);
    fifth["blocked_by"] = json!([link(2)]);
    assert_eq!(
        roadmap["nodes"],
        json!([
            second,
            node(3, "needs-triage", &["needs-info", "needs-triage"]),
            fourth,
            fifth
        ])
    );
    assert_eq!(
        roadmap["edges"],
        json!([{ "from": "acme/api#2", "to": "acme/api#5", "kind": "blocker" }])
    );
    assert_eq!(t.world.calls(), Vec::<String>::new());
}

fn keys(roadmap: &Value) -> Vec<&str> {
    let nodes = roadmap["nodes"].as_array().expect("nodes");
    nodes.iter().map(|n| n["key"].as_str().unwrap()).collect()
}

#[test]
fn with_github_unreachable_the_roadmap_shows_what_was_read_last() {
    let t = read(vec![labelled(2, &["needs-triage"])]);
    t.world.add_issue("acme/api", labelled(3, &["needs-info"]));
    t.world
        .fail_call("github open issues", "HTTP 502: Bad Gateway");
    t.world.advance(Duration::from_secs(600));
    t.tick();

    let (status, roadmap) = t.get("/api/roadmap/acme/api");

    assert_eq!(status, 200, "{roadmap}");
    assert_eq!(keys(&roadmap), ["acme/api#2"]);
    let calls = t.world.calls();
    assert_eq!(
        (calls.iter().filter(|c| c.starts_with("github open issues"))).count(),
        2,
        "{calls:?}"
    );
}

#[test]
fn a_projects_roadmap_holds_each_repos_issues_and_its_linear_teams_and_blockers_across_them() {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"shop\"\nswitches = { dispatch = false }\n\n[repos.\"acme/web\"]\npath = \"/src/web\"\nproject = \"shop\"\nlinear = { team = \"BLE\" }\nswitches = { dispatch = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    // #2 is blocked by acme/web#3, as GitHub cases it.
    let mut blocked = labelled(2, &["needs-triage"]);
    blocked.blockers = vec![GitHubBlocker {
        slug: "Acme/Web".into(),
        number: 3,
        title: "Issue 3".into(),
        state: IssueState::Open,
        closed_at: None,
    }];
    t.world.add_issue("acme/api", blocked);
    t.world.add_issue(
        "acme/web",
        GitHubIssue {
            labels: vec!["ready-for-human".into()],
            ..github_issue("acme/web", 3)
        },
    );
    let mut started = linear_issue("BLE-1");
    started.labels = vec![];
    started.state = "started".into();
    started.description = "Started by hand.".into();
    started.assignee = Some("linear-me".into());
    started.assignee_name = Some("Nico".into());
    started.blockers = vec![LinearBlocker {
        identifier: "BLE-9".into(),
        title: "Elsewhere".into(),
        state: "unstarted".into(),
        closed_at: None,
    }];
    t.world.add_linear_issue(started);
    let mut done = linear_issue("BLE-2");
    done.state = "completed".into();
    t.world.add_linear_issue(done);
    t.tick();
    t.world.calls.borrow_mut().clear();

    let (status, roadmap) = t.get("/api/roadmap/shop");

    assert_eq!(status, 200, "{roadmap}");
    assert_eq!(
        roadmap["lanes"],
        json!(["needs-triage", "ready-for-human", "no label"])
    );
    assert_eq!(keys(&roadmap), ["acme/api#2", "acme/web#3", "BLE-1"]);
    let nodes = roadmap["nodes"].as_array().unwrap();
    assert_eq!(nodes[1]["repo"], "acme/web");
    assert_eq!(nodes[1]["blocks"], json!([link(2)]));
    assert_eq!(
        nodes[2],
        json!({
            "key": "BLE-1",
            "repo": "acme/web",
            "title": "BLE-1",
            "url": "https://linear.app/bleentr/issue/BLE-1/title",
            "lane": "no label",
            "labels": [],
            "assignees": [{ "name": "Nico", "you": true }],
            "body": "Started by hand.",
            "blocked_by": [{ "key": "BLE-9", "title": "Elsewhere", "url": null }],
            "blocks": [],
        })
    );
    assert_eq!(
        roadmap["edges"],
        json!([{ "from": "acme/web#3", "to": "acme/api#2", "kind": "blocker" }])
    );
    assert_eq!(t.world.calls(), Vec::<String>::new());
}

#[test]
fn the_roadmap_of_no_project_is_not_found() {
    let t = read(vec![]);

    let (status, answer) = t.get("/api/roadmap/nope");

    assert_eq!(status, 404);
    assert_eq!(answer["error"], "nope is not a Project");
}
