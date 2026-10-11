mod common;

use common::{Ran, Setup, github_issue, setup};
use serde_json::{Value, json};

const FLAGS: [&str; 6] = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/// The calls of a whole dispatch of `acme/api#7` with FLAGS.
const ALL: [&str; 10] = [
    "github viewer",
    "github issues acme/api",
    "git -C /src/api default-branch",
    "github assign acme/api#7 @me",
    "git -C /src/api fetch origin",
    "herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/main --label api#7 --no-focus",
    "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
    "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
    "github app repos",
    "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main",
];

/// Repo `acme/api` with Ready issue 7, and no calls recorded yet.
fn with_issue() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.world.calls.borrow_mut().clear();
    t
}

/// `with_issue`, with `acme/api` as `toml` sets it.
fn with_repo_config(toml: &str) -> Setup {
    let t = with_issue();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t
}

fn herdr_calls(t: &Setup) -> Vec<String> {
    let calls = t.world.calls();
    calls
        .into_iter()
        .filter(|c| c.starts_with("herdr "))
        .collect()
}

fn dispatch(t: &Setup, args: &[&str]) -> Ran {
    t.cli(&[&["dispatch"], args, &["--json"]].concat())
}

fn dispatch_7(t: &Setup) -> Ran {
    dispatch(t, &[&["acme/api#7"], &FLAGS[..]].concat())
}

#[test]
fn dispatch_claims_the_issue_then_starts_an_implementer_and_prompts_it() {
    let t = with_issue();

    let ran = dispatch_7(&t);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        ran.json(),
        json!({ "dispatched": "acme/api#7", "stage": "Implementing", "workspace": "w1", "agent": "impl-api-7" })
    );
    assert_eq!(t.world.calls(), ALL);
}

