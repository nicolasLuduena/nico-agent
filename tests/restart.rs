mod common;

use std::time::Duration;

use common::{KIT, KIT_TOML, Setup, edit_dispatch, github_issue, kit_built, pull_request, setup};
use nico_agent::world::PullRequest;
use serde_json::{Value, json};

const TICK: Duration = Duration::from_secs(600);

/// Repo `acme/api` with each of `issues` dispatched by a tick, its agents
/// working, and no calls recorded yet.
fn dispatched(issues: &[u64]) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    for &n in issues {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

/// herdr reports `agent` in Agent `state`.
fn agent_is(t: &Setup, agent: &str, state: &str) {
    t.world
        .agents
        .borrow_mut()
        .insert(agent.into(), state.into());
}

/// Run a tick a tick later: what it said, and the herdr calls it made.
fn next_tick(t: &Setup) -> (Vec<String>, Vec<String>) {
    t.world.advance(TICK);
    t.world.calls.borrow_mut().clear();
    let said = t.tick();
    let herdr = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("herdr "))
        .collect();
    (said, herdr)
}

const PREFIX_1: &str = "You are continuing https://github.com/acme/api/issues/1 on branch agent/api-1 in this worktree. Read git status, git log and the PR (none yet) first.";

#[test]
fn an_implementer_idle_for_stall_minutes_with_no_pr_is_restarted_in_a_new_tab_with_the_stalled_prompt()
 {
    let t = dispatched(&[1]);
    agent_is(&t, "impl-api-1", "idle");

    let seen = next_tick(&t);
    let ten_minutes = next_tick(&t);
    let twenty_minutes = next_tick(&t);

    assert_eq!(seen, (vec![], vec!["herdr agent list".into()]));
    assert_eq!(ten_minutes, seen);
    assert_eq!(twenty_minutes.0, ["acme/api#1 restarted: stalled"]);
    assert_eq!(
        twenty_minutes.1,
        [
            "herdr agent list".to_string(),
            "herdr tab close w1:t2".into(),
            "herdr tab create --workspace w1 --cwd /worktrees/api-1 --label implementer --no-focus"
                .into(),
            "herdr agent start impl-api-1 --kind claude --pane w1:p3 -- ".into(),
            format!(
                "herdr agent prompt impl-api-1 {PREFIX_1} You stopped with no PR open. Continue to a draft PR."
            ),
        ]
    );
}

#[test]
fn a_restarted_implementer_of_a_repo_linking_a_built_library_version_starts_with_its_wiki_mcp_and_asks_it_first()
 {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\nlibraries = [{KIT_TOML}]\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    kit_built(&t);
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    t.tick();
    agent_is(&t, "impl-api-1", "idle");

    let (said, herdr) = (0..3).map(|_| next_tick(&t)).last().unwrap();

    assert_eq!(said, ["acme/api#1 restarted: stalled"]);
    assert_eq!(
        herdr[3..],
        [
            r#"herdr agent start impl-api-1 --kind claude --pane w1:p3 -- --mcp-config {"mcpServers":{"wiki":{"command":"nico-agent","args":["mcp","--wiki","acme/kit@v1"]}}} --allowedTools mcp__wiki__*"#.to_string(),
            format!(
                "herdr agent prompt impl-api-1 {PREFIX_1} You stopped with no PR open. Continue to a draft PR. Ask the wiki MCP about {KIT} before reading their source."
            ),
        ]
    );
}

/// The Implementer of `issue` goes idle and three ticks pass: what they said.
fn stall(t: &Setup, issue: u64) -> Vec<String> {
    agent_is(t, &format!("impl-api-{issue}"), "idle");
    (0..3).flat_map(|_| next_tick(t).0).collect()
}

fn status(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()
}

#[test]
fn the_third_stall_marks_the_dispatch_failed_notifies_once_and_it_is_never_restarted_again() {
    let t = dispatched(&[1]);

    let said: Vec<Vec<String>> = (0..4).map(|_| stall(&t, 1)).collect();

    assert_eq!(
        said,
        [
            vec!["acme/api#1 restarted: stalled"],
            vec!["acme/api#1 restarted: stalled"],
            vec!["acme/api#1 Failed: stalled again after 2 restarts for it"],
            vec![],
        ]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#1 Failed".to_string(),
            "restart: stalled again after 2 restarts for it".to_string()
        )]
    );
    let shown = &status(&t)["dispatches"][0];
    assert_eq!(shown["stage"], "Failed");
    assert_eq!(
        shown["failure"],
        json!({ "step": "restart", "error": "stalled again after 2 restarts for it", "reason": "stalled" })
    );
    assert_eq!(
        shown["restarts"],
        json!([
            { "at": "2026-09-30T12:30:00Z", "reason": "stalled", "by": "loop" },
            { "at": "2026-09-30T13:00:00Z", "reason": "stalled", "by": "loop" },
        ])
    );
}

