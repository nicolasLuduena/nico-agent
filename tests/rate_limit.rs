mod common;

use common::{Setup, budget, setup};
use nico_agent::world::RateLimit;
use serde_json::{Value, json};

/// Repo `acme/api`, with no calls recorded yet.
fn with_repo() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.calls.borrow_mut().clear();
    t
}

/// The bot's budgets, `ghbot` installed.
fn bot() -> RateLimit {
    RateLimit {
        core: budget(15000, 300, "2026-09-30T12:30:00Z"),
        graphql: budget(10000, 9500, "2026-09-30T12:20:00Z"),
    }
}

fn kept(t: &Setup) -> Value {
    let text = std::fs::read_to_string(t.config_dir.join("rate_limits.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

/// One tick through `serve`, its calls kept, as `t.tick()` would not.
fn serve(t: &Setup) -> Vec<String> {
    let ran = t.cli(&["serve"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    t.world.calls()
}

#[test]
fn a_tick_ends_reading_each_identity_s_rate_limit_and_keeps_it() {
    let t = with_repo();
    *t.world.bot_rate_limit.borrow_mut() = Some(bot());

    let calls = serve(&t);

    assert_eq!(
        calls[calls.len() - 2..],
        ["gh api rate_limit", "ghbot api rate_limit"]
    );
    assert_eq!(
        kept(&t),
        json!({
            "gh": {
                "core": {"limit": 5000, "used": 120, "remaining": 4880, "reset": "2026-09-30T12:40:00Z"},
                "graphql": {"limit": 5000, "used": 40, "remaining": 4960, "reset": "2026-09-30T12:50:00Z"},
            },
            "ghbot": {
                "core": {"limit": 15000, "used": 300, "remaining": 14700, "reset": "2026-09-30T12:30:00Z"},
                "graphql": {"limit": 10000, "used": 9500, "remaining": 500, "reset": "2026-09-30T12:20:00Z"},
            },
        })
    );
}

#[test]
fn the_status_route_carries_both_identities_and_both_budgets() {
    let t = with_repo();
    *t.world.bot_rate_limit.borrow_mut() = Some(bot());
    t.tick();

    let (status, body) = t.get("/api/status");

    assert_eq!(status, 200, "{body}");
    assert_eq!(body["rate_limits"], kept(&t));
    for identity in ["gh", "ghbot"] {
        for budget in ["core", "graphql"] {
            assert!(
                body["rate_limits"][identity][budget]["limit"].is_u64(),
                "{body}"
            );
        }
    }
}

#[test]
fn without_ghbot_only_the_user_s_is_kept_and_nothing_is_said() {
    let t = with_repo();

    let said = t.tick();

    assert!(!said.iter().any(|l| l.contains("rate limit")), "{said:?}");
    assert_eq!(
        kept(&t).as_object().unwrap().keys().collect::<Vec<_>>(),
        ["gh"]
    );
}

#[test]
fn a_failed_read_is_said_and_the_last_answer_stands() {
    let t = with_repo();
    t.tick();
    let before = kept(&t);
    t.world
        .fail_call("gh api rate_limit", "GitHub request failed");

    let said = t.tick();

    assert!(said.contains(&"could not read GitHub's rate limit: GitHub request failed".into()));
    assert_eq!(kept(&t), before);
}

#[test]
fn it_is_read_while_github_is_paused_since_asking_it_costs_none() {
    let t = with_repo();
    std::fs::write(
        t.config_dir.join("pauses.json"),
        r#"{"github": "2026-09-30T13:00:00Z"}"#,
    )
    .unwrap();

    let calls = serve(&t);

    assert!(!calls.contains(&"github issues acme/api".into()));
    assert!(calls.contains(&"gh api rate_limit".into()));
    assert_eq!(
        t.get("/api/status").1["sources"]["github"]["paused_until"],
        "2026-09-30T13:00:00Z"
    );
}
