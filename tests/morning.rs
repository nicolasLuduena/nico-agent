mod common;

use std::time::Duration;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{PrState, PullRequest};
use serde_json::{Value, json};

const MINUTE: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_secs(3600);

/// Repo `acme/api` with each of `issues` dispatched by hand at 12:00.
fn dispatched(issues: &[u64]) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    for &n in issues {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    for &n in issues {
        let ran = t.cli(&["dispatch", &format!("acme/api#{n}")]);
        assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    }
    // Gone from the Source, so not dispatched again once Closed.
    t.world.issues.borrow_mut().clear();
    t
}

/// PR `n` of `acme/api`, open, from the branch of issue `issue`.
fn pr(n: u64, issue: u64) -> PullRequest {
    PullRequest {
        head_branch: Some(format!("agent/api-{issue}")),
        ..pull_request("acme/api", n)
    }
}

/// Set what GitHub says of PR `n` of `acme/api`.
fn set_state(t: &Setup, n: u64, state: PrState) {
    let mut prs = t.world.prs.borrow_mut();
    prs.iter_mut().find(|pr| pr.number == n).unwrap().state = state;
}

fn status_since(t: &Setup, since: &str) -> Value {
    let ran = t.cli(&["status", "--json", "--since", since]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()
}

/// The `issue` of each item of `list`.
fn issues(list: &Value) -> Vec<&str> {
    (list.as_array().unwrap().iter())
        .map(|item| item["issue"].as_str().unwrap())
        .collect()
}

#[test]
fn status_since_lists_the_prs_merged_and_the_dispatches_closed_after_the_time_and_not_before() {
    let t = dispatched(&[5, 6, 7, 8]);
    for (n, issue) in [(9, 5), (10, 6), (11, 7), (12, 8)] {
        t.world.add_pr(pr(n, issue));
    }
    t.tick();
    set_state(&t, 9, PrState::Merged);
    set_state(&t, 10, PrState::Closed);
    t.world.advance(MINUTE);
    t.tick();
    t.world.advance(HOUR);
    set_state(&t, 11, PrState::Merged);
    set_state(&t, 12, PrState::Closed);
    t.tick();

    let shown = status_since(&t, "2026-09-30T13:00:00Z");

    assert_eq!(issues(&shown["merged"]), ["acme/api#7"]);
    assert_eq!(
        shown["merged"][0]["pr"]["url"],
        "https://github.com/acme/api/pull/11"
    );
    assert_eq!(
        shown["merged"][0]["pr"]["merged_at"],
        "2026-09-30T13:01:00Z"
    );
    // A merged PR's Dispatch Closes too; `closed` is those that Closed unmerged.
    assert_eq!(issues(&shown["closed"]), ["acme/api#8"]);
    assert_eq!(shown["closed"][0]["closed_at"], "2026-09-30T13:01:00Z");
    let everything = status_since(&t, "2026-09-30T12:00:00Z");
    assert_eq!(issues(&everything["merged"]), ["acme/api#5", "acme/api#7"]);
    assert_eq!(issues(&everything["closed"]), ["acme/api#6", "acme/api#8"]);
    let plain = t.cli(&["status", "--json"]).json();
    assert_eq!(plain.get("merged"), None);
}

#[test]
fn status_since_lists_each_answer_recorded_after_the_time_with_its_question_and_author() {
    let t = dispatched(&[7]);
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "blocked".into());
    (t.world.screens.borrow_mut()).insert(
        "impl-api-7".into(),
        "Should I keep the old endpoint?".into(),
    );
    t.tick();
    t.world.advance(MINUTE);
    t.cli(&["answer", "acme/api#7", "--text", "Keep it."]);
    t.world.advance(HOUR);
    let args = [
        "answer",
        "acme/api#7",
        "--text",
        "Keep v1 too.",
        "--by",
        "faux-nico",
    ];
    let ran = t.cli(&args);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);

    let shown = status_since(&t, "2026-09-30T13:00:00Z");

    assert_eq!(
        shown["answers"],
        json!([{
            "issue": "acme/api#7",
            "since": "2026-09-30T12:00:00Z",
            "at": "2026-09-30T13:01:00Z",
            "question": "Should I keep the old endpoint?",
            "text": "Keep v1 too.",
            "by": "faux-nico",
        }])
    );
}

/// Repo `acme/api` with no issues and the config `toml` sets, on Wednesday at noon.
fn with_repo(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t
}

#[test]
fn status_since_lists_each_scan_run_after_the_time() {
    let t = with_repo("switches = { quality_scan = true }");
    // Sunday 03:00, the scan's default slot.
    t.world.advance(Duration::from_secs((3 * 24 + 15) * 3600));
    t.tick();
    t.world.agents.borrow_mut().clear();
    t.world.advance(Duration::from_secs(7 * 86_400));
    t.tick();

    let shown = status_since(&t, "2026-10-05T00:00:00Z");

    let scans = shown["scans"].as_array().unwrap();
    assert_eq!(scans.len(), 1, "{scans:?}");
    assert_eq!(scans[0]["at"], "2026-10-11T03:00:00Z");
    assert_eq!(scans[0]["trigger"], "quality-scan");
    assert_eq!(scans[0]["repo"], "acme/api");
}

#[test]
fn status_since_refuses_a_time_it_cannot_compare() {
    let t = with_repo("");

    let ran = t.cli(&["status", "--json", "--since", "yesterday"]);

    assert_eq!(ran.exit_code, 2, "{}", ran.stdout);
    assert_eq!(
        ran.json()["error"],
        "--since takes a UTC time like 2026-09-30T07:00:00Z, not `yesterday`"
    );
}

