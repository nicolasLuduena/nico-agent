mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::PrState;
use serde_json::{Value, json};

const MINUTE: Duration = Duration::from_secs(60);

/// Repo `acme/api` with issue 7 dispatched by hand, its Implementer
/// `impl-api-7` Asking "Should I keep the old endpoint?" since 12:00, then a
/// minute passes and the calls so far are cleared.
fn asking() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    let ran = t.cli(&["dispatch", "acme/api#7"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "blocked".into());
    (t.world.screens.borrow_mut()).insert(
        "impl-api-7".into(),
        "Should I keep the old endpoint?".into(),
    );
    t.tick();
    t.world.advance(MINUTE);
    t.world.calls.borrow_mut().clear();
    t
}

/// The answers on issue 7's Dispatch, as `status --json` and `dispatches.json` show them.
fn answers(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let shown = ran.json()["dispatches"][0]["answers"].clone();
    let file = std::fs::read_to_string(t.config_dir.join("dispatches.json")).unwrap();
    let recorded: Value = serde_json::from_str(&file).unwrap();
    assert_eq!(shown, recorded[0]["answers"]);
    shown
}

#[test]
fn an_answer_is_typed_into_the_asking_implementer_and_recorded_as_the_users() {
    let t = asking();

    let ran = t.cli(&["answer", "acme/api#7", "--text", "Keep it.", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json(), json!({"answer": "acme/api#7 answered by user"}));
    assert_eq!(t.world.calls(), ["herdr agent prompt impl-api-7 Keep it."]);
    assert_eq!(
        answers(&t),
        json!([{
            "since": "2026-09-30T12:00:00Z",
            "at": "2026-09-30T12:01:00Z",
            "question": "Should I keep the old endpoint?",
            "text": "Keep it.",
            "by": "user",
        }])
    );
}

#[test]
fn the_same_answer_to_the_same_asking_is_typed_and_recorded_once() {
    let t = asking();
    t.cli(&["answer", "acme/api#7", "--text", "Keep it."]);
    t.world.advance(MINUTE);

    let ran = t.cli(&["answer", "acme/api#7", "--text", "Keep it.", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        ran.json(),
        json!({"answer": "acme/api#7 answered by user already recorded (no-op)"})
    );
    assert_eq!(t.world.calls(), ["herdr agent prompt impl-api-7 Keep it."]);
    let at: Vec<Value> = (answers(&t).as_array().unwrap().iter())
        .map(|a| a["at"].clone())
        .collect();
    assert_eq!(at, ["2026-09-30T12:01:00Z"]);
}

const USAGE: &str = "Run `nico-agent answer <issue> --text <text> [--by faux-nico]` to type an answer into the issue's Asking Implementer and record it on its Dispatch";

#[test]
fn an_answer_by_faux_nico_is_recorded_as_faux_nicos() {
    let t = asking();

    let ran = t.cli(&[
        "answer",
        "acme/api#7",
        "--text",
        "Keep it.",
        "--by",
        "faux-nico",
        "--json",
    ]);

    assert_eq!(
        ran.json(),
        json!({"answer": "acme/api#7 answered by faux-nico"})
    );
    assert_eq!(answers(&t)[0]["by"], "faux-nico");
}

#[test]
fn an_answer_with_no_text_or_another_author_is_refused_with_its_usage() {
    let t = asking();

    let untexted = t.cli(&["answer", "acme/api#7", "--json"]);
    let someone = t.cli(&[
        "answer",
        "acme/api#7",
        "--text",
        "Keep it.",
        "--by",
        "bob",
        "--json",
    ]);

    assert_eq!(
        (untexted.exit_code, untexted.json()),
        (2, json!({"error": "--text is required", "help": [USAGE]}))
    );
    assert_eq!(
        (someone.exit_code, someone.json()),
        (
            2,
            json!({"error": "`bob` is not an author: user or faux-nico", "help": [USAGE]})
        )
    );
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(answers(&t), Value::Null);
}

#[test]
fn an_answer_that_starts_with_a_flag_is_typed_and_recorded() {
    let t = asking();

    let spaced = t.cli(&[
        "answer",
        "acme/api#7",
        "--text",
        "--force is fine",
        "--json",
    ]);
    let joined = t.cli(&[
        "answer",
        "acme/api#7",
        "--text=--force is fine here",
        "--json",
    ]);

    assert_eq!(
        (spaced.exit_code, joined.exit_code),
        (0, 0),
        "{}",
        joined.stdout
    );
    assert_eq!(
        t.world.calls(),
        [
            "herdr agent prompt impl-api-7 --force is fine",
            "herdr agent prompt impl-api-7 --force is fine here",
        ]
    );
    let texts: Vec<Value> = (answers(&t).as_array().unwrap().iter())
        .map(|a| a["text"].clone())
        .collect();
    assert_eq!(texts, ["--force is fine", "--force is fine here"]);
}

#[test]
fn an_answer_whose_text_is_another_flag_or_empty_is_refused() {
    let t = asking();
    let refused = |args: &[&str]| {
        let ran = t.cli(&[&["answer", "acme/api#7"], args, &["--json"]].concat());
        (ran.exit_code, ran.json())
    };
    let needs_text = (2, json!({"error": "--text needs a value", "help": [USAGE]}));

    assert_eq!(refused(&["--text", "--by", "faux-nico"]), needs_text);
    assert_eq!(refused(&["--text", "--by=faux-nico"]), needs_text);
    assert_eq!(refused(&["--text", ""]), needs_text);
    assert_eq!(refused(&["--text="]), needs_text);
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(answers(&t), Value::Null);
}

#[test]
fn an_answer_to_an_issue_not_asking_closed_or_unknown_is_refused_with_help() {
    let t = asking();
    let answer = |issue| t.cli(&["answer", issue, "--text", "Keep it.", "--json"]);
    let refused = |ran: common::Ran| (ran.exit_code, ran.json());
    let see_status = "Run `nico-agent status` to see the Dispatch";

    let unknown = refused(answer("acme/api#8"));
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "working".into());
    t.tick();
    let not_asking = refused(answer("acme/api#7"));
    let mut pr = pull_request("acme/api", 9);
    pr.head_branch = Some("agent/api-7".into());
    t.world.add_pr(pr);
    t.tick();
    t.world.prs.borrow_mut()[0].state = PrState::Merged;
    t.tick();
    let closed = refused(answer("acme/api#7"));

    let no_dispatch = |issue: &str| {
        json!({
            "error": format!("{issue} has no live Dispatch"),
            "help": ["An answer goes to the Asking Implementer of an issue In flight", see_status],
        })
    };
    assert_eq!(unknown, (1, no_dispatch("acme/api#8")));
    assert_eq!(
        not_asking,
        (
            1,
            json!({
                "error": "acme/api#7 is not Asking",
                "help": ["An answer goes to an Implementer herdr reports blocked on a question", see_status],
            })
        )
    );
    assert_eq!(closed, (1, no_dispatch("acme/api#7")));
    let typed =
        (t.world.calls().into_iter()).filter(|c| c.starts_with("herdr agent prompt impl-api-7"));
    assert_eq!(typed.count(), 0);
    assert_eq!(answers(&t), Value::Null);
}
