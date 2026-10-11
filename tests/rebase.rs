mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{
    GitHubBlocker, IssueState, Mergeable, PrState, PullRequest, PullRequestActivity,
};
use serde_json::Value;

const TICK: Duration = Duration::from_secs(600);

/// Repo `acme/api` with `toml` in its settings and Ready `issues`.
fn with_issues(toml: &str, issues: &[u64]) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::create_dir_all(&t.config_dir).unwrap();
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    for &n in issues {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    t
}

/// Issue 1 dispatched by a tick, and its PR 11 found by the next.
fn with_pr(toml: &str) -> Setup {
    let t = with_issues(toml, &[1]);
    t.tick();
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-1".into()),
        ..pull_request("acme/api", 11)
    });
    next_tick(&t);
    t
}

/// GitHub says PR 11 of `acme/api`, open on `main`, is `mergeable`.
fn pr_11_is(t: &Setup, mergeable: Mergeable) {
    let activity = PullRequestActivity {
        state: PrState::Open,
        draft: true,
        head_sha: "sha11".into(),
        base_branch: "main".into(),
        mergeable,
        updated_at: "2026-09-30T12:00:00Z".into(),
    };
    (t.world.activity.borrow_mut()).insert("acme/api#11".into(), activity);
}

/// Run a tick a tick later: what it said.
fn next_tick(t: &Setup) -> Vec<String> {
    t.world.advance(TICK);
    t.world.calls.borrow_mut().clear();
    t.tick()
}

/// The prompts the Implementer of `issue` was sent since the calls were last cleared.
fn prompts(t: &Setup, issue: u64) -> Vec<String> {
    let to = format!("herdr agent prompt impl-api-{issue} ");
    (t.world.calls().into_iter())
        .filter_map(|c| Some(c.strip_prefix(&to)?.to_string()))
        .collect()
}

#[test]
fn a_conflict_restarts_once_and_again_only_after_the_pr_was_mergeable_in_between() {
    let t = with_pr("");
    let mut said = vec![];
    let mut sent = vec![];
    for mergeable in [
        Mergeable::Conflicting,
        Mergeable::Conflicting,
        // GitHub working it out again: what was known stands.
        Mergeable::Unknown,
        Mergeable::Conflicting,
        Mergeable::Mergeable,
        Mergeable::Unknown,
        Mergeable::Conflicting,
        Mergeable::Mergeable,
        Mergeable::Conflicting,
    ] {
        pr_11_is(&t, mergeable);
        said.push(next_tick(&t));
        sent.extend(prompts(&t, 1));
    }

    let restarted = vec!["acme/api#1 restarted: conflict"];
    let none = Vec::<&str>::new();
    assert_eq!(
        said,
        [
            restarted.clone(),
            none.clone(),
            none.clone(),
            none.clone(),
            none.clone(),
            none.clone(),
            restarted,
            none,
            vec!["acme/api#1 Failed: conflict again after 2 restarts for it"],
        ]
    );
    let prompt = "You are continuing https://github.com/acme/api/issues/1 on branch agent/api-1 in this worktree. Read git status, git log and the PR https://github.com/acme/api/pull/11 first. The PR conflicts with main. Rebase onto it, resolve, run the tests and the verification, push.";
    assert_eq!(sent, [prompt, prompt]);
}

#[test]
fn with_restart_off_a_conflict_is_left_alone() {
    let t = with_pr("switches = { restart = false }");
    pr_11_is(&t, Mergeable::Conflicting);

    let said = next_tick(&t);

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(prompts(&t, 1), Vec::<String>::new());
}

/// Issue 2, Stacked by a tick on its Blocker #1's open PR 11, which was
/// worked outside the loop and targets `develop`; its own PR 12 on 11's head
/// found by the next tick.
fn stacked() -> Setup {
    let t = with_issues("", &[2]);
    let mut issues = t.world.issues.borrow_mut();
    issues.get_mut("acme/api").unwrap()[0].blockers = vec![GitHubBlocker {
        slug: "acme/api".into(),
        number: 1,
        state: IssueState::Open,
    }];
    drop(issues);
    let below = PullRequest {
        head_branch: Some("agent/api-1".into()),
        base_branch: "develop".into(),
        ..pull_request("acme/api", 11)
    };
    t.world.link_pr("acme/api", 1, below);
    t.tick();
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-2".into()),
        base_branch: "agent/api-1".into(),
        ..pull_request("acme/api", 12)
    });
    t
}

