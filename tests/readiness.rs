mod common;

use common::{Setup, github_issue, linear_issue, setup};
use nico_agent::world::{
    GitHubBlocker, GitHubIssue, IssueState, LinearBlocker, LinearIssue, LinearProject, PrState,
    PullRequest,
};
use serde_json::{Value, json};
use std::time::Duration;

/// An open PR of `slug` from `head`.
fn pr(slug: &str, number: u64, head: &str) -> PullRequest {
    PullRequest {
        head_branch: Some(head.into()),
        ..common::pull_request(slug, number)
    }
}

fn blocker(slug: &str, number: u64, state: IssueState) -> GitHubBlocker {
    GitHubBlocker {
        slug: slug.into(),
        number,
        title: format!("Issue {number}"),
        state,
    }
}

fn with_repo() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.calls.borrow_mut().clear();
    t
}

fn status(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()
}

#[test]
fn ready_github_issues_are_listed_oldest_first_with_their_kind() {
    let t = with_repo();
    let mut newer = github_issue("acme/api", 3);
    newer.title = "Add retries".into();
    newer.created_at = "2026-09-20T08:00:00Z".into();
    let mut older = github_issue("acme/api", 9);
    older.labels.push("research".into());
    older.created_at = "2026-09-10T08:00:00Z".into();
    t.world.add_issue("acme/api", newer);
    t.world.add_issue("acme/api", older);

    let status = status(&t);

    assert_eq!(
        status["repos"][0]["ready"],
        json!([
            { "key": "acme/api#9", "title": "Issue 9", "url": "https://github.com/acme/api/issues/9", "kind": "research" },
            { "key": "acme/api#3", "title": "Add retries", "url": "https://github.com/acme/api/issues/3", "kind": "code" },
        ])
    );
    assert_eq!(status["repos"][0]["slug"], "acme/api");
    assert_eq!(status["repos"][0]["read_at"], "2026-09-30T12:00:00Z");
    assert_eq!(t.world.calls(), ["github viewer", "github issues acme/api"]);
    let cache: Value = serde_json::from_str(
        &std::fs::read_to_string(t.config_dir.join("issues/acme/api.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(cache["read_at"], "2026-09-30T12:00:00Z");
    assert_eq!(cache["issues"].as_array().unwrap().len(), 2);
}

fn keys(rows: &Value) -> Vec<&str> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|r| r["key"].as_str().unwrap())
        .collect()
}

#[test]
fn parents_issues_of_others_and_blocked_issues_are_not_ready() {
    let t = with_repo();
    let issue = |n: u64, change: &dyn Fn(&mut GitHubIssue)| {
        let mut issue = github_issue("acme/api", n);
        change(&mut issue);
        t.world.add_issue("acme/api", issue);
    };
    issue(1, &|_| {});
    issue(2, &|i| i.has_sub_issues = true);
    issue(3, &|i| i.assignees = vec!["colleague".into()]);
    issue(4, &|i| i.assignees = vec!["Me".into()]);
    issue(5, &|i| i.assignees = vec!["me".into(), "colleague".into()]);
    issue(6, &|i| {
        i.blockers = vec![blocker("acme/api", 1, IssueState::Closed)]
    });
    issue(7, &|i| {
        i.blockers = vec![blocker("acme/api", 1, IssueState::Open)]
    });
    issue(8, &|i| i.labels = vec!["needs-triage".into()]);

    let status = status(&t);

    assert_eq!(
        keys(&status["repos"][0]["ready"]),
        ["acme/api#1", "acme/api#4", "acme/api#6"]
    );
    assert_eq!(status["repos"][0]["stackable"], json!([]));
}

#[test]
fn an_issue_whose_blockers_have_one_open_pr_branch_here_is_stackable_on_it() {
    let t = with_repo();
    let blocked_by = |n: u64, blockers: Vec<GitHubBlocker>| {
        let mut issue = github_issue("acme/api", n);
        issue.blockers = blockers;
        t.world.add_issue("acme/api", issue);
    };
    let open = |slug: &str, n: u64| blocker(slug, n, IssueState::Open);
    // #6's PR closes it; #5's PR, stacked, is found by its Dispatch branch.
    t.world
        .link_pr("acme/api", 6, pr("acme/api", 16, "agent/api-6"));
    t.world.add_pr(pr("acme/api", 15, "agent/api-5"));
    t.world
        .link_pr("acme/other", 3, pr("acme/other", 13, "agent/other-3"));
    t.world
        .link_pr("acme/other", 4, pr("acme/api", 14, "fix-other-4"));
    let mut fork = pr("acme/api", 12, "agent/api-2");
    fork.head_branch = None;
    t.world.link_pr("acme/api", 2, fork);
    let mut merged = pr("acme/api", 11, "agent/api-1");
    merged.state = PrState::Merged;
    t.world.link_pr("acme/api", 1, merged);
    blocked_by(20, vec![open("acme/api", 6)]);
    blocked_by(
        21,
        vec![
            open("acme/api", 6),
            blocker("acme/api", 9, IssueState::Closed),
        ],
    );
    blocked_by(22, vec![open("acme/api", 5)]);
    blocked_by(23, vec![open("acme/api", 5), open("acme/api", 6)]);
    blocked_by(24, vec![open("acme/other", 3)]);
    blocked_by(25, vec![open("acme/other", 4)]);
    blocked_by(26, vec![open("acme/api", 2)]);
    blocked_by(27, vec![open("acme/api", 1)]);
    blocked_by(28, vec![open("acme/api", 6), open("acme/api", 7)]);

    let status = status(&t);

    let repo = &status["repos"][0];
    assert_eq!(repo["ready"], json!([]));
    assert_eq!(
        repo["stackable"],
        json!([
            { "key": "acme/api#20", "title": "Issue 20", "url": "https://github.com/acme/api/issues/20", "kind": "code", "base": "agent/api-6" },
            { "key": "acme/api#21", "title": "Issue 21", "url": "https://github.com/acme/api/issues/21", "kind": "code", "base": "agent/api-6" },
            { "key": "acme/api#22", "title": "Issue 22", "url": "https://github.com/acme/api/issues/22", "kind": "code", "base": "agent/api-5" },
            { "key": "acme/api#25", "title": "Issue 25", "url": "https://github.com/acme/api/issues/25", "kind": "code", "base": "fix-other-4" },
        ])
    );
    assert_eq!(
        repo["waiting"],
        json!([{
            "key": "acme/api#23", "title": "Issue 23", "url": "https://github.com/acme/api/issues/23", "kind": "code",
            "reason": "acme/api#23 waits for its Blockers' open PRs https://github.com/acme/api/pull/15, https://github.com/acme/api/pull/16 to merge down to one; they sit on different branches",
        }])
    );
    // Each unresolved Blocker is asked about once, however many issues it blocks.
    let linked = |key: &str| {
        t.world
            .calls()
            .iter()
            .filter(|c| *c == &format!("github linked prs {key}"))
            .count()
    };
    assert_eq!(linked("acme/api#6"), 1);
    assert_eq!(linked("acme/api#9"), 0);
}

#[test]
fn an_issue_with_a_live_dispatch_is_not_ready_and_one_closed_is() {
    let t = with_repo();
    for n in [1, 2, 3] {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    for n in ["acme/api#1", "acme/api#2"] {
        assert_eq!(t.cli(&["dispatch", n]).exit_code, 0);
    }
    // Closed, as a merged PR's Dispatch is.
    let file = t.config_dir.join("dispatches.json");
    let mut dispatches: Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    dispatches[1]["closed_at"] = json!("2026-09-30T12:00:00Z");
    std::fs::write(&file, dispatches.to_string()).unwrap();

    assert_eq!(
        keys(&status(&t)["repos"][0]["ready"]),
        ["acme/api#2", "acme/api#3"]
    );
}

#[test]
fn an_issue_whose_last_dispatch_merged_or_closed_unmerged_waits_till_dispatched_by_hand() {
    let t = with_repo();
    for n in [1, 2] {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    t.tick();
    t.world.add_pr(pr("acme/api", 11, "agent/api-1"));
    t.world.add_pr(pr("acme/api", 12, "agent/api-2"));
    t.world.advance(Duration::from_secs(600));
    t.tick();
    // Merged into a branch that is not the default, or without a closing
    // keyword; and closed by the user, rejected.
    t.world.prs.borrow_mut()[0].state = PrState::Merged;
    t.world.prs.borrow_mut()[1].state = PrState::Closed;
    t.world.advance(Duration::from_secs(600));

    let closed = t.tick();
    let status = status(&t);
    let by_hand = t.cli(&["dispatch", "acme/api#2", "--json"]);

    assert_eq!(
        closed,
        [
            "acme/api#1 Closed: its PR https://github.com/acme/api/pull/11 merged",
            "acme/api#2 Closed: its PR https://github.com/acme/api/pull/12 closed",
        ]
    );
    let repo = &status["repos"][0];
    assert_eq!(repo["ready"], json!([]));
    let reasons: Vec<&Value> = (repo["waiting"].as_array().unwrap().iter())
        .map(|row| &row["reason"])
        .collect();
    assert_eq!(
        reasons,
        [
            "acme/api#1 is still open though its PR https://github.com/acme/api/pull/11 merged; close it, or dispatch it by hand to work it again",
            "acme/api#2's PR https://github.com/acme/api/pull/12 was closed unmerged; dispatch it by hand to work it again",
        ]
    );
    assert_eq!(by_hand.exit_code, 0, "{}", by_hand.stdout);
    assert_eq!(by_hand.json()["dispatched"], "acme/api#2");
}

#[test]
fn a_failed_read_keeps_the_last_cache_and_says_why() {
    let t = with_repo();
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    status(&t);
    t.world.advance(Duration::from_secs(10 * 60));
    t.world
        .add_clone("/src/web", &["git@github.com:acme/web.git"]);
    t.cli(&["repo", "add", "acme/web", "--path", "/src/web"]);
    t.world
        .fail_call("github issues", "GitHub request failed; check your network");

    let status = status(&t);

    assert_eq!(
        status["repos"],
        json!([
            {
                "slug": "acme/api",
                "read_at": "2026-09-30T12:00:00Z",
                "error": "GitHub request failed; check your network",
                "ready": [{ "key": "acme/api#1", "title": "Issue 1", "url": "https://github.com/acme/api/issues/1", "kind": "code" }],
                "stackable": [],
                "waiting": [],
            },
            {
                "slug": "acme/web",
                "read_at": null,
                "error": "GitHub request failed; check your network",
                "ready": [],
                "stackable": [],
                "waiting": [],
            },
        ])
    );
}

#[test]
fn a_cache_younger_than_the_tick_is_reused_and_an_older_one_read_again() {
    let t = with_repo();
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    status(&t);
    t.world.add_issue("acme/api", github_issue("acme/api", 2));

    t.world.advance(Duration::from_secs(9 * 60 + 59));
    let cached = status(&t);
    assert_eq!(keys(&cached["repos"][0]["ready"]), ["acme/api#1"]);
    assert_eq!(cached["repos"][0]["read_at"], "2026-09-30T12:00:00Z");

    t.world.advance(Duration::from_secs(1));
    let read = status(&t);
    assert_eq!(
        keys(&read["repos"][0]["ready"]),
        ["acme/api#1", "acme/api#2"]
    );
    assert_eq!(read["repos"][0]["read_at"], "2026-09-30T12:10:00Z");
    let issue_reads = t
        .world
        .calls()
        .iter()
        .filter(|c| *c == "github issues acme/api")
        .count();
    assert_eq!(issue_reads, 2);
}

#[test]
fn linear_issues_the_selector_claims_are_ready_or_stackable_beside_github_ones() {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&[
        "repo",
        "add",
        "acme/api",
        "--path",
        "/src/api",
        "--linear-team",
        "BLE",
        "--linear-project",
        "Web",
        "--linear-label",
        "api",
    ]);
    t.world.calls.borrow_mut().clear();
    let claimed = |id: &str, day: u32, change: &dyn Fn(&mut LinearIssue)| {
        let mut issue = linear_issue(id);
        issue.created_at = format!("2026-09-{day:02}T00:00:00.000Z");
        issue.project = Some(LinearProject {
            id: "p-web".into(),
            name: "Web".into(),
        });
        issue.labels.push("api".into());
        change(&mut issue);
        t.world.add_linear_issue(issue);
    };
    let blocked_by = |id: &str, state: &str| LinearBlocker {
        identifier: id.into(),
        title: id.into(),
        state: state.into(),
    };
    claimed("BLE-1", 1, &|_| {});
    claimed("BLE-2", 2, &|i| i.project = None);
    claimed("BLE-3", 3, &|i| i.labels.retain(|l| l != "api"));
    claimed("BLE-4", 4, &|i| i.state = "started".into());
    claimed("BLE-5", 5, &|i| i.assignee = Some("someone-else".into()));
    claimed("BLE-6", 6, &|i| i.assignee = Some("linear-me".into()));
    claimed("BLE-7", 7, &|i| i.has_sub_issues = true);
    claimed("BLE-8", 8, &|i| {
        i.blockers = vec![blocked_by("BLE-30", "canceled")]
    });
    claimed("BLE-9", 9, &|i| {
        i.blockers = vec![blocked_by("BLE-1", "unstarted")];
        i.labels.push("research".into());
    });
    claimed("BLE-10", 10, &|i| {
        i.blockers = vec![blocked_by("BLE-31", "started")]
    });
    t.world.linear_attachments.borrow_mut().insert(
        "BLE-1".into(),
        vec![
            "https://github.com/acme/web/pull/3".into(),
            "https://github.com/acme/api/pull/21".into(),
        ],
    );
    t.world.add_pr(pr("acme/api", 21, "nico/ble-1"));
    let mut github = github_issue("acme/api", 4);
    github.created_at = "2026-09-07T12:00:00Z".into();
    t.world.add_issue("acme/api", github);

    let status = status(&t);

    let repo = &status["repos"][0];
    assert_eq!(
        keys(&repo["ready"]),
        ["BLE-1", "BLE-6", "acme/api#4", "BLE-8"]
    );
    assert_eq!(
        repo["stackable"],
        json!([{
            "key": "BLE-9", "title": "BLE-9", "url": "https://linear.app/bleentr/issue/BLE-9/title",
            "kind": "research", "base": "nico/ble-1",
        }])
    );
    assert_eq!(
        t.world.calls(),
        [
            "github viewer",
            "github issues acme/api",
            "linear viewer",
            "linear issues BLE",
            "linear attachments BLE-1",
            "github pr acme/api#21",
            "linear attachments BLE-31",
        ]
    );
}
