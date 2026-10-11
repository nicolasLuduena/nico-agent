mod common;

use common::setup;
use serde_json::json;

#[test]
fn version_answers_as_json_without_touching_the_outside() {
    let t = setup();

    let ran = t.cli(&["--version", "--json"]);

    assert_eq!(ran.exit_code, 0);
    assert_eq!(ran.json(), json!({ "version": "0.1.0" }));
    assert!(t.world.calls().is_empty());
}

#[test]
fn an_unknown_command_is_a_bad_invocation_with_help() {
    let t = setup();

    let ran = t.cli(&["frobnicate", "--json"]);

    assert_eq!(ran.exit_code, 2);
    let answer = ran.json();
    assert_eq!(answer["error"], "unknown command `frobnicate`");
    assert!(
        answer["help"]
            .as_array()
            .unwrap()
            .contains(&json!("Run `nico-agent --version` to print the version"))
    );
    assert_eq!(t.cli(&["--json"]).json()["error"], "no command given");
}

#[test]
fn without_json_the_answer_is_lines_for_a_person() {
    let t = setup();

    assert_eq!(t.cli(&["--version"]).stdout, "version: 0.1.0\n");
    let refused = t.cli(&["frobnicate"]);
    assert_eq!(refused.exit_code, 2);
    assert!(refused.stdout.starts_with("error: unknown command `frobnicate`\nhelp:\n  Run `nico-agent --version` to print the version\n"));
}
