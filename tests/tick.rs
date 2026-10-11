mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{GitHubBlocker, GitHubIssue, IssueState, PrState, PullRequest};

const TICK: Duration = Duration::from_secs(600);

/// Repo `acme/api` with Ready `issues`, each created a day after the one
/// before it, and no calls recorded yet.
fn with_issues(issues: &[u64]) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    for (day, &n) in issues.iter().enumerate() {
        t.world.add_issue(
            "acme/api",
            GitHubIssue {
                created_at: format!("2026-09-{:02}T00:00:00Z", day + 1),
                ..github_issue("acme/api", n)
            },
        );
    }
    t.world.calls.borrow_mut().clear();
    t
}

/// `acme/api`'s settings in config.toml, as `toml` sets them.
fn set_repo(t: &Setup, toml: &str) {
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
}

/// PR `n` of `acme/api`, open, from the Dispatch branch of issue `issue`.
fn pr_of(n: u64, issue: u64) -> PullRequest {
    PullRequest {
        head_branch: Some(format!("agent/api-{issue}")),
        ..pull_request("acme/api", n)
    }
}

/// GitHub merges PR `n` of `acme/api`, closing the issue it fixes.
fn merge(t: &Setup, n: u64, issue: u64) {
    let mut prs = t.world.prs.borrow_mut();
    prs.iter_mut().find(|pr| pr.number == n).unwrap().state = PrState::Merged;
    let mut issues = t.world.issues.borrow_mut();
    let issues = issues.get_mut("acme/api").unwrap();
    issues.iter_mut().find(|i| i.number == issue).unwrap().state = IssueState::Closed;
}

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// The issues an Implementer was prompted for, in order.
fn prompted(t: &Setup) -> Vec<String> {
    (t.world.calls().into_iter())
        .filter_map(|c| {
            let rest = c.strip_prefix("herdr agent prompt impl-api-")?;
            Some(format!("acme/api#{}", rest.split(' ').next()?))
        })
        .collect()
}

#[test]
fn a_tick_fills_the_room_with_the_oldest_ready_issues_first_and_stops_at_room() {
    let t = with_issues(&[4, 2, 1, 3]);

    let first = t.tick();
    let second = t.tick();

    assert_eq!(
        first,
        [
            "acme/api#4 dispatched",
            "acme/api#2 dispatched",
            "acme/api#1 dispatched"
        ]
    );
    assert_eq!(second, Vec::<String>::new());
    assert_eq!(prompted(&t), ["acme/api#4", "acme/api#2", "acme/api#1"]);
}

#[test]
fn a_repo_with_dispatch_off_is_read_but_never_dispatched_into() {
    let t = with_issues(&[1]);
    set_repo(&t, "switches = { dispatch = false }");

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(calls, ["github viewer", "github issues acme/api"]);
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["repos"][0]["ready"][0]["key"], "acme/api#1");
}

#[test]
fn a_dispatch_that_fails_is_said_holds_its_slot_and_the_fill_goes_on() {
    let t = with_issues(&[1, 2, 3, 4]);
    t.world.fail_call(
        "herdr worktree create --cwd /src/api --branch agent/api-1 ",
        "worktree_exists: agent/api-1 is checked out elsewhere",
    );

    let said = t.tick();

    assert_eq!(
        said,
        [
            "acme/api#1 failed at worktree: worktree_exists: agent/api-1 is checked out elsewhere",
            "acme/api#2 dispatched",
            "acme/api#3 dispatched",
        ]
    );
}

#[test]
fn a_source_that_fails_is_said_and_the_tick_goes_on() {
    let t = with_issues(&[1, 2]);
    set_repo(&t, "room = 1");
    t.tick();
    t.world.advance(TICK);
    t.world.fail_call("github issues", "HTTP 502: Bad Gateway");

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        ["could not read the issues of acme/api: HTTP 502: Bad Gateway"]
    );
    assert_eq!(
        calls,
        [
            "github viewer",
            "github issues acme/api",
            "github branch prs acme/api:agent/api-1",
            "herdr agent list",
        ]
    );
}

#[test]
fn a_tick_that_finds_another_running_skips_and_one_left_by_a_dead_process_is_taken() {
    let t = with_issues(&[1]);
    let file = t.config_dir.join("tick.lock");
    let held = std::fs::File::create(&file).unwrap();
    held.lock().unwrap();
    std::fs::write(&file, "777").unwrap();

    let (skipped, none) = calls_after(&t, || t.tick());
    // Its process died: the lock is released, the file is left.
    drop(held);
    let ran = t.tick();

    assert_eq!(skipped, ["tick skipped: another tick is running (pid 777)"]);
    assert_eq!(none, Vec::<String>::new());
    assert_eq!(ran, ["acme/api#1 dispatched"]);
}

