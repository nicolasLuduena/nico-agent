mod common;

use std::time::Duration;

use common::{Ran, Setup, github_issue, pull_request, setup};
use nico_agent::world::{Mergeable, PrState, PullRequest, PullRequestActivity};
use serde_json::{Value, json};

const TICK: Duration = Duration::from_secs(600);

/// The review prompt for PR 9 of issue 7 at `sha`, on codex.
fn review_prompt(sha: &str) -> String {
    format!(
        "herdr agent prompt rev-api-7 $verdict https://github.com/acme/api/pull/9 for https://github.com/acme/api/issues/7: re-run the repo's verification skill under .agents/skills/verify-*/ against the PR's head, and record the result with nico-agent verdict acme/api#7 pass|fail --sha {sha} --findings <file>"
    )
}

/// Repo `acme/api`, as `toml` sets it, with issue 7 dispatched by a tick.
fn dispatched(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    assert_eq!(t.tick(), ["acme/api#7 dispatched"]);
    t
}

/// `dispatched`, then PR 9 opened on its branch and seen by the next tick.
fn with_pr(toml: &str) -> Setup {
    let t = dispatched(toml);
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.world.advance(TICK);
    t
}

/// The Implementer pushes: PR 9's head is now `sha`.
fn push(t: &Setup, sha: &str) {
    t.world.activity.borrow_mut().insert(
        "acme/api#9".into(),
        PullRequestActivity {
            state: PrState::Open,
            draft: true,
            head_sha: sha.into(),
            base_branch: "main".into(),
            mergeable: Mergeable::Mergeable,
            updated_at: "2026-09-30T12:30:00Z".into(),
        },
    );
}

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// What herdr was told to do: its calls but the Asking step's read of every agent.
fn herdr(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| c.starts_with("herdr ") && *c != "herdr agent list")
        .map(String::as_str)
        .collect()
}

#[test]
fn a_reviewer_starts_on_another_harness_when_the_pr_first_appears_and_only_then() {
    let t = with_pr("");

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        [
            "acme/api#7: PR https://github.com/acme/api/pull/9 found",
            "acme/api#7: Reviewer started on codex for sha9",
        ]
    );
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p3 -- -c projects={"/src/api"={trust_level="trusted"}}"#,
            &review_prompt("sha9"),
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(herdr(&later), Vec::<&str>::new());
    let status = t.cli(&["status", "--json"]).json();
    let reviewer = &status["dispatches"][0]["reviewer"];
    assert_eq!(reviewer["agent"], "rev-api-7");
    assert_eq!(reviewer["harness"], "codex");
    assert_eq!(reviewer["tab"], "w1:t3");
    assert_eq!(reviewer["sha"], "sha9");
}

#[test]
fn a_new_head_closes_the_last_reviewers_tab_and_starts_it_again_for_that_head() {
    let t = with_pr("");
    t.tick();
    push(&t, "sha10");
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha10"]);
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p4 -- -c projects={"/src/api"={trust_level="trusted"}}"#,
            &review_prompt("sha10"),
        ]
    );
}

#[test]
fn a_reviewer_that_fails_to_start_is_said_and_started_again_next_tick_in_a_fresh_tab() {
    let t = with_pr("");
    t.world
        .fail_call("herdr agent start rev-api-7", "agent_name_taken: rev-api-7");

    let said = t.tick();
    t.world.clear_failures();
    t.world.advance(TICK);
    let (again, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said[1..],
        ["could not start the Reviewer of acme/api#7: agent_name_taken: rev-api-7"]
    );
    assert_eq!(again, ["acme/api#7: Reviewer started on codex for sha9"]);
    assert_eq!(
        herdr(&calls)[..2],
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
        ]
    );
}

#[test]
fn a_reviewer_gone_from_herdr_before_its_verdict_is_started_again_for_that_head_and_not_after_it() {
    let t = with_pr("");
    t.tick();
    t.world.agents.borrow_mut().remove("rev-api-7");
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.agents.borrow_mut().remove("rev-api-7");
    t.world.advance(TICK);
    let (after, _) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha9"]);
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p4 -- -c projects={"/src/api"={trust_level="trusted"}}"#,
            &review_prompt("sha9"),
        ]
    );
    assert_eq!(
        after,
        ["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"]
    );
}

#[test]
fn with_review_off_no_reviewer_starts() {
    let t = with_pr("switches = { review = false }");

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        ["acme/api#7: PR https://github.com/acme/api/pull/9 found"]
    );
    assert_eq!(herdr(&calls), Vec::<&str>::new());
}