#[test]
fn without_flags_the_launch_and_base_come_from_the_repo() {
    let t = with_repo_config(
        "base = \"develop\"\nimplementer = { harness = \"codex\", model = \"gpt-5\", effort = \"high\" }\n",
    );

    let ran = dispatch(&t, &["acme/api#7"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert!(!t.world.calls().iter().any(|c| c.contains("default-branch")));
    assert_eq!(
        herdr_calls(&t),
        [
            "herdr worktree create --cwd /src/api --branch agent/api-7 --base origin/develop --label api#7 --no-focus",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
            // codex asks to trust the clone even when herdr reports it ready.
            r#"herdr agent start impl-api-7 --kind codex --pane w1:p2 -- -m gpt-5 -c model_reasoning_effort=high -c projects={"/src/api"={trust_level="trusted"}}"#,
            "herdr agent prompt impl-api-7 $implement https://github.com/acme/api/issues/7 as draft PR against develop",
        ]
    );
}

#[test]
fn a_flag_overrides_the_repo_launch_and_a_harness_flag_drops_its_model_and_effort() {
    let t = with_repo_config(
        "implementer = { harness = \"claude\", model = \"opus\", effort = \"high\" }\n",
    );
    t.world.add_issue("acme/api", github_issue("acme/api", 8));

    dispatch(&t, &["acme/api#7", "--effort", "max"]);
    dispatch(&t, &["acme/api#8", "--harness", "codex"]);

    let starts: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("herdr agent start"))
        .collect();
    assert_eq!(
        starts,
        [
            "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort max",
            r#"herdr agent start impl-api-8 --kind codex --pane w2:p2 -- -c projects={"/src/api"={trust_level="trusted"}}"#,
        ]
    );
}

#[test]
fn an_unknown_harness_model_or_effort_is_a_bad_invocation_naming_the_valid_ones() {
    let t = with_issue();
    let cases = [
        (
            ["--harness", "pi"],
            "unknown Harness `pi`",
            "Valid Harnesses: claude, codex, opencode",
        ),
        (
            ["--model", "gpt"],
            "unknown model `gpt` for claude",
            "Valid models for claude: fable, opus, sonnet, haiku",
        ),
        (
            ["--effort", "ultra"],
            "unknown Effort `ultra` for claude",
            "Valid Efforts for claude: low, medium, high, xhigh, max",
        ),
    ];
    for (flags, error, help) in cases {
        let ran = dispatch(&t, &[&["acme/api#7"], &flags[..]].concat());

        assert_eq!(ran.exit_code, 2);
        assert_eq!(ran.json(), json!({ "error": error, "help": [help] }));
    }
    assert!(!t.world.calls().iter().any(|c| !c.starts_with("github ")));
}

#[test]
fn an_issue_that_is_not_ready_is_refused_with_help_saying_why() {
    let t = with_issue();
    let issue = |n: u64, change: &dyn Fn(&mut nico_agent::world::GitHubIssue)| {
        let mut issue = github_issue("acme/api", n);
        change(&mut issue);
        t.world.add_issue("acme/api", issue);
    };
    issue(2, &|i| i.has_sub_issues = true);
    issue(3, &|i| i.assignees = vec!["colleague".into()]);
    issue(4, &|i| {
        i.blockers = vec![nico_agent::world::GitHubBlocker {
            slug: "acme/api".into(),
            number: 2,
            state: nico_agent::world::IssueState::Open,
        }]
    });
    issue(5, &|i| i.labels = vec!["needs-triage".into()]);
    let cases = [
        (
            2,
            "acme/api#2 is a parent issue; dispatch its sub-issues instead",
        ),
        (3, "acme/api#3 is assigned to colleague"),
        (4, "acme/api#4 waits on its Blockers acme/api#2"),
        (
            5,
            "acme/api#5 was not an open issue labelled ready-for-agent when its Source was read, at 2026-09-30T12:00:00Z",
        ),
    ];
    for (n, why) in cases {
        let ran = dispatch(&t, &[format!("acme/api#{n}").as_str()]);

        assert_eq!(ran.exit_code, 1);
        assert_eq!(
            ran.json(),
            json!({
                "error": format!("acme/api#{n} is not Ready"),
                "help": [why, "Run `nico-agent status` to see the Ready issues"],
            })
        );
    }
    assert!(!t.world.calls().iter().any(|c| !c.starts_with("github ")));
    assert!(
        !t.world
            .calls()
            .iter()
            .any(|c| c.starts_with("github assign"))
    );
}

#[test]
fn a_reference_to_no_configured_repo_or_no_issue_is_refused_before_any_call() {
    let t = with_issue();

    let unknown = dispatch(&t, &["acme/web#3"]);
    let malformed = dispatch(&t, &["api#7"]);

    assert_eq!(unknown.exit_code, 1);
    assert_eq!(
        unknown.json(),
        json!({
            "error": "acme/web is not a configured Repo",
            "help": ["Run `nico-agent repo add acme/web --path <clone>` first"],
        })
    );
    assert_eq!(malformed.exit_code, 2);
    assert_eq!(
        malformed.json()["error"],
        "`api#7` is not an issue reference"
    );
    assert!(t.world.calls().is_empty());
}

#[test]
fn dispatching_an_issue_in_flight_again_is_a_no_op_that_says_so() {
    let t = with_issue();
    dispatch_7(&t);
    t.world.calls.borrow_mut().clear();

    let again = dispatch(&t, &["ACME/api#7"]);

    assert_eq!(again.exit_code, 0);
    assert_eq!(
        again.json(),
        json!({
            "dispatched": "acme/api#7 already In flight (no-op)",
            "stage": "Implementing", "workspace": "w1", "agent": "impl-api-7",
        })
    );
    // Only whether its agent is still there: one gone is restarted.
    assert_eq!(t.world.calls(), ["herdr agent list"]);
}

#[test]
fn other_launch_flags_on_an_issue_in_flight_are_refused() {
    let t = with_issue();
    dispatch_7(&t);
    t.world.calls.borrow_mut().clear();

    let other = dispatch(&t, &["acme/api#7", "--model", "sonnet"]);

    assert_eq!(other.exit_code, 1);
    assert_eq!(
        other.json(),
        json!({
            "error": "acme/api#7 is already In flight with claude opus high",
            "help": ["Run `nico-agent status` to see the Dispatch"],
        })
    );
    assert!(t.world.calls().is_empty());
}

#[test]
fn a_failed_step_leaves_the_dispatch_failed_there_and_the_same_command_resumes_from_it() {
    let resumed_ready = [
        "herdr agent read impl-api-7 --source visible",
        "herdr agent wait impl-api-7 --until idle --until done --timeout 5000",
    ];
    type Change = fn(&common::FakeWorld);
    fn fail(w: &common::FakeWorld, call: &str) {
        w.fail_call(call, "it broke");
    }
    let cases: [(&str, Change, Change, Vec<&str>); 6] = [
        (
            "fetch",
            |w| fail(w, "git -C /src/api fetch"),
            |w| w.clear_failures(),
            ALL[4..].to_vec(),
        ),
        (
            "worktree",
            |w| fail(w, "herdr worktree create"),
            |w| w.clear_failures(),
            ALL[5..].to_vec(),
        ),
        (
            "tab",
            |w| fail(w, "herdr tab create"),
            |w| w.clear_failures(),
            ALL[6..].to_vec(),
        ),
        (
            "agent start",
            |w| fail(w, "herdr agent start"),
            |w| w.clear_failures(),
            ALL[7..].to_vec(),
        ),
        (
            "agent ready",
            |w| *w.blocked_screen.borrow_mut() = Some("Do you want to enable telemetry?".into()),
            |w| *w.blocked_screen.borrow_mut() = None,
            [&resumed_ready[..], &ALL[8..]].concat(),
        ),
        (
            "prompt",
            |w| w.stalled_prompts.set(3),
            |_| {},
            ALL[8..].to_vec(),
        ),
    ];
    for (step, break_it, heal, resumed) in cases {
        let t = with_issue();
        break_it(&t.world);

        let failed = dispatch_7(&t);

        assert_eq!(failed.exit_code, 1, "{step}");
        let failed = failed.json();
        let error = failed["error"].as_str().unwrap();
        assert!(
            error.starts_with(&format!("acme/api#7 failed at {step}: ")),
            "{error}"
        );
        let help = failed["help"].as_array().unwrap();
        assert_eq!(
            help[help.len() - 2..],
            [
                json!("Run `nico-agent status` to see the Dispatch"),
                json!(format!(
                    "Run the same `nico-agent dispatch` again to resume from {step}"
                )),
            ]
        );
        let shown = &status(&t)["dispatches"][0];
        assert_eq!(shown["stage"], "Failed");
        assert_eq!(shown["failure"]["step"], step);
        assert!(error.ends_with(shown["failure"]["error"].as_str().unwrap()));

        heal(&t.world);
        t.world.calls.borrow_mut().clear();
        let again = dispatch_7(&t);

        assert_eq!(again.exit_code, 0, "{}", again.stdout);
        assert_eq!(
            again.json()["dispatched"],
            format!("acme/api#7 (resumed from {step})")
        );
        assert_eq!(t.world.calls(), resumed, "{step}");
        let shown = &status(&t)["dispatches"][0];
        assert_eq!(shown["stage"], "Implementing");
        assert_eq!(shown["failure"], Value::Null);
        assert_eq!(shown["completed"].as_array().unwrap().len(), 7);
    }
}

#[test]
fn the_failure_of_a_step_says_what_to_do_about_it() {
    let t = with_issue();
    *t.world.blocked_screen.borrow_mut() = Some("Do you want to enable telemetry?".into());
    t.world.add_issue("acme/api", github_issue("acme/api", 8));

    let blocked = dispatch_7(&t);
    t.world.stalled_prompts.set(3);
    t.world.blocked_screen.take();
    let stalled = dispatch(&t, &["acme/api#8"]);

    assert_eq!(
        blocked.json()["help"][0],
        "Run `herdr agent read impl-api-7` to see what it is asking, and answer it in herdr"
    );
    assert_eq!(
        stalled.json(),
        json!({
            "error": "acme/api#8 failed at prompt: impl-api-8 did not start working on its prompt",
            "help": [
                "Run `herdr agent read impl-api-8` to see its screen, and send the prompt by hand",
                "Run `nico-agent status` to see the Dispatch",
                "Run the same `nico-agent dispatch` again to resume from prompt",
            ],
        })
    );
    let prompts = t
        .world
        .calls()
        .into_iter()
        .filter(|c| c.starts_with("herdr agent prompt impl-api-8"));
    assert_eq!(prompts.count(), 3);
}

#[test]
fn claudes_trust_question_for_the_new_worktree_is_answered_before_the_prompt() {
    let t = with_issue();
    let screen = " Accessing workspace:\n\n /worktrees/\napi-7\n\n Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder";
    *t.world.blocked_screen.borrow_mut() = Some(screen.into());

    let ran = dispatch_7(&t);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        t.world.calls()[7..],
        [
            "herdr agent start impl-api-7 --kind claude --pane w1:p2 -- --model opus --effort high",
            "herdr agent read impl-api-7 --source visible",
            "herdr agent send-keys impl-api-7 down enter",
            "herdr agent wait impl-api-7 --until idle --until done --timeout 30000",
            "github app repos",
            "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main",
        ]
    );
}

