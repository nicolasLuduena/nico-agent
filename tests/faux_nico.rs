mod common;

use std::time::Duration;

use common::{Setup, github_issue, setup};
use serde_json::{Value, json};

const TICK: Duration = Duration::from_secs(600);

const ANSWER_ON: &str = "switches = { answer = true }";

/// The faux-nico prompt for issue 7's question, on claude.
const PROMPT: &str = r#"herdr agent prompt faux-nico-api-7 /faux-nico https://github.com/acme/api/issues/7: the Implementer asks "Should I keep the old endpoint?". Read PRODUCT.md, the issue and its parent. Answer with nico-agent answer acme/api#7 --text "..." --by faux-nico only when they settle it; otherwise end your turn without answering."#;

/// Repo `acme/api`, as `toml` sets it, with issue 7 dispatched by a tick, and a tick later.
fn dispatched(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    assert_eq!(t.tick(), ["acme/api#7 dispatched"]);
    t.world.advance(TICK);
    t
}

/// herdr reports `name` in `state`.
fn agent_state(t: &Setup, name: &str, state: &str) {
    (t.world.agents.borrow_mut()).insert(name.into(), state.into());
}

/// herdr reports `impl-api-7` blocked on "Should I keep the old endpoint?".
fn ask(t: &Setup) {
    agent_state(t, "impl-api-7", "blocked");
    (t.world.screens.borrow_mut()).insert(
        "impl-api-7".into(),
        "Should I keep the old endpoint?".into(),
    );
}

/// `dispatched` with `answer` on, and the tick that sees issue 7 Asking and
/// starts its faux-nico; a tick later.
fn faux_nico_working() -> Setup {
    let t = dispatched(ANSWER_ON);
    ask(&t);
    t.tick();
    t.world.advance(TICK);
    t
}

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// What git and herdr were told to do: their calls but the read of every agent.
fn git_and_herdr(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| (c.starts_with("herdr ") || c.starts_with("git ")) && *c != "herdr agent list")
        .map(String::as_str)
        .collect()
}

/// What `status --json` shows of issue 7's faux-nico.
fn faux_nico(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()["dispatches"][0]["faux_nico"].clone()
}

#[test]
fn a_new_asking_starts_one_faux_nico_in_a_worktree_at_the_base_with_its_prompt() {
    let t = dispatched(ANSWER_ON);
    ask(&t);

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        [
            r#"acme/api#7 is Asking: "Should I keep the old endpoint?""#,
            "acme/api#7: faux-nico started on claude",
        ]
    );
    assert_eq!(
        git_and_herdr(&calls),
        [
            "herdr agent read impl-api-7 --source visible",
            "git -C /src/api fetch origin",
            "herdr worktree create --cwd /src/api --branch faux-nico-api-7-20260930121000 --base origin/main --label faux-nico-api-7 --no-focus",
            "herdr tab create --workspace w2 --cwd /worktrees/faux-nico-api-7-20260930121000 --label faux-nico --no-focus",
            "herdr agent start faux-nico-api-7 --kind claude --pane w2:p2 -- ",
            PROMPT,
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(git_and_herdr(&later), Vec::<&str>::new());
    assert_eq!(*t.world.notifications.borrow(), []);
    assert_eq!(
        faux_nico(&t),
        json!({
            "trigger": "faux-nico", "repo": "acme/api", "at": "2026-09-30T12:10:00Z",
            "agent": "faux-nico-api-7", "harness": "claude", "model": null, "effort": null,
            "tab": "w2:t2", "pane": "w2:p2",
            "workspace": "w2", "worktree": "/worktrees/faux-nico-api-7-20260930121000",
            "closed_at": null,
            "issue": "acme/api#7", "asking": "2026-09-30T12:10:00Z",
        })
    );
}

#[test]
fn with_answer_off_nothing_starts_and_the_user_is_told_of_the_asking() {
    let t = dispatched("");
    ask(&t);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        [r#"acme/api#7 is Asking: "Should I keep the old endpoint?""#]
    );
    assert_eq!(
        git_and_herdr(&calls),
        ["herdr agent read impl-api-7 --source visible"]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#7 is Asking".to_string(),
            "\"Should I keep the old endpoint?\"\nAnswer it in herdr: agent impl-api-7."
                .to_string()
        )]
    );
    assert_eq!(faux_nico(&t), Value::Null);
}

