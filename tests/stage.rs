mod common;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{Mergeable, PrState, PullRequest, PullRequestActivity};
use nico_agent::{dispatch, stage};
use serde_json::{Value, json};
use std::time::Duration;

/// Repo `acme/api` with issue 7 dispatched, and no calls recorded yet.
fn dispatched() -> Setup {
    dispatched_all(&[7])
}

/// Repo `acme/api` with each of `issues` dispatched in turn, and no calls recorded yet.
fn dispatched_all(issues: &[u64]) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    for &n in issues {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    for n in issues {
        let ran = t.cli(&["dispatch", &format!("acme/api#{n}"), "--json"]);
        assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    }
    t.world.calls.borrow_mut().clear();
    t
}

/// PR `n` of `acme/api` from `head`, in `state`.
fn pr(n: u64, head: &str, state: PrState) -> PullRequest {
    PullRequest {
        head_branch: Some(head.into()),
        state,
        ..pull_request("acme/api", n)
    }
}

/// The tick's PR watch, as `serve` will run it.
fn watch(t: &Setup) {
    stage::watch(&t.ctx()).unwrap();
}

fn status(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()
}

fn calls_after(t: &Setup, run: impl FnOnce()) -> Vec<String> {
    t.world.calls.borrow_mut().clear();
    run();
    t.world.calls()
}

#[test]
fn a_pr_is_found_on_the_dispatch_branch_once_and_then_watched_by_number() {
    let t = dispatched();
    // A closed PR left on the branch by an earlier Dispatch is not this one's.
    t.world.add_pr(pr(5, "agent/api-7", PrState::Closed));

    let before = calls_after(&t, || watch(&t));
    let shown_before = status(&t)["dispatches"][0].clone();
    t.world.add_pr(pr(9, "agent/api-7", PrState::Open));
    let found = calls_after(&t, || watch(&t));
    let watched = calls_after(&t, || watch(&t));

    assert_eq!(before, ["github branch prs acme/api:agent/api-7"]);
    assert_eq!(shown_before["stage"], "Implementing");
    assert_eq!(shown_before["pr"], Value::Null);
    assert_eq!(
        found,
        [
            "github branch prs acme/api:agent/api-7",
            "github pr activity acme/api#9",
        ]
    );
    assert_eq!(watched, ["github pr activity acme/api#9"]);
    let shown = &status(&t)["dispatches"][0];
    assert_eq!(shown["stage"], "PR draft");
    assert_eq!(
        shown["pr"],
        json!({
            "url": "https://github.com/acme/api/pull/9",
            "repo": "acme/api",
            "number": 9,
            "state": "open",
            "draft": true,
            "head_sha": "sha9",
            "base": "main",
            "mergeable": "mergeable",
            "updated_at": "2026-09-30T12:00:00Z",
            "final": false,
        })
    );
}

/// Set what GitHub says of PR `n` of `acme/api`.
fn set_state(t: &Setup, n: u64, state: PrState) {
    let mut prs = t.world.prs.borrow_mut();
    prs.iter_mut().find(|pr| pr.number == n).unwrap().state = state;
}

#[test]
fn a_merged_or_closed_pr_is_final_and_never_asked_about_again() {
    let t = dispatched_all(&[7, 8, 6]);
    t.world.add_pr(pr(9, "agent/api-7", PrState::Open));
    t.world.add_pr(pr(10, "agent/api-8", PrState::Open));
    t.world.add_pr(pr(11, "agent/api-6", PrState::Open));
    watch(&t);
    set_state(&t, 10, PrState::Merged);
    set_state(&t, 11, PrState::Closed);

    let mut first = calls_after(&t, || watch(&t));
    let second = calls_after(&t, || watch(&t));

    first.sort();
    let asked = [10, 11, 9].map(|n| format!("github pr activity acme/api#{n}"));
    assert_eq!(first, asked);
    assert_eq!(second, asked[2..]);
    let file = std::fs::read_to_string(t.config_dir.join("prs.json")).unwrap();
    let prs: Value = serde_json::from_str(&file).unwrap();
    let finals =
        [9, 10, 11].map(|n| prs[format!("https://github.com/acme/api/pull/{n}")]["final"].clone());
    assert_eq!(finals, [json!(false), json!(true), json!(true)]);
}