#[test]
fn a_failed_claim_is_a_warning_on_the_record_not_a_failure_and_is_not_retried() {
    let t = with_issue();
    t.world.fail_call("github assign", "GitHub request failed");

    let ran = dispatch_7(&t);
    t.world.clear_failures();
    t.world.calls.borrow_mut().clear();
    let again = dispatch_7(&t);

    let warning =
        "could not Claim acme/api#7: GitHub request failed; assign it to yourself by hand";
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        ran.json(),
        json!({
            "dispatched": "acme/api#7", "stage": "Implementing", "workspace": "w1", "agent": "impl-api-7",
            "warnings": [warning],
        })
    );
    let shown = &status(&t)["dispatches"][0];
    assert_eq!(shown["claimed"], false);
    assert_eq!(shown["warnings"], json!([warning]));
    assert_eq!(
        again.json()["dispatched"],
        "acme/api#7 already In flight (no-op)"
    );
    assert!(
        t.world
            .calls()
            .iter()
            .all(|c| !c.starts_with("github assign"))
    );
}

const BOT_SUFFIX: &str = ", opened with `ghbot pr create` (not `gh`); end every commit message with the trailer `Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>`";

fn prompts(t: &Setup) -> Vec<String> {
    let calls = t.world.calls();
    calls
        .into_iter()
        .filter(|c| c.starts_with("herdr agent prompt"))
        .collect()
}

