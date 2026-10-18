mod common;

use common::{Setup, github_issue, setup};
use serde_json::json;

const IMPLEMENTER: &str = "/api/agent/acme%2Fapi%237/implementer";

/// Repo `acme/api` with issue 7 dispatched by hand, its Implementer
/// `impl-api-7` working, its pane having printed lines 1 to 250, then a tick
/// and the calls so far cleared.
fn working() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    let ran = t.cli(&["dispatch", "acme/api#7"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "working".into());
    let printed: Vec<String> = (1..=250).map(|n| format!("line {n}")).collect();
    (t.world.screens.borrow_mut()).insert("impl-api-7".into(), printed.join("\n"));
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

#[test]
fn a_working_agent_s_screen_is_its_last_200_lines_read_from_herdr_alone() {
    let t = working();

    let read = t.get(IMPLEMENTER);

    let last: Vec<String> = (51..=250).map(|n| format!("line {n}")).collect();
    assert_eq!(
        read,
        (
            200,
            json!({ "agent": "impl-api-7", "screen": last.join("\n") })
        )
    );
    assert_eq!(
        t.world.calls(),
        [
            "herdr agent list",
            "herdr agent read impl-api-7 --source recent --lines 200"
        ]
    );
}

#[test]
fn a_read_herdr_fails_answers_why_in_its_words() {
    let t = working();
    t.world.fail_call(
        "herdr agent read",
        "agent_not_found: agent target impl-api-7 not found",
    );

    let read = t.get(IMPLEMENTER);

    assert_eq!(
        read,
        (
            200,
            json!({ "agent": "impl-api-7", "unread": "agent_not_found: agent target impl-api-7 not found" })
        )
    );
    assert_eq!(
        t.world.calls(),
        [
            "herdr agent list",
            "herdr agent read impl-api-7 --source recent --lines 200"
        ]
    );
}

#[test]
fn a_role_with_no_agent_in_herdr_an_unknown_role_or_an_issue_with_no_live_dispatch_is_refused_unread()
 {
    let t = working();

    let no_reviewer = t.get("/api/agent/acme%2Fapi%237/reviewer");
    t.world.agents.borrow_mut().remove("impl-api-7");
    let gone = t.get(IMPLEMENTER);
    let unknown = t.get("/api/agent/acme%2Fapi%237/faux-nico");
    let undispatched = t.get("/api/agent/acme%2Fapi%238/implementer");

    let see = json!(["See its agents in `nico-agent status --json`"]);
    assert_eq!(
        no_reviewer,
        (
            409,
            json!({ "error": "acme/api#7 has no reviewer in herdr", "help": see })
        )
    );
    assert_eq!(
        gone,
        (
            409,
            json!({ "error": "acme/api#7 has no implementer in herdr", "help": see })
        )
    );
    assert_eq!(
        unknown,
        (
            400,
            json!({
                "error": "faux-nico is not a role: implementer or reviewer",
                "help": ["Ask for /api/agent/<issue>/implementer or /reviewer"],
            })
        )
    );
    assert_eq!(
        undispatched,
        (
            409,
            json!({ "error": "acme/api#8 has no live Dispatch", "help": see })
        )
    );
    assert_eq!(t.world.calls(), ["herdr agent list"; 2]);
}
