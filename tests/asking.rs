mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::PrState;
use serde_json::{Value, json};

const MINUTE: Duration = Duration::from_secs(60);

/// Repo `acme/api` with issue 7 dispatched by hand, its Implementer `impl-api-7` working.
fn dispatched() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    let ran = t.cli(&["dispatch", "acme/api#7"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    t
}

/// herdr reports `impl-api-7` in `state`.
fn agent_state(t: &Setup, state: &str) {
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), state.into());
}

/// herdr reports `impl-api-7` blocked, its pane showing `screen`.
fn blocked(t: &Setup, screen: &str) {
    agent_state(t, "blocked");
    (t.world.screens.borrow_mut()).insert("impl-api-7".into(), screen.into());
}

/// What `status --json` shows of issue 7's Asking.
fn asking(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()["dispatches"][0]["asking"].clone()
}

#[test]
fn asking_shows_in_status_while_herdr_reports_the_implementer_blocked() {
    let t = dispatched();
    t.tick();
    let before = asking(&t);
    blocked(
        &t,
        "Should I keep the old endpoint?\n╭───╮\n│ > │\n╰───╯\n  ? for shortcuts",
    );
    t.world.advance(MINUTE);
    let said = t.tick();
    let during = asking(&t);
    agent_state(&t, "working");
    t.world.advance(MINUTE);
    t.tick();
    let after = asking(&t);

    assert_eq!(before, Value::Null);
    assert_eq!(
        said,
        [r#"acme/api#7 is Asking: "Should I keep the old endpoint?""#]
    );
    assert_eq!(
        during,
        json!({"since": "2026-09-30T12:01:00Z", "question": "Should I keep the old endpoint?"})
    );
    assert_eq!(after, Value::Null);
}

#[test]
fn an_asking_stays_while_herdr_cannot_tell_and_what_failed_is_said() {
    let t = dispatched();
    blocked(&t, "Which database?");
    t.world
        .fail_call("herdr agent read", "pane_not_found: impl-api-7");
    t.world
        .fail_call("notify", "`notify-send` failed: no session bus");
    let first = t.tick();
    let unread = asking(&t);
    t.world.clear_failures();
    t.world
        .fail_call("herdr agent list", "herdr is not running");
    t.world.advance(MINUTE);
    let down = t.tick();
    t.world.clear_failures();
    agent_state(&t, "unknown");
    let unknown = t.tick();

    assert_eq!(
        first,
        [
            "could not read the question of acme/api#7: pane_not_found: impl-api-7",
            r#"acme/api#7 is Asking: """#,
            r#"could not notify "acme/api#7 is Asking": `notify-send` failed: no session bus"#,
        ]
    );
    assert_eq!(
        unread,
        json!({"since": "2026-09-30T12:00:00Z", "question": ""})
    );
    assert_eq!(
        down,
        ["could not list herdr's agents: herdr is not running"]
    );
    assert_eq!(unknown, Vec::<String>::new());
    assert_eq!(asking(&t), unread);
}

#[test]
fn a_closed_dispatch_is_not_asking() {
    let t = dispatched();
    blocked(&t, "Which database?");
    t.tick();
    let mut pr = pull_request("acme/api", 9);
    pr.head_branch = Some("agent/api-7".into());
    t.world.add_pr(pr);
    t.tick();
    t.world.prs.borrow_mut()[0].state = PrState::Merged;

    let said = t.tick();

    assert_eq!(
        said,
        ["acme/api#7 Closed: its PR https://github.com/acme/api/pull/9 merged"]
    );
    assert_eq!(asking(&t), Value::Null);
}

#[test]
fn the_question_is_the_panes_last_meaningful_line() {
    // main's test/screen-line.test.ts, case for case.
    let cases = [
        ("$ bun test\n 3 pass\n 1 fail  \n\n   \n", "1 fail"),
        (
            "⏺ Update(src/peek.ts)\n  ⎿  Updated src/peek.ts with 4 additions\n\n╭───╮\n│ >   │\n╰───╯\n  ? for shortcuts",
            "⎿  Updated src/peek.ts with 4 additions",
        ),
        ("Wrote 3 files\n› \n", "Wrote 3 files"),
        ("All tests pass\n$\n❯ ", "All tests pass"),
        (
            "⏺ Running the tests\n\n✻ Thinking… (12s · ↑ 1.2k tokens · esc to interrupt)\n",
            "⏺ Running the tests",
        ),
        (
            "Edited src/web.ts\n⠹ Working (3s • esc to interrupt)",
            "Edited src/web.ts",
        ),
        ("Reading files\n· Pondering…", "Reading files"),
        (
            "Edited src/web.ts\n╭─╮\n│ > │\n╰─╯\n  ⏵⏵ accept edits on (shift+tab to cycle)",
            "Edited src/web.ts",
        ),
        (
            "Ran bun test\n  Context left until auto-compact: 12%",
            "Ran bun test",
        ),
        (
            "Changed:\n· src/web.ts and src/peek.ts",
            "· src/web.ts and src/peek.ts",
        ),
        ("\n╭───╮\n│ > │\n╰───╯\n✳ Booping…\n", ""),
        ("", ""),
        ("Plan:\n- add the route\n* test it", "* test it"),
        (
            "│ Do you want to make this edit to peek.ts? │\n╰────╯",
            "Do you want to make this edit to peek.ts?",
        ),
    ];
    let t = dispatched();

    for (screen, line) in cases {
        blocked(&t, screen);
        t.tick();
        assert_eq!(asking(&t)["question"], line, "{screen:?}");
        agent_state(&t, "working");
        t.tick();
    }
}

#[test]
fn serve_notifies_once_per_asking_naming_the_issue_and_quoting_the_question() {
    let t = dispatched();
    blocked(&t, "Which database should the cache use?");
    // Three ticks while it waits, then it is answered and asks again.
    t.world.timer_runs.set(2);
    t.cli(&["serve"]);
    agent_state(&t, "working");
    t.tick();
    blocked(&t, "Port 8080 is taken; use 8081?");
    t.tick();
    t.tick();

    assert_eq!(
        *t.world.notifications.borrow(),
        [
            (
                "acme/api#7 is Asking".to_string(),
                "\"Which database should the cache use?\"\nAnswer it in herdr: agent impl-api-7."
                    .to_string()
            ),
            (
                "acme/api#7 is Asking".to_string(),
                "\"Port 8080 is taken; use 8081?\"\nAnswer it in herdr: agent impl-api-7."
                    .to_string()
            ),
        ]
    );
    let reads = (t.world.calls().into_iter()).filter(|c| c.starts_with("herdr agent read"));
    assert_eq!(reads.count(), 2, "a quiet tick reads no pane");
}