const TICK: Duration = Duration::from_secs(600);
const DAY: Duration = Duration::from_secs(86_400);
/// From the fake clock's noon to 07:00 the next day, UTC.
const TO_7AM: Duration = Duration::from_secs(19 * 3600);

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

fn last_morning(t: &Setup) -> Value {
    t.cli(&["status", "--json"]).json()["morning"].clone()
}

#[test]
fn at_the_hour_one_morning_agent_starts_on_the_config_directory_and_once_that_day() {
    let t = with_repo("");
    let dir = t.config_dir.display().to_string();
    t.world.advance(TO_7AM);

    let (said, calls) = calls_after(&t, || t.tick());
    t.world
        .agents
        .borrow_mut()
        .insert("morning".into(), "done".into());
    t.world.advance(TICK);
    let ended = t.tick();
    t.world.advance(TICK);
    let later = t.tick();

    assert_eq!(said, ["morning started on claude"]);
    assert_eq!(
        started(&calls),
        [
            format!("herdr workspace create --cwd {dir} --label morning --no-focus"),
            format!("herdr tab create --workspace w1 --cwd {dir} --label morning --no-focus"),
            "herdr agent start morning --kind claude --pane w1:p2 -- ".into(),
            format!(
                "herdr agent prompt morning /morning: the night is in nico-agent status --json --since 2026-09-30T07:00:00Z. Write the summary to {dir}/morning.md."
            ),
        ]
    );
    assert_eq!(ended, ["morning ended; its workspace closed"]);
    assert_eq!(later, Vec::<String>::new());
    let morning = last_morning(&t);
    assert_eq!(morning["at"], "2026-10-01T07:00:00Z");
    assert_eq!(morning["agent"], "morning");
    assert_eq!(morning["closed_at"], "2026-10-01T07:10:00Z");
}

#[test]
fn the_next_days_morning_reads_the_night_since_the_last_one() {
    let t = with_repo("");
    t.world.advance(TO_7AM);
    t.tick();
    t.world.agents.borrow_mut().clear();
    t.world.advance(DAY - TICK);
    let before = t.tick();
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(before, ["morning ended; its workspace closed"]);
    assert_eq!(said, ["morning started on claude"]);
    let prompt = started(&calls).last().unwrap().to_string();
    assert!(prompt.contains("--since 2026-10-01T07:00:00Z."), "{prompt}");
    assert_eq!(last_morning(&t)["at"], "2026-10-02T07:00:00Z");
    assert_eq!(last_morning(&t)["workspace"], "w2");
}

#[test]
fn with_morning_off_nothing_starts_and_nothing_is_recorded() {
    let t = with_repo("\n[morning]\nenabled = false");
    t.world.advance(TO_7AM);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(started(&calls), Vec::<&str>::new());
    assert_eq!(last_morning(&t), Value::Null);
    assert!(!t.config_dir.join("runs.json").exists());
}

#[test]
fn the_hour_is_local_and_the_launch_morning_launch_when_set() {
    let t = with_repo("\n[morning]\nhour = 6\nlaunch = { harness = \"codex\" }");
    // Buenos Aires: 06:00 there is 09:00 UTC.
    t.world.utc_offset.set(-3 * 3600);
    t.world.advance(Duration::from_secs(18 * 3600));
    let utc_6am = t.tick();
    t.world.advance(3 * HOUR);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(utc_6am, Vec::<String>::new());
    assert_eq!(said, ["morning started on codex"]);
    let prompt = started(&calls).last().unwrap().to_string();
    assert!(
        prompt.starts_with("herdr agent prompt morning $morning: "),
        "{prompt}"
    );
    assert_eq!(last_morning(&t)["at"], "2026-10-01T09:00:00Z");
}

const SUMMARY: &str = "\n## Merge these\n- acme/api#7 https://github.com/acme/api/pull/9\n\n## Answer these\nNothing needs you\n";

#[test]
fn a_changed_morning_md_emits_changed_and_one_notification_with_its_first_item() {
    let t = with_repo("");
    t.tick();
    let mut events = t.events();
    let file = t.config_dir.join("morning.md");

    std::fs::write(&file, SUMMARY).unwrap();
    let said = t.tick();
    let sent = events.next();
    std::fs::write(&file, SUMMARY).unwrap();
    let again = t.tick();

    assert_eq!(sent, "event: changed\ndata: {}\n\n");
    assert_eq!(
        said,
        ["Morning summary sent: - acme/api#7 https://github.com/acme/api/pull/9"]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "Morning summary".to_string(),
            "- acme/api#7 https://github.com/acme/api/pull/9".to_string()
        )]
    );
    assert_eq!(events.next(), "");
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(t.world.notifications.borrow().len(), 1);
}

#[test]
fn the_page_is_given_morning_md_as_it_is_and_nothing_while_it_is_absent() {
    let t = with_repo("");
    t.tick();

    let (_, absent) = t.get("/api/status");
    std::fs::write(t.config_dir.join("morning.md"), SUMMARY).unwrap();
    let (status, written) = t.get("/api/status");

    assert_eq!(absent["morning_summary"], Value::Null);
    assert_eq!(status, 200);
    assert_eq!(written["morning_summary"], SUMMARY);
}

#[test]
fn a_morning_launch_on_no_harness_is_refused_naming_its_key() {
    let t = with_repo("\n[morning]\nlaunch = { harness = \"gemini\" }");

    let ran = t.cli(&["repo", "list", "--json"]);

    assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
    let file = t.config_dir.join("config.toml").display().to_string();
    assert_eq!(
        ran.json()["error"],
        format!("{file} line 5: morning.launch.harness: `gemini` is not a Harness")
    );
}