#[test]
fn serve_ticks_at_once_then_every_tick_minutes_logging_a_line_per_action() {
    let t = with_issues(&[1, 2]);
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, format!("tick_minutes = 5\n{config}")).unwrap();
    t.world.timer_runs.set(2);

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        t.world.logged(),
        [
            "2026-09-30T12:00:00Z acme/api#1 dispatched",
            "2026-09-30T12:00:00Z acme/api#2 dispatched",
        ]
    );
    // The Source is read at 12:00, 12:05 and 12:10.
    let reads = t
        .world
        .calls()
        .into_iter()
        .filter(|c| c == "github issues acme/api");
    assert_eq!(reads.count(), 3);
    let cache = std::fs::read_to_string(t.config_dir.join("issues/acme/api.json")).unwrap();
    assert!(
        cache.contains(r#""read_at": "2026-09-30T12:10:00Z""#),
        "{cache}"
    );
}

#[test]
fn serve_logs_a_tick_that_fails_and_runs_the_next() {
    let t = with_issues(&[1]);
    std::fs::write(t.config_dir.join("dispatches.json"), "[").unwrap();
    t.world.timer_runs.set(1);

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let logged = t.world.logged();
    let times: Vec<&str> = logged.iter().map(|l| &l[..20]).collect();
    assert_eq!(times, ["2026-09-30T12:00:00Z", "2026-09-30T12:10:00Z"]);
    for line in &logged {
        assert!(line[21..].starts_with("tick failed: "), "{line}");
        assert!(
            line.contains("dispatches.json: EOF while parsing"),
            "{line}"
        );
    }
}

#[test]
fn a_night_of_independent_issues_is_dispatched_then_closed_as_each_pr_merges() {
    let t = with_issues(&[1, 2, 3, 4]);
    let mut night = vec![t.tick()];
    t.world.add_pr(pr_of(11, 1));
    t.world.add_pr(pr_of(12, 2));
    t.world.advance(TICK);
    night.push(t.tick());
    merge(&t, 11, 1);
    t.world.advance(TICK);
    night.push(t.tick());
    merge(&t, 12, 2);
    t.world.add_pr(pr_of(13, 3));
    t.world.advance(TICK);
    night.push(t.tick());

    assert_eq!(
        night,
        [
            vec![
                "acme/api#1 dispatched",
                "acme/api#2 dispatched",
                "acme/api#3 dispatched",
            ],
            vec![
                "acme/api#1: PR https://github.com/acme/api/pull/11 found",
                "acme/api#2: PR https://github.com/acme/api/pull/12 found",
            ],
            vec![
                "acme/api#1 Closed: its PR https://github.com/acme/api/pull/11 merged",
                "acme/api#4 dispatched",
            ],
            vec![
                "acme/api#3: PR https://github.com/acme/api/pull/13 found",
                "acme/api#2 Closed: its PR https://github.com/acme/api/pull/12 merged",
            ],
        ]
    );
    let status = t.cli(&["status", "--json"]).json();
    let shown: Vec<(&str, &str, bool)> = (status["dispatches"].as_array().unwrap().iter())
        .map(|d| {
            let (issue, stage) = (d["issue"].as_str().unwrap(), d["stage"].as_str().unwrap());
            (issue, stage, d["closed_at"].is_null())
        })
        .collect();
    assert_eq!(
        shown,
        [
            ("acme/api#1", "Merged", false),
            ("acme/api#2", "Merged", false),
            ("acme/api#3", "PR draft", true),
            ("acme/api#4", "Implementing", true),
        ]
    );
    assert_eq!(status["repos"][0]["ready"], serde_json::json!([]));
}

#[test]
fn a_tick_reads_the_source_asks_about_prs_closes_then_fills_the_room_it_freed() {
    let t = with_issues(&[1, 2]);
    set_repo(&t, "room = 1");
    t.tick();
    t.world.add_pr(pr_of(9, 1));
    t.world.advance(TICK);
    t.tick();
    merge(&t, 9, 1);
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        [
            "acme/api#1 Closed: its PR https://github.com/acme/api/pull/9 merged",
            "acme/api#2 dispatched",
        ]
    );
    assert_eq!(
        calls,
        [
            // (1) the Source, a tick old
            "github viewer",
            "github issues acme/api",
            // (2) the PR that can still change
            "github pr activity acme/api#9",
            // (3) Close
            "herdr worktree remove --workspace w1",
            "herdr workspace close w1",
            // (7) the room it freed
            "git -C /src/api default-branch",
            "github assign acme/api#2 @me",
            "git -C /src/api fetch origin",
            "herdr worktree create --cwd /src/api --branch agent/api-2 --base origin/main --label api#2 --no-focus",
            "herdr tab create --workspace w2 --cwd /worktrees/api-2 --label implementer --no-focus",
            "herdr agent start impl-api-2 --kind claude --pane w2:p2 -- ",
            "github app repos",
            "herdr agent prompt impl-api-2 /implement https://github.com/acme/api/issues/2 as draft PR against main",
        ]
    );
}