#[test]
fn the_prompt_has_the_bot_suffix_only_when_the_github_app_is_installed_on_the_repo() {
    let installed = with_issue();
    installed
        .world
        .app_repos
        .borrow_mut()
        .push("Acme/API".into());
    let unchecked = with_issue();
    unchecked.world.fail_call(
        "github app repos",
        "`ghbot` is not installed or not on PATH",
    );

    dispatch_7(&installed);
    let ran = dispatch_7(&unchecked);

    let plain = "herdr agent prompt impl-api-7 /implement https://github.com/acme/api/issues/7 as draft PR against main";
    assert_eq!(prompts(&installed), [format!("{plain}{BOT_SUFFIX}")]);
    assert_eq!(prompts(&unchecked), [plain]);
    assert_eq!(
        ran.json()["warnings"],
        json!([
            "could not check the GitHub App on acme/api, so the prompt has no bot suffix: `ghbot` is not installed or not on PATH"
        ])
    );
}

#[test]
fn a_research_issue_is_sent_the_research_prompt() {
    let t = with_issue();
    let mut research = github_issue("acme/api", 8);
    research.labels.push("research".into());
    t.world.add_issue("acme/api", research);
    t.world.app_repos.borrow_mut().push("acme/api".into());

    dispatch(&t, &["acme/api#8"]);

    assert_eq!(
        prompts(&t),
        [format!(
            "herdr agent prompt impl-api-8 /research https://github.com/acme/api/issues/8; write the findings with sources to one Markdown file under docs/research/ and open it as a draft PR against main{BOT_SUFFIX}"
        )]
    );
    assert_eq!(status(&t)["dispatches"][0]["research"], true);
}

#[test]
fn opencode_runs_in_the_pane_with_its_model_and_effort_and_is_named_once_herdr_sees_it() {
    let t = with_issue();
    let model = "opencode-go/deepseek-v4";

    let ran = dispatch(
        &t,
        &[
            "acme/api#7",
            "--harness",
            "opencode",
            "--model",
            model,
            "--effort",
            "high",
        ],
    );

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let config =
        format!(r#"{{"agents":{{"build":{{"model":"{model}#high"}}}},"model":"{model}#high"}}"#);
    assert_eq!(
        t.world.calls()[7..],
        [
            format!("opencode variant ~/.local/state/opencode/model.json {model} high"),
            format!("herdr pane run w1:p2 env OPENCODE_CONFIG_CONTENT='{config}' opencode2 --standalone"),
            "herdr agent detect w1:p2 --timeout 30000".into(),
            "herdr agent rename w1:p2 impl-api-7".into(),
            "herdr agent read impl-api-7 --source visible".into(),
            "herdr agent wait impl-api-7 --until idle --until done --timeout 5000".into(),
            "github app repos".into(),
            "herdr agent prompt impl-api-7 @implement https://github.com/acme/api/issues/7 as draft PR against main".into(),
        ]
    );
}

#[test]
fn a_linear_issue_is_dispatched_into_the_repo_that_claims_it_on_linears_branch() {
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
    ]);
    t.world.add_linear_issue(common::linear_issue("BLE-1"));
    t.world.calls.borrow_mut().clear();

    let ran = dispatch(&t, &[&["ble-1"], &FLAGS[..]].concat());

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["agent"], "impl-api-ble-1");
    assert_eq!(
        t.world.calls(),
        [
            "github viewer",
            "github issues acme/api",
            "linear viewer",
            "linear issues BLE",
            "git -C /src/api default-branch",
            "linear assign BLE-1",
            "git -C /src/api fetch origin",
            "herdr worktree create --cwd /src/api --branch nico/ble-1 --base origin/main --label api:BLE-1 --no-focus",
            "herdr tab create --workspace w1 --cwd /worktrees/ble-1 --label implementer --no-focus",
            "herdr agent start impl-api-ble-1 --kind claude --pane w1:p2 -- --model opus --effort high",
            "github app repos",
            "herdr agent prompt impl-api-ble-1 /implement https://linear.app/bleentr/issue/BLE-1/title as draft PR against main",
        ]
    );
    assert_eq!(status(&t)["dispatches"][0]["issue"], "BLE-1");
}

