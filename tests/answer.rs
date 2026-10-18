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

#[test]
fn keys_are_sent_to_the_asking_implementer_and_recorded_as_an_answer_each_time() {
    let t = asking();

    let ran = t.cli(&["answer", "acme/api#7", "--keys", "down", "enter", "--json"]);
    t.world.advance(MINUTE);
    let again = t.cli(&["answer", "acme/api#7", "--keys", "down", "enter", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json(), json!({"answer": "acme/api#7 answered by user"}));
    // A key moves the dialog on each time it is pressed: never a no-op.
    assert_eq!(again.json(), ran.json());
    assert_eq!(
        t.world.calls(),
        [
            "herdr agent send-keys impl-api-7 down enter",
            "herdr agent send-keys impl-api-7 down enter",
        ]
    );
    let answer = |at| {
        json!({
            "since": "2026-09-30T12:00:00Z",
            "at": at,
            "question": "Should I keep the old endpoint?",
            "text": "down enter",
            "by": "user",
        })
    };
    assert_eq!(
        answers(&t),
        json!([
            answer("2026-09-30T12:01:00Z"),
            answer("2026-09-30T12:02:00Z")
        ])
    );
}

const USAGE: &str = "Run `nico-agent answer <issue> --text <text>|--keys <key>... [--by faux-nico]` to type an answer into the issue's Asking Implementer, or press keys in its pane, and record it on its Dispatch";

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
fn an_answer_with_no_text_or_keys_both_or_another_author_is_refused_with_its_usage() {
    let t = asking();

    let untexted = t.cli(&["answer", "acme/api#7", "--json"]);
    let keyless = t.cli(&["answer", "acme/api#7", "--keys", "--json"]);
    let both = t.cli(&[
        "answer",
        "acme/api#7",
        "--keys",
        "enter",
        "--text",
        "Keep it.",
        "--json",
    ]);
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
        (
            2,
            json!({"error": "--text or --keys is required", "help": [USAGE]})
        )
    );
    assert_eq!(
        (keyless.exit_code, keyless.json()),
        (2, json!({"error": "--keys needs a key", "help": [USAGE]}))
    );
    assert_eq!(
        (both.exit_code, both.json()),
        (
            2,
            json!({"error": "give --text or --keys, not both", "help": [USAGE]})
        )
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
        "{} {}",
        spaced.stdout,
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

#[test]
fn the_app_answers_in_words_or_keys_as_the_cli_does() {
    let t = asking();

    let typed = t.send(
        "POST",
        "/api/answer",
        r#"{"issue": "acme/api#7", "text": "Keep it."}"#,
    );
    let pressed = t.send(
        "POST",
        "/api/answer",
        r#"{"issue": "acme/api#7", "keys": ["2", "enter"]}"#,
    );

    let said = json!({"answer": "acme/api#7 answered by user"});
    assert_eq!((typed, pressed), ((200, said.clone()), (200, said)));
    assert_eq!(
        t.world.calls(),
        [
            "herdr agent prompt impl-api-7 Keep it.",
            "herdr agent send-keys impl-api-7 2 enter",
        ]
    );
    let texts: Vec<Value> = (answers(&t).as_array().unwrap().iter())
        .map(|a| json!([a["text"], a["by"]]))
        .collect();
    assert_eq!(
        texts,
        [json!(["Keep it.", "user"]), json!(["2 enter", "user"])]
    );
}

#[test]
fn the_app_s_answer_is_refused_as_the_cli_s_is_and_records_nothing() {
    let t = asking();
    let post = |body: &str| t.send("POST", "/api/answer", body);

    let unknown = post(r#"{"issue": "acme/api#8", "keys": ["enter"]}"#);
    let unknown_text = post(r#"{"issue": "acme/api#8", "text": "Keep it."}"#);
    let neither = post(r#"{"issue": "acme/api#7"}"#);
    let not_keys = post(r#"{"issue": "acme/api#7", "keys": "enter"}"#);
    // The page is the user: no key it sends is a flag of `answer`.
    let flagged = post(r#"{"issue": "acme/api#7", "keys": ["enter", "--by", "faux-nico"]}"#);
    t.world.fail_call(
        "herdr agent send-keys",
        "`herdr agent send-keys` failed: gone",
    );
    t.world
        .fail_call("herdr agent prompt", "`herdr agent prompt` failed: gone");
    let herdr_down = post(r#"{"issue": "acme/api#7", "keys": ["enter"]}"#);
    let herdr_down_text = post(r#"{"issue": "acme/api#7", "text": "Keep it."}"#);
    t.world.clear_failures();
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "working".into());
    t.tick();
    t.world.calls.borrow_mut().clear();
    let not_asking = post(r#"{"issue": "acme/api#7", "keys": ["enter"]}"#);
    let not_asking_text = post(r#"{"issue": "acme/api#7", "text": "Keep it."}"#);
    // herdr not answering, what the Dispatch records stands.
    t.world
        .fail_call("herdr agent list", "`herdr agent list` failed: gone");
    let unheard = post(r#"{"issue": "acme/api#7", "keys": ["enter"]}"#);
    t.world.clear_failures();

    let see_status = "Run `nico-agent status` to see the Dispatch";
    let no_dispatch = (
        409,
        json!({
            "error": "acme/api#8 has no live Dispatch",
            "help": ["An answer goes to the Asking Implementer of an issue In flight", see_status],
        }),
    );
    assert_eq!((&unknown, &unknown_text), (&no_dispatch, &no_dispatch));
    assert_eq!(
        neither,
        (
            400,
            json!({"error": "--text or --keys is required", "help": [USAGE]})
        )
    );
    assert_eq!(
        (not_keys, flagged),
        (
            (
                400,
                json!({"error": "keys is a list of key names, not \"enter\"", "help": [USAGE]})
            ),
            (
                400,
                json!({
                    "error": "keys is a list of key names, not [\"enter\",\"--by\",\"faux-nico\"]",
                    "help": [USAGE],
                })
            )
        )
    );
    let gone = |command: &str| {
        let error = format!("`herdr agent {command}` failed: gone");
        (409, json!({"error": error, "help": []}))
    };
    assert_eq!(
        (herdr_down, herdr_down_text),
        (gone("send-keys"), gone("prompt"))
    );
    let refused = (
        409,
        json!({
            "error": "acme/api#7 is not Asking",
            "help": ["An answer goes to an Implementer herdr reports blocked on a question", see_status],
        }),
    );
    assert_eq!(
        (&not_asking, &not_asking_text, &unheard),
        (&refused, &refused, &refused)
    );
    // Not recorded Asking, so herdr is asked whether it is.
    assert_eq!(t.world.calls(), ["herdr agent list"; 3]);
    assert_eq!(answers(&t), Value::Null);
}

#[test]
fn the_node_of_an_asking_dispatch_reads_no_pane_its_implementer_s_screen_is_read_on_its_own() {
    let t = asking();
    let dialog = "│ Should I keep the old endpoint?\n\n❯ 1. Keep it\n  2. Drop it\n\nEnter to select · Esc to cancel";
    (t.world.screens.borrow_mut()).insert("impl-api-7".into(), dialog.into());

    let (status, node) = t.get("/api/node/acme%2Fapi%237");
    let node_calls = t.world.calls();
    let (_, screen) = t.get("/api/agent/acme%2Fapi%237/implementer");

    assert_eq!(status, 200, "{node}");
    assert_eq!((node.get("pane"), node.get("pane_error")), (None, None));
    assert!(
        !node_calls.iter().any(|c| c.starts_with("herdr agent read")),
        "{node_calls:?}"
    );
    assert_eq!(screen, json!({ "agent": "impl-api-7", "screen": dialog }));
}

#[test]
fn an_implementer_herdr_reports_blocked_before_a_tick_sees_it_shows_its_screen_and_takes_an_answer()
{
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.cli(&["dispatch", "acme/api#7"]);
    t.tick();
    // Blocked since the last tick: its flag shows it Asking, the Dispatch does not record it yet.
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "blocked".into());
    let dialog = "Should I keep the old endpoint?\n❯ 1. Keep it\n  2. Drop it";
    (t.world.screens.borrow_mut()).insert("impl-api-7".into(), dialog.into());
    t.world.advance(MINUTE);
    t.world.calls.borrow_mut().clear();

    let (_, read) = t.get("/api/agent/acme%2Fapi%237/implementer");
    let pressed = t.send(
        "POST",
        "/api/answer",
        r#"{"issue": "acme/api#7", "keys": ["1"]}"#,
    );

    assert_eq!(read["screen"], dialog);
    assert_eq!(
        pressed,
        (200, json!({"answer": "acme/api#7 answered by user"}))
    );
    let pressed = (t.world.calls().into_iter()).filter(|c| c.starts_with("herdr agent send-keys"));
    assert_eq!(
        pressed.collect::<Vec<_>>(),
        ["herdr agent send-keys impl-api-7 1"]
    );
    // Recorded as the tick would have: Asking since now, with the question its pane shows.
    assert_eq!(
        answers(&t),
        json!([{
            "since": "2026-09-30T12:01:00Z",
            "at": "2026-09-30T12:01:00Z",
            "question": "Should I keep the old endpoint?",
            "text": "1",
            "by": "user",
        }])
    );
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(
        ran.json()["dispatches"][0]["asking"],
        json!({"since": "2026-09-30T12:01:00Z", "question": "Should I keep the old endpoint?"})
    );
}

#[test]
fn the_first_key_may_be_joined_to_its_flag_as_any_flag_s_value_may() {
    let t = asking();

    let ran = t.cli(&["answer", "acme/api#7", "--keys=tab", "enter", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        t.world.calls(),
        ["herdr agent send-keys impl-api-7 tab enter"]
    );
}