/// `with_pr`, its PR found and its Reviewer started.
fn reviewing() -> Setup {
    let t = with_pr("");
    t.tick();
    t
}

fn verdict(t: &Setup, args: &[&str]) -> Ran {
    t.cli(&[&["verdict"], args, &["--json"]].concat())
}

fn stage(t: &Setup) -> Value {
    t.cli(&["status", "--json"]).json()["dispatches"][0]["stage"].clone()
}

#[test]
fn a_passing_verdict_on_the_head_makes_the_dispatch_verified_until_the_pr_moves() {
    let t = reviewing();

    let ran = verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let verified = t.cli(&["status", "--json"]).json()["dispatches"][0].clone();
    push(&t, "sha10");
    t.world.advance(TICK);
    let said = t.tick();

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        ran.json(),
        json!({ "verdict": "acme/api#7 pass at sha9", "stage": "Verified" })
    );
    assert_eq!(verified["stage"], "Verified");
    assert_eq!(
        verified["verdict"],
        json!({ "result": "pass", "sha": "sha9", "at": "2026-09-30T12:10:00Z", "findings": null })
    );
    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha10"]);
    assert_eq!(stage(&t), "PR draft");
}

/// The calls among `calls` about a PR.
fn pr_calls(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| c.starts_with("github pr "))
        .map(String::as_str)
        .collect()
}

#[test]
fn a_passing_verdict_flips_the_draft_pr_to_ready_once_and_nothing_else_is_written_to_it() {
    let t = reviewing();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        ["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"]
    );
    // No merge, approval or comment: the flip is the one write.
    assert_eq!(
        pr_calls(&calls),
        [
            "github pr activity acme/api#9",
            "github pr ready acme/api#9"
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(pr_calls(&later), ["github pr activity acme/api#9"]);
    let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
    assert_eq!(
        (&shown["stage"], &shown["pr"]["draft"]),
        (&json!("Verified"), &json!(false))
    );
}

#[test]
fn a_pr_put_back_to_draft_by_hand_is_not_flipped_again_for_the_same_verdict() {
    let t = reviewing();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);
    let flipped = t.tick();
    // The user converts it back to draft.
    t.world.readied.borrow_mut().clear();
    t.world.advance(TICK);

    let (again, calls) = calls_after(&t, || t.tick());
    push(&t, "sha10");
    t.world.advance(TICK);
    t.tick();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha10"]);
    t.world.advance(TICK);
    let new_verdict = t.tick();

    let ready = ["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"];
    assert_eq!(flipped, ready);
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(pr_calls(&calls), ["github pr activity acme/api#9"]);
    assert_eq!(new_verdict, ready);
}

#[test]
fn with_flip_off_a_verified_pr_stays_draft_and_status_says_so() {
    let t = with_pr("switches = { flip = false }");
    t.tick();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(pr_calls(&calls), ["github pr activity acme/api#9"]);
    let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
    assert_eq!(
        (&shown["stage"], &shown["pr"]["draft"]),
        (&json!("Verified"), &json!(true))
    );
    assert_eq!(
        shown["warnings"],
        json!([
            "flip is off for acme/api, so its Verified PR stays draft; mark it ready by hand, or turn on repos.\"acme/api\".switches.flip"
        ])
    );
}

/// A findings file the Reviewer wrote, outside the config directory.
fn findings(t: &Setup, text: &str) -> String {
    let file = t.config_dir.with_file_name("findings.md");
    std::fs::write(&file, text).unwrap();
    file.display().to_string()
}

fn verdict_file(t: &Setup) -> Value {
    let file = t.config_dir.join("verdicts/acme/api#7.json");
    serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
}

#[test]
fn a_failing_verdict_keeps_its_findings_restarts_the_implementer_once_and_no_reviewer_starts_on_that_head()
 {
    let t = reviewing();
    let file = findings(&t, "Signing in shows a 500.\n");

    let ran = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    t.world.advance(TICK);
    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        ran.json(),
        json!({ "verdict": "acme/api#7 fail at sha9", "stage": "PR draft" })
    );
    assert_eq!(
        verdict_file(&t),
        json!({ "result": "fail", "sha": "sha9", "at": "2026-09-30T12:10:00Z", "findings": "Signing in shows a 500.\n" })
    );
    assert_eq!(said, ["acme/api#7 restarted: verdict"]);
    let findings_path = t.config_dir.join("verdicts/acme/api#7.json");
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t2",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
            "herdr agent start impl-api-7 --kind claude --pane w1:p4 -- ",
            &format!(
                "herdr agent prompt impl-api-7 You are continuing https://github.com/acme/api/issues/7 on branch agent/api-7 in this worktree. Read git status, git log and the PR https://github.com/acme/api/pull/9 first. The Reviewer failed the PR at sha9. Its findings are in {}. Address each, run the verification, push.",
                findings_path.display()
            ),
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(herdr(&later), Vec::<&str>::new());
}