/// Change the Dispatch of `acme/api#7` in `dispatches.json`, as another process would.
fn edit_dispatch(t: &Setup, change: impl FnOnce(&mut Value)) {
    let file = t.config_dir.join("dispatches.json");
    let mut all: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    change(&mut all[0]);
    std::fs::write(&file, all.to_string()).unwrap();
}

#[test]
fn a_dispatch_another_live_process_runs_is_left_to_it_until_that_process_is_gone() {
    let t = with_issue();
    t.world.fail_call("herdr tab create", "it broke");
    dispatch_7(&t);
    t.world.clear_failures();
    // Process 5000 took it over and is opening the tab.
    edit_dispatch(&t, |d| {
        d["runner"] = json!(5000);
        d["failure"] = Value::Null;
    });
    t.world.calls.borrow_mut().clear();

    let during = dispatch_7(&t);
    t.world.dead_pids.borrow_mut().push(5000);
    let after = dispatch_7(&t);

    assert_eq!(
        during.json()["dispatched"],
        "acme/api#7 already In flight (no-op)"
    );
    assert_eq!(after.json()["dispatched"], "acme/api#7 (resumed from tab)");
    assert_eq!(t.world.calls(), ALL[6..]);
}

#[test]
fn several_issues_are_dispatched_in_turn_and_one_refused_leaves_the_rest_dispatched() {
    let t = with_issue();
    t.world.add_issue("acme/api", github_issue("acme/api", 8));

    let both = dispatch(&t, &["acme/api#7", "acme/api#8"]);
    let refused = dispatch(&t, &["acme/api#7", "acme/api#9"]);

    assert_eq!(both.exit_code, 0, "{}", both.stdout);
    let dispatched = &both.json()["dispatched"];
    assert_eq!(dispatched[0]["dispatched"], "acme/api#7");
    assert_eq!(dispatched[1]["dispatched"], "acme/api#8");
    assert_eq!(refused.exit_code, 1);
    assert_eq!(
        refused.json(),
        json!({
            "error": "1 of 2 issues not dispatched",
            "help": [
                "acme/api#9: acme/api#9 is not Ready",
                "acme/api#9 was not an open issue labelled ready-for-agent when its Source was read, at 2026-09-30T12:00:00Z",
                "Run `nico-agent status` to see the Ready issues",
            ],
        })
    );
}

fn status(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()
}

#[test]
fn status_shows_the_dispatch_implementing_with_its_launch_and_steps() {
    let t = with_issue();
    t.world.add_issue("acme/api", github_issue("acme/api", 8));
    dispatch_7(&t);

    let status = status(&t);

    assert_eq!(
        status["dispatches"],
        json!([{
            "issue": "acme/api#7",
            "title": "Issue 7",
            "url": "https://github.com/acme/api/issues/7",
            "repo": "acme/api",
            "branch": "agent/api-7",
            "base": "main",
            "worktree": "/worktrees/api-7",
            "workspace": "w1",
            "pr": null,
            "implementer": {
                "agent": "impl-api-7", "harness": "claude", "model": "opus", "effort": "high",
                "tab": "w1:t2", "pane": "w1:p2",
            },
            "reviewer": null,
            "research": false,
            "asking": null,
            "completed": ["claim", "fetch", "worktree", "tab", "agent start", "agent ready", "prompt"],
            "failure": null,
            "claimed": true,
            "warnings": [],
            "restarts": [],
            "created_at": "2026-09-30T12:00:00Z",
            "updated_at": "2026-09-30T12:00:00Z",
            "closed_at": null,
            "stage": "Implementing",
            "verdict": null,
        }])
    );
    let ready: Vec<&str> = (status["repos"][0]["ready"].as_array().unwrap().iter())
        .map(|row| row["key"].as_str().unwrap())
        .collect();
    assert_eq!(ready, ["acme/api#8"]);
}