#[test]
fn a_reviewer_set_while_the_implementer_restarts_survives_the_restart() {
    let t = dispatched(&[1]);
    let reviewer = json!({
        "agent": "rev-api-1", "harness": "codex", "model": null, "effort": null,
        "tab": "w1:t3", "pane": "w1:p4", "sha": "sha1",
    });
    let (dir, set) = (t.config_dir.clone(), reviewer.clone());
    t.world
        .during_call("herdr agent prompt impl-api-1", move || {
            edit_dispatch(&dir, |d| d["reviewer"] = set.clone())
        });

    let said = stall(&t, 1);

    assert_eq!(said, ["acme/api#1 restarted: stalled"]);
    let shown = &status(&t)["dispatches"][0];
    assert_eq!(
        (&shown["reviewer"], &shown["restarts"]),
        (
            &reviewer,
            &json!([{ "at": "2026-09-30T12:30:00Z", "reason": "stalled", "by": "loop" }])
        )
    );
}

#[test]
fn serve_on_start_restarts_exactly_the_dispatches_whose_agents_are_gone_as_rebooted() {
    let t = dispatched(&[1, 2]);
    // The machine restarted: herdr is back, impl-api-1 is not.
    t.world.agents.borrow_mut().remove("impl-api-1");

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        t.world.logged(),
        ["2026-09-30T12:00:00Z acme/api#1 restarted: rebooted"]
    );
    let herdr: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("herdr "))
        .collect();
    assert_eq!(
        herdr,
        [
            "herdr agent list".to_string(),
            "herdr tab close w1:t2".into(),
            "herdr tab create --workspace w1 --cwd /worktrees/api-1 --label implementer --no-focus"
                .into(),
            "herdr agent start impl-api-1 --kind claude --pane w1:p3 -- ".into(),
            format!(
                "herdr agent prompt impl-api-1 {PREFIX_1} The machine restarted. Continue where the branch left off."
            ),
        ]
    );
}

#[test]
fn herdr_not_answering_is_said_and_never_read_as_every_agent_gone() {
    let t = dispatched(&[1]);
    t.world.fail_call(
        "herdr agent list",
        "`herdr` is not installed or not on PATH",
    );

    let (said, herdr) = next_tick(&t);

    assert_eq!(
        said,
        ["could not list herdr's agents: `herdr` is not installed or not on PATH"]
    );
    assert_eq!(herdr, ["herdr agent list"]);
}

#[test]
fn with_restart_off_no_agent_is_restarted() {
    let t = dispatched(&[1]);
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, format!("{config}switches = {{ restart = false }}\n")).unwrap();
    t.world.agents.borrow_mut().clear();

    let (said, herdr) = next_tick(&t);

    // The list is Asking's.
    assert_eq!((said, herdr), (vec![], vec!["herdr agent list".into()]));
}

#[test]
fn dispatch_by_hand_restarts_a_dispatch_whose_agent_is_gone_as_manual_with_restart_off_and_never_counts()
 {
    let t = dispatched(&[1]);
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, format!("{config}switches = {{ restart = false }}\n")).unwrap();

    let answers: Vec<Value> = (0..3)
        .map(|_| {
            t.world.agents.borrow_mut().clear();
            t.cli(&["dispatch", "acme/api#1", "--json"]).json()
        })
        .collect();

    let restarted = json!({
        "dispatched": "acme/api#1 (restarted)",
        "stage": "Implementing", "workspace": "w1", "agent": "impl-api-1",
    });
    assert_eq!(answers, [restarted.clone(), restarted.clone(), restarted]);
    let shown = &status(&t)["dispatches"][0];
    let by: Vec<(&Value, &Value)> = (shown["restarts"].as_array().unwrap().iter())
        .map(|r| (&r["reason"], &r["by"]))
        .collect();
    assert_eq!(by, [(&json!("manual"), &json!("user")); 3]);
    assert_eq!(shown["failure"], Value::Null);
    let calls = t.world.calls();
    assert_eq!(
        (calls.iter().rev())
            .find(|c| c.starts_with("herdr agent prompt "))
            .unwrap(),
        &format!(
            "herdr agent prompt impl-api-1 {PREFIX_1} The machine restarted. Continue where the branch left off."
        )
    );
}

#[test]
fn a_restart_that_fails_at_a_step_leaves_the_dispatch_failed_with_one_notification() {
    let t = dispatched(&[1]);
    t.world.agents.borrow_mut().clear();
    t.world
        .fail_call("herdr tab create", "workspace_not_found: w1 not found");

    let failed = next_tick(&t).0;
    let after = next_tick(&t);

    assert_eq!(
        failed,
        ["acme/api#1 failed at tab of its rebooted restart: workspace_not_found: w1 not found"]
    );
    assert_eq!(after, (vec![], vec!["herdr agent list".into()]));
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#1 Failed".to_string(),
            "tab: workspace_not_found: w1 not found".to_string()
        )]
    );
    let shown = &status(&t)["dispatches"][0];
    assert_eq!(shown["stage"], "Failed");
    assert_eq!(shown["failure"]["reason"], "rebooted");
}