#[test]
fn a_third_failing_verdict_marks_the_dispatch_failed_notifies_once_and_starts_no_reviewer_after() {
    let t = reviewing();
    let file = findings(&t, "Signing in shows a 500.\n");

    let mut said = vec![];
    for (head, next) in [("sha9", "sha10"), ("sha10", "sha11"), ("sha11", "sha12")] {
        verdict(
            &t,
            &["acme/api#7", "fail", "--sha", head, "--findings", &file],
        );
        t.world.advance(TICK);
        said.extend(t.tick());
        // The Implementer pushes a fix, and the next tick sees it.
        push(&t, next);
        t.world.advance(TICK);
        said.extend(t.tick());
    }

    assert_eq!(
        said,
        [
            "acme/api#7 restarted: verdict",
            "acme/api#7: Reviewer started on codex for sha10",
            "acme/api#7 restarted: verdict",
            "acme/api#7: Reviewer started on codex for sha11",
            "acme/api#7 Failed: verdict again after 2 restarts for it",
        ]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#7 Failed".to_string(),
            "restart: verdict again after 2 restarts for it".to_string()
        )]
    );
    assert_eq!(stage(&t), "Failed");
}

#[test]
fn the_same_verdict_again_is_a_no_op_and_a_changed_one_replaces_it() {
    let t = reviewing();
    let file = findings(&t, "The search box is gone.\n");
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(Duration::from_secs(60));

    let again = verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let kept = verdict_file(&t);
    let changed = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );

    assert_eq!(again.exit_code, 0, "{}", again.stdout);
    assert_eq!(
        again.json(),
        json!({ "verdict": "acme/api#7 pass at sha9 already recorded (no-op)", "stage": "Verified" })
    );
    assert_eq!(kept["at"], "2026-09-30T12:10:00Z");
    assert_eq!(changed.json()["stage"], "PR draft");
    assert_eq!(verdict_file(&t)["result"], "fail");
    assert_eq!(verdict_file(&t)["at"], "2026-09-30T12:11:00Z");
}

#[test]
fn with_review_off_a_verdict_still_records_and_once_on_its_head_gets_no_reviewer() {
    let t = with_pr("switches = { review = false }");
    t.tick();
    let file = findings(&t, "The search box is gone.\n");

    let ran = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    // Restart off: the failing Verdict's own restart is not what this is about.
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { restart = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.advance(TICK);
    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(verdict_file(&t)["result"], "fail");
    assert_eq!(said, Vec::<String>::new());
    assert_eq!(herdr(&calls), Vec::<&str>::new());
}

#[test]
fn a_reviewer_that_keeps_leaving_herdr_is_started_again_up_to_the_cap_per_head_then_told_once() {
    let t = reviewing();
    let gone = |t: &Setup| {
        t.world.agents.borrow_mut().remove("rev-api-7");
        t.world.advance(TICK);
        t.tick()
    };

    let said: Vec<Vec<String>> = (0..4).map(|_| gone(&t)).collect();
    push(&t, "sha10");
    let new_head = gone(&t);

    let started = vec!["acme/api#7: Reviewer started on codex for sha9"];
    assert_eq!(
        said,
        [
            started.clone(),
            started,
            vec![
                "acme/api#7: its Reviewer left herdr 3 times without a Verdict on sha9; not started again for it"
            ],
            vec![],
        ]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#7 Reviewer stopped".to_string(),
            "Its Reviewer left herdr 3 times without a Verdict on sha9. Review the PR by hand and record it with `nico-agent verdict acme/api#7 pass|fail --sha sha9`.".to_string()
        )]
    );
    assert_eq!(
        new_head,
        ["acme/api#7: Reviewer started on codex for sha10"]
    );
}

#[test]
fn a_reviewer_on_the_implementers_harness_starts_there_with_a_warning_in_status() {
    let t = with_pr("reviewer = { harness = \"claude\", model = \"opus\" }");
    let other = with_pr("");

    let said = t.tick();

    assert_eq!(said[1], "acme/api#7: Reviewer started on claude for sha9");
    assert!(
        (t.world.calls().iter())
            .any(|c| c == "herdr agent start rev-api-7 --kind claude --pane w1:p3 -- --model opus"),
        "{:?}",
        t.world.calls()
    );
    let repo = t.cli(&["status", "--json"]).json()["repos"][0].clone();
    assert_eq!(
        repo["warnings"],
        json!([
            "acme/api's Reviewer runs on claude, as its Implementer does, so it may share its blind spots; set another Harness in repos.\"acme/api\".reviewer"
        ])
    );
    let repo = other.cli(&["status", "--json"]).json()["repos"][0].clone();
    assert_eq!(repo.get("warnings"), None);
}