/// The PRs GitHub was asked about since the calls were last cleared.
fn asked(t: &Setup) -> Vec<String> {
    (t.world.calls().into_iter())
        .filter(|c| c.starts_with("github pr activity "))
        .collect()
}

#[test]
fn a_retarget_restarts_once_when_the_pr_below_turns_final_naming_its_base() {
    let t = stacked();
    let watching = next_tick(&t);
    let asked_while_open = asked(&t);
    let mut prs = t.world.prs.borrow_mut();
    prs.iter_mut().find(|pr| pr.number == 11).unwrap().state = PrState::Merged;
    drop(prs);

    let merged = next_tick(&t);
    let sent = prompts(&t, 2);
    // Asked to rebase already: its conflict meanwhile is no restart.
    let activity = PullRequestActivity {
        state: PrState::Open,
        draft: true,
        head_sha: "sha12".into(),
        base_branch: "develop".into(),
        mergeable: Mergeable::Conflicting,
        updated_at: "2026-09-30T12:30:00Z".into(),
    };
    (t.world.activity.borrow_mut()).insert("acme/api#12".into(), activity);
    let after = next_tick(&t);

    assert_eq!(
        watching,
        [
            "acme/api#2: PR https://github.com/acme/api/pull/12 found",
            "acme/api#2: Reviewer started on codex for sha12",
        ]
    );
    assert_eq!(
        asked_while_open,
        [
            "github pr activity acme/api#11",
            "github pr activity acme/api#12"
        ]
    );
    assert_eq!(merged, ["acme/api#2 restarted: retarget"]);
    assert_eq!(
        sent,
        [
            "You are continuing https://github.com/acme/api/issues/2 on branch agent/api-2 in this worktree. Read git status, git log and the PR https://github.com/acme/api/pull/12 first. The PR below yours merged. Retarget the PR onto develop, rebase, push."
        ]
    );
    assert_eq!(after, Vec::<String>::new());
    // Final, 11 is never asked about again.
    assert_eq!(asked(&t), ["github pr activity acme/api#12"]);
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["dispatches"][0]["base"], "develop");
}

#[test]
fn a_dispatch_is_restarted_once_a_tick_for_its_most_specific_reason_and_another_waits() {
    let t = with_pr("");
    // Its agent is gone, its PR conflicts, and the Reviewer failed its head.
    t.world.agents.borrow_mut().remove("impl-api-1");
    pr_11_is(&t, Mergeable::Conflicting);
    let findings = t.config_dir.with_file_name("findings.md");
    std::fs::write(&findings, "Signing in shows a 500.\n").unwrap();
    let findings = findings.display().to_string();
    let fail = [
        "verdict",
        "acme/api#1",
        "fail",
        "--sha",
        "sha11",
        "--findings",
    ];
    assert_eq!(t.cli(&[&fail[..], &[&findings]].concat()).exit_code, 0);

    let first = next_tick(&t);
    let tabs: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("herdr tab "))
        .collect();
    let sent = prompts(&t, 1);
    let second = next_tick(&t);
    let third = next_tick(&t);

    // A rebase first: it moves the head the Verdict is on, and any restart
    // starts the agent that was gone.
    assert_eq!(first, ["acme/api#1 restarted: conflict"]);
    assert_eq!(
        tabs,
        [
            "herdr tab close w1:t2",
            "herdr tab create --workspace w1 --cwd /worktrees/api-1 --label implementer --no-focus",
        ]
    );
    assert_eq!(
        sent,
        [
            "You are continuing https://github.com/acme/api/issues/1 on branch agent/api-1 in this worktree. Read git status, git log and the PR https://github.com/acme/api/pull/11 first. The PR conflicts with main. Rebase onto it, resolve, run the tests and the verification, push."
        ]
    );
    assert_eq!(second, ["acme/api#1 restarted: verdict"]);
    assert_eq!(third, Vec::<String>::new());
    let status = t.cli(&["status", "--json"]).json();
    let reasons: Vec<&Value> = (status["dispatches"][0]["restarts"].as_array().unwrap())
        .iter()
        .map(|r| &r["reason"])
        .collect();
    assert_eq!(reasons, ["conflict", "verdict"]);
}