#[test]
fn a_faux_nico_that_fails_to_start_is_not_started_again_and_the_user_is_told() {
    let t = dispatched(ANSWER_ON);
    ask(&t);
    t.world.fail_call(
        "herdr agent start faux-nico-api-7",
        "agent_name_taken: faux-nico-api-7",
    );

    let said = t.tick();
    t.world.clear_failures();
    t.world.advance(TICK);
    let (next, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        [
            r#"acme/api#7 is Asking: "Should I keep the old endpoint?""#,
            "could not start the faux-nico of acme/api#7: agent_name_taken: faux-nico-api-7",
        ]
    );
    assert_eq!(
        next,
        [
            "faux-nico-api-7 ended; its workspace closed",
            "acme/api#7: faux-nico left its Asking to the user",
        ]
    );
    assert_eq!(
        git_and_herdr(&calls),
        [
            "herdr worktree remove --workspace w2",
            "herdr workspace close w2",
        ]
    );
    assert_eq!(t.world.notifications.borrow().len(), 1);
}

#[test]
fn faux_nico_ending_with_the_implementer_still_asking_tells_the_user_once_and_is_closed() {
    let t = faux_nico_working();
    agent_state(&t, "faux-nico-api-7", "idle");

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let again = t.tick();

    assert_eq!(
        said,
        [
            "faux-nico-api-7 ended; its workspace closed",
            "acme/api#7: faux-nico left its Asking to the user",
        ]
    );
    assert_eq!(
        git_and_herdr(&calls),
        [
            "herdr worktree remove --workspace w2",
            "herdr workspace close w2",
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#7 is Asking".to_string(),
            "\"Should I keep the old endpoint?\"\nAnswer it in herdr: agent impl-api-7."
                .to_string()
        )]
    );
    let run = faux_nico(&t);
    assert_eq!(
        (&run["passed"], &run["closed_at"]),
        (&json!(true), &json!("2026-09-30T12:20:00Z"))
    );
}

#[test]
fn a_blocked_faux_nico_stays_open_and_tells_the_user_once_with_the_question() {
    let t = faux_nico_working();
    agent_state(&t, "faux-nico-api-7", "blocked");

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let again = t.tick();

    assert_eq!(said, ["faux-nico-api-7 is blocked"]);
    assert_eq!(git_and_herdr(&calls), Vec::<&str>::new());
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "faux-nico of acme/api#7 is blocked".to_string(),
            "\"Should I keep the old endpoint?\"\nAnswer it with nico-agent answer acme/api#7.\nTake it over: herdr agent read faux-nico-api-7."
                .to_string()
        )]
    );
    let run = faux_nico(&t);
    assert_eq!(
        (&run["blocked_since"], &run["closed_at"]),
        (&json!("2026-09-30T12:20:00Z"), &Value::Null)
    );
}

#[test]
fn a_blocked_faux_nico_then_seen_idle_is_closed_and_passes_its_asking_to_the_user() {
    let t = faux_nico_working();
    agent_state(&t, "faux-nico-api-7", "blocked");
    t.tick();
    t.world.advance(TICK);
    agent_state(&t, "faux-nico-api-7", "idle");

    let said = t.tick();

    assert_eq!(
        said,
        [
            "faux-nico-api-7 ended; its workspace closed",
            "acme/api#7: faux-nico left its Asking to the user",
        ]
    );
    let titles: Vec<String> = (t.world.notifications.borrow().iter())
        .map(|(title, _)| title.clone())
        .collect();
    assert_eq!(
        titles,
        ["faux-nico of acme/api#7 is blocked", "acme/api#7 is Asking"]
    );
    let run = faux_nico(&t);
    assert_eq!(
        (&run["passed"], &run["closed_at"], &run["blocked_since"]),
        (&json!(true), &json!("2026-09-30T12:30:00Z"), &Value::Null)
    );
}

#[test]
fn faux_nico_ending_after_answering_tells_no_one_and_is_closed() {
    let t = faux_nico_working();
    let ran = t.cli(&[
        "answer",
        "acme/api#7",
        "--text",
        "Keep it: PRODUCT.md says so.",
        "--by",
        "faux-nico",
    ]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    agent_state(&t, "faux-nico-api-7", "done");
    // herdr has not yet seen the Implementer take the answer.
    agent_state(&t, "impl-api-7", "blocked");

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, ["faux-nico-api-7 ended; its workspace closed"]);
    assert_eq!(
        git_and_herdr(&calls),
        [
            "herdr worktree remove --workspace w2",
            "herdr workspace close w2",
        ]
    );
    assert_eq!(*t.world.notifications.borrow(), []);
    let run = faux_nico(&t);
    assert_eq!(
        (&run["passed"], &run["closed_at"]),
        (&Value::Null, &json!("2026-09-30T12:20:00Z"))
    );
}