/// `issue` of `acme/api` blocked by the open issues `blockers` of `acme/api`.
fn block(t: &Setup, issue: u64, blockers: &[u64]) {
    let mut issues = t.world.issues.borrow_mut();
    let issues = issues.get_mut("acme/api").unwrap();
    let blocked = issues.iter_mut().find(|i| i.number == issue).unwrap();
    blocked.blockers = (blockers.iter())
        .map(|&number| GitHubBlocker {
            slug: "acme/api".into(),
            number,
            state: IssueState::Open,
        })
        .collect();
}

/// Ready issue #3, and #2, older, Stackable: its Blocker #1, worked outside
/// the loop, has open PR 11 from `agent/api-1`.
fn with_stackable() -> Setup {
    let t = with_issues(&[2, 3]);
    block(&t, 2, &[1]);
    t.world.link_pr("acme/api", 1, pr_of(11, 1));
    t
}

#[test]
fn a_stackable_issue_is_dispatched_after_the_ready_ones_on_its_blockers_pr_branch() {
    let t = with_stackable();

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api#3 dispatched", "acme/api#2 dispatched"]);
    let stacked: Vec<&str> = (calls.iter())
        .skip_while(|c| !c.starts_with("herdr agent prompt impl-api-3 "))
        .skip(1)
        .map(String::as_str)
        .collect();
    assert_eq!(
        stacked,
        [
            "github assign acme/api#2 @me",
            "git -C /src/api fetch origin +refs/heads/agent/api-1:refs/remotes/origin/agent/api-1",
            "herdr worktree create --cwd /src/api --branch agent/api-2 --base origin/agent/api-1 --label api#2 --no-focus",
            "herdr tab create --workspace w2 --cwd /worktrees/api-2 --label implementer --no-focus",
            "herdr agent start impl-api-2 --kind claude --pane w2:p2 -- ",
            "github app repos",
            "herdr agent prompt impl-api-2 /implement https://github.com/acme/api/issues/2 as draft PR against agent/api-1",
        ]
    );
    let status = t.cli(&["status", "--json"]).json();
    let record = &status["dispatches"][1];
    assert_eq!(record["issue"], "acme/api#2");
    assert_eq!(record["base"], "agent/api-1");
    assert_eq!(
        record["stacked_on"],
        serde_json::json!({ "number": 11, "url": "https://github.com/acme/api/pull/11", "head_branch": "agent/api-1" })
    );
}

#[test]
fn an_issue_whose_blockers_prs_sit_on_two_branches_waits_with_the_reason_shown() {
    let t = with_issues(&[3]);
    block(&t, 3, &[1, 2]);
    t.world.link_pr("acme/api", 1, pr_of(11, 1));
    t.world.link_pr("acme/api", 2, pr_of(12, 2));
    let reason = "acme/api#3 waits for its Blockers' open PRs https://github.com/acme/api/pull/11, https://github.com/acme/api/pull/12 to merge down to one; they sit on different branches";

    let said = t.tick();
    let by_hand = t.cli(&["dispatch", "acme/api#3", "--json"]);

    assert_eq!(said, Vec::<String>::new());
    assert!(!t.world.calls().iter().any(|c| !c.starts_with("github ")));
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["repos"][0]["waiting"][0]["reason"], reason);
    assert_eq!(by_hand.exit_code, 1);
    assert_eq!(by_hand.json()["help"][0], reason);
}

#[test]
fn with_stack_off_a_stackable_issue_is_listed_but_never_dispatched() {
    let t = with_stackable();
    set_repo(&t, "switches = { stack = false }");

    let said = t.tick();

    assert_eq!(said, ["acme/api#3 dispatched"]);
    let status = t.cli(&["status", "--json"]).json();
    let stackable = &status["repos"][0]["stackable"];
    assert_eq!(stackable[0]["key"], "acme/api#2");
    assert_eq!(stackable[0]["base"], "agent/api-1");
}

#[test]
fn a_stacked_dispatch_finds_its_pr_on_its_branch_and_is_closed_when_it_merges() {
    let t = with_stackable();
    t.tick();
    let on_blocker = PullRequest {
        base_branch: "agent/api-1".into(),
        ..pr_of(12, 2)
    };
    t.world.add_pr(on_blocker);
    t.world.advance(TICK);
    let found = t.tick();
    // Into the Blocker's branch: GitHub leaves #2 open.
    let mut prs = t.world.prs.borrow_mut();
    prs.iter_mut().find(|pr| pr.number == 12).unwrap().state = PrState::Merged;
    drop(prs);
    t.world.advance(TICK);

    let (closed, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        found,
        ["acme/api#2: PR https://github.com/acme/api/pull/12 found"]
    );
    assert_eq!(
        closed,
        ["acme/api#2 Closed: its PR https://github.com/acme/api/pull/12 merged"]
    );
    // Only its own worktree and workspace are freed.
    let herdr: Vec<&String> = calls.iter().filter(|c| c.starts_with("herdr ")).collect();
    assert_eq!(
        herdr,
        [
            "herdr worktree remove --workspace w2",
            "herdr workspace close w2"
        ]
    );
}
