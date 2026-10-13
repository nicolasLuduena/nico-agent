mod common;

use std::time::Duration;

use common::{KIT, KIT_TOML, Setup, kit_built, setup};

const TICK: Duration = Duration::from_secs(600);
const WEEK: Duration = Duration::from_secs(7 * 86_400);
/// From the fake clock's Wednesday noon to Sunday 03:00, UTC.
const TO_SUNDAY_3AM: Duration = Duration::from_secs((3 * 24 + 15) * 3600);

const ON: &str = "switches = { quality_scan = true }";

/// Repo `acme/api` as `toml` sets it, with no issues, on Wednesday at noon.
fn with_repo(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t
}

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// The calls but the Source read's and the read of herdr's agents.
fn started(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| !c.starts_with("github ") && *c != "herdr agent list")
        .map(String::as_str)
        .collect()
}

fn last_scan(t: &Setup) -> serde_json::Value {
    t.cli(&["status", "--json"]).json()["repos"][0]["last_scan"].clone()
}

#[test]
fn a_scan_starts_on_its_weekday_at_its_hour_with_the_quality_scan_prompt_and_is_recorded() {
    let t = with_repo(ON);
    t.world.advance(TO_SUNDAY_3AM);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api: quality-scan started on claude"]);
    assert_eq!(
        started(&calls),
        [
            "git -C /src/api default-branch",
            "git -C /src/api fetch origin",
            "herdr worktree create --cwd /src/api --branch quality-scan-api-20261004030000 --base origin/main --label quality-scan-api --no-focus",
            "herdr tab create --workspace w1 --cwd /worktrees/quality-scan-api-20261004030000 --label quality-scan --no-focus",
            "herdr agent start quality-scan-api --kind claude --pane w1:p2 -- ",
            "herdr agent prompt quality-scan-api /quality-scan acme/api",
        ]
    );
    let scan = last_scan(&t);
    assert_eq!(scan["at"], "2026-10-04T03:00:00Z");
    assert_eq!(scan["agent"], "quality-scan-api");
    assert_eq!(scan["closed_at"], serde_json::Value::Null);
}

#[test]
fn a_scan_of_a_repo_linking_a_built_library_version_starts_with_its_wiki_mcp_and_asks_it_first() {
    let t = with_repo(&format!("{ON}\nlibraries = [{KIT_TOML}]"));
    kit_built(&t);
    t.world.advance(TO_SUNDAY_3AM);

    let (_, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        started(&calls)[4..],
        [
            r#"herdr agent start quality-scan-api --kind claude --pane w1:p2 -- --mcp-config {"mcpServers":{"wiki":{"command":"nico-agent","args":["mcp","--wiki","acme/kit@v1"]}}} --allowedTools mcp__wiki__*"#.to_string(),
            format!("herdr agent prompt quality-scan-api /quality-scan acme/api Ask the wiki MCP about {KIT} before reading their source."),
        ]
    );
}

#[test]
fn a_scan_runs_once_a_week_and_again_at_the_next_weeks_weekday_and_hour() {
    let t = with_repo(ON);
    t.world.advance(TO_SUNDAY_3AM);
    t.tick();
    t.world
        .agents
        .borrow_mut()
        .insert("quality-scan-api".into(), "done".into());
    t.world.advance(TICK);

    let ended = t.tick();
    t.world.advance(WEEK - 2 * TICK);
    let before = t.tick();
    t.world.advance(TICK);
    let next = t.tick();

    assert_eq!(ended, ["quality-scan-api ended; its workspace closed"]);
    assert_eq!(before, Vec::<String>::new());
    assert_eq!(next, ["acme/api: quality-scan started on claude"]);
    assert_eq!(last_scan(&t)["at"], "2026-10-11T03:00:00Z");
    assert_eq!(last_scan(&t)["workspace"], "w2");
}

#[test]
fn a_repo_never_scanned_waits_for_its_weekly_slot_not_the_first_tick_after_the_switch_goes_on() {
    // Wednesday noon, days after Sunday's slot.
    let t = with_repo(ON);

    let midweek = t.tick();
    t.world.advance(TO_SUNDAY_3AM - TICK);
    let before = t.tick();
    t.world.advance(TICK);
    let slot = t.tick();

    assert_eq!(midweek, Vec::<String>::new());
    assert_eq!(before, Vec::<String>::new());
    assert_eq!(slot, ["acme/api: quality-scan started on claude"]);
    assert_eq!(last_scan(&t)["at"], "2026-10-04T03:00:00Z");
}

#[test]
fn a_first_scan_with_no_room_in_its_slot_hour_waits_for_the_next_weeks_slot() {
    let t = with_repo(&format!("room = 1\n{ON}"));
    t.world
        .add_issue("acme/api", common::github_issue("acme/api", 7));
    t.world.advance(TO_SUNDAY_3AM);
    assert_eq!(t.tick(), ["acme/api#7 dispatched"]);
    let config = t.config_dir.join("config.toml");
    let text = std::fs::read_to_string(&config).unwrap();
    std::fs::write(&config, text.replace("room = 1", "room = 2")).unwrap();
    t.world.advance(Duration::from_secs(3600));

    let past_the_hour = t.tick();

    assert_eq!(past_the_hour, Vec::<String>::new());
    assert_eq!(last_scan(&t), serde_json::Value::Null);
}