#[test]
fn a_dispatch_the_loop_starts_that_fails_at_a_step_notifies_once() {
    let t = dispatched(&[]);
    t.world.add_issue("acme/api", github_issue("acme/api", 1));
    t.world.fail_call("herdr worktree create", "it broke");

    let failed = next_tick(&t).0;
    let after = next_tick(&t).0;

    assert_eq!(failed, ["acme/api#1 failed at worktree: it broke"]);
    assert_eq!(after, Vec::<String>::new());
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#1 Failed".to_string(),
            "worktree: it broke".to_string()
        )]
    );
}

#[test]
fn done_counts_as_idle_but_an_asking_implementer_or_one_with_a_pr_never_stalls() {
    let t = dispatched(&[1, 2, 3]);
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-2".into()),
        ..pull_request("acme/api", 12)
    });
    agent_is(&t, "impl-api-1", "blocked");
    agent_is(&t, "impl-api-2", "idle");
    agent_is(&t, "impl-api-3", "done");

    let said: Vec<Vec<String>> = (0..4).map(|_| next_tick(&t).0).collect();

    assert_eq!(
        said,
        [
            vec![
                "acme/api#2: PR https://github.com/acme/api/pull/12 found",
                "acme/api#2: Reviewer started on codex for sha12",
                "acme/api#1 is Asking: \"\"",
            ],
            vec![],
            vec!["acme/api#3 restarted: stalled"],
            vec![],
        ]
    );
    // Asking past stall_minutes, and still never restarted.
    let asking = &status(&t)["dispatches"][0];
    assert_eq!(asking["asking"]["since"], "2026-09-30T12:10:00Z");
    assert_eq!(asking["restarts"], json!([]));
}

#[test]
fn while_github_is_paused_none_is_restarted_as_stalled_but_one_whose_agent_is_gone_is() {
    let t = dispatched(&[1, 2]);
    agent_is(&t, "impl-api-1", "idle");
    let limited = "GitHub rate limit exceeded; nico-agent asks it again at 2026-09-30T13:00:00Z";
    t.world.fail_call("github issues", limited);
    // Its PR appears while GitHub is paused, so the loop can't see it.
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-1".into()),
        ..pull_request("acme/api", 11)
    });

    let mut said: Vec<String> = (0..4).flat_map(|_| next_tick(&t).0).collect();
    t.world.agents.borrow_mut().remove("impl-api-2");
    said.extend(next_tick(&t).0);
    t.world.clear_failures();
    said.extend(next_tick(&t).0);

    let restarted: Vec<&String> = (said.iter())
        .filter(|line| line.contains(" restarted: "))
        .collect();
    assert_eq!(restarted, ["acme/api#2 restarted: rebooted"]);
    let found = "acme/api#1: PR https://github.com/acme/api/pull/11 found";
    assert!(said.iter().any(|line| line == found), "{said:#?}");
}

#[test]
fn an_implementer_whose_pr_could_not_be_looked_for_is_never_restarted_as_stalled() {
    let t = dispatched(&[1]);
    agent_is(&t, "impl-api-1", "idle");
    let down = "GitHub request failed; check your network and `gh auth status`";
    t.world.fail_call("github branch prs", down);
    // Its PR appears while GitHub can't be asked for it.
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-1".into()),
        ..pull_request("acme/api", 11)
    });

    let mut said: Vec<String> = (0..4).flat_map(|_| next_tick(&t).0).collect();
    t.world.clear_failures();
    said.extend(next_tick(&t).0);

    let restarted: Vec<&String> = (said.iter())
        .filter(|line| line.contains(" restarted: "))
        .collect();
    assert_eq!(restarted, Vec::<&String>::new());
    let found = "acme/api#1: PR https://github.com/acme/api/pull/11 found";
    assert!(said.iter().any(|line| line == found), "{said:#?}");
}

#[test]
fn an_implementer_seen_working_again_starts_its_stall_over() {
    let t = dispatched(&[1]);
    agent_is(&t, "impl-api-1", "idle");
    next_tick(&t);
    next_tick(&t);
    agent_is(&t, "impl-api-1", "working");
    next_tick(&t);
    agent_is(&t, "impl-api-1", "idle");

    let said: Vec<Vec<String>> = (0..3).map(|_| next_tick(&t).0).collect();

    assert_eq!(
        said,
        [vec![], vec![], vec!["acme/api#1 restarted: stalled"]]
    );
}