/// Repo `acme/api`, as `toml` sets it, with issue 7 dispatched by hand on
/// codex and its PR 9 opened since.
fn dispatched_on_codex(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    let ran = t.cli(&["dispatch", "acme/api#7", "--harness", "codex"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t
}

#[test]
fn the_reviewer_runs_on_a_harness_other_than_the_one_its_dispatchs_implementer_runs_on() {
    let t = dispatched_on_codex("");

    let said = t.tick();

    assert_eq!(
        said,
        [
            "acme/api#7: PR https://github.com/acme/api/pull/9 found",
            "acme/api#7: Reviewer started on claude for sha9",
        ]
    );
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["dispatches"][0]["warnings"], json!([]));
}

#[test]
fn a_dispatch_whose_reviewer_runs_on_its_own_implementers_harness_is_warned_of_in_status() {
    let t = dispatched_on_codex("reviewer = { harness = \"codex\" }");

    let said = t.tick();

    assert_eq!(said[1], "acme/api#7: Reviewer started on codex for sha9");
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["repos"][0].get("warnings"), None);
    assert_eq!(
        status["dispatches"][0]["warnings"],
        json!([
            "acme/api#7's Reviewer runs on codex, as its Implementer does, so it may share its blind spots; set another Harness in repos.\"acme/api\".reviewer"
        ])
    );
}

const USAGE: &str = "Run `nico-agent verdict <issue> pass|fail --sha <sha> [--findings <file>]` to record the Reviewer's Verdict on the head of the issue's PR";

#[test]
fn a_verdict_on_no_live_dispatch_no_open_pr_or_a_head_the_pr_moved_from_is_refused() {
    let t = dispatched("");
    t.world.add_issue("acme/api", github_issue("acme/api", 8));
    let see = "Run `nico-agent status` to see the Dispatch";
    let no_pr = verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let t = reviewing();
    let gone = findings(&t, "x").replace("findings.md", "nowhere.md");
    let cases = [
        (
            vec!["acme/api#8", "pass", "--sha", "sha9"],
            json!({
                "error": "acme/api#8 has no live Dispatch",
                "help": ["A Verdict is on the PR of an issue In flight", see],
            }),
        ),
        (
            vec!["acme/api#7", "pass", "--sha", "sha8"],
            json!({
                "error": "sha8 is not the head of https://github.com/acme/api/pull/9",
                "help": ["The PR moved to sha9: verify that head and run `nico-agent verdict acme/api#7 pass|fail --sha sha9`"],
            }),
        ),
        (
            vec!["acme/api#7", "fail", "--sha", "sha9", "--findings", &gone],
            json!({
                "error": format!("could not read the findings in {gone}: No such file or directory (os error 2)"),
                "help": ["Pass --findings the file the findings are written in"],
            }),
        ),
    ];

    assert_eq!(no_pr.exit_code, 1);
    assert_eq!(
        no_pr.json(),
        json!({
            "error": "acme/api#7 has no open PR",
            "help": ["A Verdict is on the head of an open PR", see],
        })
    );
    for (args, refused) in cases {
        let ran = verdict(&t, &args);
        assert_eq!((ran.exit_code, ran.json()), (1, refused), "{args:?}");
    }
    assert!(!t.config_dir.join("verdicts").exists());
}

#[test]
fn a_fail_without_findings_or_a_verdict_not_pass_or_fail_or_without_sha_is_a_bad_invocation() {
    let t = reviewing();
    let cases = [
        (
            vec!["acme/api#7", "fail", "--sha", "sha9"],
            "a failing Verdict needs --findings <file>",
        ),
        (
            vec!["acme/api#7", "maybe", "--sha", "sha9"],
            "`maybe` is not a Verdict: pass or fail",
        ),
        (vec!["acme/api#7", "pass"], "--sha is required"),
        (vec!["acme/api#7", "--sha", "sha9"], "pass|fail is required"),
    ];

    for (args, error) in cases {
        let ran = verdict(&t, &args);
        assert_eq!(
            (ran.exit_code, ran.json()),
            (2, json!({ "error": error, "help": [USAGE] })),
            "{args:?}"
        );
    }
}