#[test]
fn with_no_room_at_the_hour_the_scan_runs_at_the_first_later_tick_with_room() {
    let t = with_repo(&format!("room = 1\n{ON}"));
    t.world
        .add_issue("acme/api", common::github_issue("acme/api", 7));
    t.world.advance(TO_SUNDAY_3AM);

    let full = t.tick();
    t.world.advance(TICK);
    let still = t.tick();
    let config = t.config_dir.join("config.toml");
    let text = std::fs::read_to_string(&config).unwrap();
    std::fs::write(&config, text.replace("room = 1", "room = 2")).unwrap();
    t.world.advance(TICK);
    let room = t.tick();

    assert_eq!(full, ["acme/api#7 dispatched"]);
    assert_eq!(still, Vec::<String>::new());
    assert_eq!(room, ["acme/api: quality-scan started on claude"]);
    assert_eq!(last_scan(&t)["at"], "2026-10-04T03:20:00Z");
}

#[test]
fn with_the_switch_off_nothing_starts_and_nothing_is_recorded() {
    let t = with_repo("");
    t.world.advance(TO_SUNDAY_3AM);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(started(&calls), Vec::<&str>::new());
    assert_eq!(last_scan(&t), serde_json::Value::Null);
    assert!(!t.config_dir.join("runs.json").exists());
}

#[test]
fn the_slot_is_local_time_and_the_launch_the_repos_quality_scan_one() {
    let t = with_repo(&format!(
        "quality_scan = {{ harness = \"codex\" }}\n{ON}\n\n[quality_scan]\nweekday = \"monday\"\nhour = 22"
    ));
    // Buenos Aires: Monday 22:00 there is Tuesday 01:00 UTC.
    t.world.utc_offset.set(-3 * 3600);
    t.world
        .advance(TO_SUNDAY_3AM + Duration::from_secs(46 * 3600));
    t.tick();
    t.world.agents.borrow_mut().clear();
    // Monday 22:00 UTC, 19:00 there.
    t.world.advance(Duration::from_secs(6 * 86_400 + 21 * 3600));
    let monday = t.tick();
    t.world.advance(Duration::from_secs(3 * 3600));

    let (tuesday, calls) = calls_after(&t, || t.tick());

    assert_eq!(monday, ["quality-scan-api ended; its workspace closed"]);
    assert_eq!(tuesday, ["acme/api: quality-scan started on codex"]);
    assert_eq!(
        started(&calls).last(),
        Some(&"herdr agent prompt quality-scan-api $quality-scan acme/api")
    );
    assert_eq!(last_scan(&t)["at"], "2026-10-13T01:00:00Z");
}

#[test]
fn a_bad_weekday_or_hour_is_refused_naming_its_key() {
    for (toml, error) in [
        (
            "[quality_scan]\nhour = 24",
            "quality_scan.hour: invalid value: integer `24`, expected an hour from 0 to 23",
        ),
        (
            "[quality_scan]\nweekday = \"sun\"",
            "quality_scan.weekday: unknown variant `sun`, expected one of `sunday`, `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`",
        ),
    ] {
        let t = with_repo(&format!("\n{toml}"));

        let ran = t.cli(&["repo", "list", "--json"]);

        assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
        let file = t.config_dir.join("config.toml").display().to_string();
        assert_eq!(ran.json()["error"], format!("{file} line 5: {error}"));
    }
}

#[test]
fn the_workspace_is_closed_once_herdr_reports_the_agent_gone_and_not_before() {
    let t = with_repo(ON);
    t.world.advance(TO_SUNDAY_3AM);
    t.tick();
    t.world.advance(TICK);

    let (working, kept) = calls_after(&t, || t.tick());
    t.world.agents.borrow_mut().remove("quality-scan-api");
    t.world.advance(TICK);
    let (gone, closing) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (after, none) = calls_after(&t, || t.tick());

    assert_eq!(working, Vec::<String>::new());
    assert_eq!(started(&kept), Vec::<&str>::new());
    assert_eq!(gone, ["quality-scan-api ended; its workspace closed"]);
    assert_eq!(
        started(&closing),
        [
            "herdr worktree remove --workspace w1",
            "herdr workspace close w1"
        ]
    );
    assert_eq!(after, Vec::<String>::new());
    assert!(!none.contains(&"herdr agent list".to_string()));
    assert_eq!(last_scan(&t)["closed_at"], "2026-10-04T03:20:00Z");
}

#[test]
fn a_blocked_scan_stays_open_and_tells_the_user_once_each_time_it_blocks() {
    let t = with_repo(ON);
    t.world.advance(TO_SUNDAY_3AM);
    t.tick();
    let a_tick_later_herdr_reports = |state: &str| {
        (t.world.agents.borrow_mut()).insert("quality-scan-api".into(), state.into());
        t.world.advance(TICK);
    };

    a_tick_later_herdr_reports("blocked");
    let (blocked, calls) = calls_after(&t, || t.tick());
    a_tick_later_herdr_reports("blocked");
    let still = t.tick();
    let shown = last_scan(&t);
    a_tick_later_herdr_reports("working");
    let working = t.tick();
    a_tick_later_herdr_reports("blocked");
    let again = t.tick();

    assert_eq!(blocked, ["quality-scan-api is blocked"]);
    assert_eq!(
        started(&calls),
        ["notify quality-scan of acme/api is blocked"]
    );
    assert_eq!(still, Vec::<String>::new());
    assert_eq!(working, Vec::<String>::new());
    assert_eq!(again, ["quality-scan-api is blocked"]);
    let told = (
        "quality-scan of acme/api is blocked".to_string(),
        "Take it over: herdr agent read quality-scan-api.".to_string(),
    );
    assert_eq!(*t.world.notifications.borrow(), [told.clone(), told]);
    assert_eq!(
        (&shown["blocked_since"], &shown["closed_at"]),
        (&"2026-10-04T03:10:00Z".into(), &serde_json::Value::Null)
    );
    assert_eq!(last_scan(&t)["blocked_since"], "2026-10-04T03:40:00Z");
}