#[test]
fn the_stage_is_derived_from_the_pr_as_last_seen_and_a_failed_step() {
    let t = dispatched_all(&[1, 2, 3, 4, 5]);
    t.world.add_issue("acme/api", github_issue("acme/api", 6));
    // The Source is read again, with issue 6.
    t.world.advance(Duration::from_secs(600));
    t.world.fail_call("herdr agent start", "it broke");
    assert_eq!(t.cli(&["dispatch", "acme/api#6"]).exit_code, 1);
    for (n, issue) in [(12, 2), (13, 3), (14, 4), (15, 5), (16, 6)] {
        t.world
            .add_pr(pr(n, &format!("agent/api-{issue}"), PrState::Open));
    }
    // Flipped to ready by hand, with no Verdict.
    t.world.activity.borrow_mut().insert(
        "acme/api#13".into(),
        PullRequestActivity {
            state: PrState::Open,
            draft: false,
            head_sha: "sha13".into(),
            base_branch: "main".into(),
            mergeable: Mergeable::Mergeable,
            updated_at: "2026-09-30T12:00:00Z".into(),
        },
    );
    watch(&t);
    set_state(&t, 14, PrState::Merged);
    set_state(&t, 15, PrState::Closed);
    watch(&t);

    let status = status(&t);
    let shown: Vec<(&str, &str, Value)> = (status["dispatches"].as_array().unwrap().iter())
        .map(|d| {
            let (issue, stage) = (d["issue"].as_str().unwrap(), d["stage"].as_str().unwrap());
            (issue, stage, d["pr"]["draft"].clone())
        })
        .collect();
    assert_eq!(
        shown,
        [
            ("acme/api#1", "Implementing", Value::Null),
            ("acme/api#2", "PR draft", json!(true)),
            ("acme/api#3", "PR draft", json!(false)),
            ("acme/api#4", "Merged", json!(true)),
            ("acme/api#5", "Closed", json!(true)),
            ("acme/api#6", "Failed", json!(true)),
        ]
    );
}

/// The tick's Close, as `serve` will run it.
fn close(t: &Setup) {
    dispatch::close_finished(&t.ctx()).unwrap();
}

#[test]
fn a_dispatch_whose_pr_is_final_is_closed_freeing_its_worktree_and_workspace_and_kept() {
    let t = dispatched_all(&[7, 8]);
    t.world.add_pr(pr(9, "agent/api-7", PrState::Open));
    t.world.add_pr(pr(10, "agent/api-8", PrState::Open));
    watch(&t);
    set_state(&t, 9, PrState::Merged);
    watch(&t);
    t.world.advance(Duration::from_secs(60));

    let closed = calls_after(&t, || close(&t));
    let again = calls_after(&t, || close(&t));

    // The branch and the PR stay: nothing else is called.
    assert_eq!(
        closed,
        [
            "herdr worktree remove --workspace w1",
            "herdr workspace close w1"
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    let status = status(&t);
    let [merged, open] = [0, 1].map(|i| status["dispatches"][i].clone());
    assert_eq!(merged["stage"], "Merged");
    assert_eq!(merged["closed_at"], "2026-09-30T12:01:00Z");
    assert_eq!(open["stage"], "PR draft");
    assert_eq!(open["closed_at"], Value::Null);
}

/// Issue 7 dispatched with PR 9, merged and seen.
fn merged() -> Setup {
    let t = dispatched();
    t.world.add_pr(pr(9, "agent/api-7", PrState::Open));
    watch(&t);
    set_state(&t, 9, PrState::Merged);
    watch(&t);
    t
}

#[test]
fn a_dispatch_whose_worktree_cannot_be_removed_stays_live_and_is_closed_next_time() {
    let t = merged();
    t.world
        .fail_call("herdr worktree remove", "worktree has uncommitted changes");

    let said = dispatch::close_finished(&t.ctx()).unwrap();
    let during = status(&t)["dispatches"][0]["closed_at"].clone();
    t.world.clear_failures();
    let retried = calls_after(&t, || close(&t));

    assert_eq!(
        said,
        ["could not Close acme/api#7: worktree has uncommitted changes"]
    );
    assert_eq!(during, Value::Null);
    assert_eq!(
        retried,
        [
            "herdr worktree remove --workspace w1",
            "herdr workspace close w1"
        ]
    );
    assert_ne!(status(&t)["dispatches"][0]["closed_at"], Value::Null);
}

#[test]
fn closed_dispatches_are_pruned_30_days_after_closing() {
    let t = dispatched_all(&[7, 8]);
    t.world.add_pr(pr(9, "agent/api-7", PrState::Open));
    t.world.add_pr(pr(10, "agent/api-8", PrState::Open));
    watch(&t);
    set_state(&t, 9, PrState::Merged);
    watch(&t);
    close(&t);
    let day = Duration::from_secs(86_400);
    t.world.advance(29 * day);
    set_state(&t, 10, PrState::Closed);
    watch(&t);
    close(&t);
    let after_29_days = status(&t)["dispatches"].as_array().unwrap().len();

    t.world.advance(2 * day);
    close(&t);

    assert_eq!(after_29_days, 2);
    let left: Vec<Value> = (status(&t)["dispatches"].as_array().unwrap().iter())
        .map(|d| d["issue"].clone())
        .collect();
    assert_eq!(left, ["acme/api#8"]);
}
