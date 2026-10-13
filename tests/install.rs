mod common;

use common::{Setup, github_issue, pull_request, setup};
use nico_agent::world::{PrState, PullRequest};
use serde_json::{Value, json};

/// Repo `acme/api`, its clone at `/src/api`, with `serve` listening; no calls recorded yet.
fn serving() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

fn config(t: &Setup) -> String {
    std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap()
}

fn status(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()
}

#[test]
fn the_page_sets_a_repo_s_install_command_which_status_shows_and_null_removes() {
    let t = serving();

    let set = t.send(
        "PATCH",
        "/api/repo/acme/api",
        r#"{"install": "make install"}"#,
    );

    assert_eq!(set.0, 200, "{}", set.1);
    assert_eq!(
        config(&t),
        "[repos.\"acme/api\"]\npath = \"/src/api\"\ninstall = \"make install\"\n"
    );
    assert_eq!(
        status(&t)["repos"][0]["install"],
        json!({ "command": "make install", "last": null })
    );

    let removed = t.send("PATCH", "/api/repo/acme/api", r#"{"install": null}"#);

    assert_eq!(removed.0, 200, "{}", removed.1);
    assert_eq!(config(&t), "[repos.\"acme/api\"]\npath = \"/src/api\"\n");
    assert_eq!(status(&t)["repos"][0].get("install"), None);
}

#[test]
fn an_empty_install_command_or_one_for_a_project_is_refused_and_nothing_written() {
    let t = serving();
    let before = config(&t);

    let empty = t.send("PATCH", "/api/repo/acme/api", r#"{"install": " "}"#);
    let project = t.send("PATCH", "/api/project/acme/api", r#"{"install": "make"}"#);

    assert_eq!(
        empty,
        (
            400,
            json!({
                "error": "install is a command, not \" \"",
                "help": ["install is the command run in the Repo's clone after a merge into its Base"],
            })
        )
    );
    assert_eq!(
        project,
        (
            400,
            json!({
                "error": "`install` is not a setting the page sets",
                "help": ["Settings: implementer, reviewer, room, base, switches; null takes the Project's or the default"],
            })
        )
    );
    assert_eq!(config(&t), before);
}

/// nico-agent's own Install command.
const INSTALL: &str =
    "cargo install --locked --path . --root ~/.local && systemctl --user restart nico-agent";

/// How `install` pulls: never prompting, so a key not loaded fails at once.
const PULL: &str = "GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=\"ssh -o BatchMode=yes -o ConnectTimeout=10\" git -C /src/api pull --ff-only";

/// Repo `acme/api`, its clone at `/src/api` on `main`, with nico-agent's
/// Install command; no calls recorded yet.
fn with_install() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    let file = t.config_dir.join("config.toml");
    let text = config(&t) + &format!("install = \"{INSTALL}\"\n");
    std::fs::write(file, text).unwrap();
    t.world.calls.borrow_mut().clear();
    t
}

fn installs(t: &Setup) -> Value {
    let text = std::fs::read_to_string(t.config_dir.join("installs.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

/// The calls before the Readiness checks, which start by asking for the clone's remotes.
fn before_checks(t: &Setup) -> Vec<String> {
    let calls = t.world.calls();
    let checks = calls.iter().position(|c| c == "git remotes /src/api");
    calls[..checks.expect("the checks ran")].to_vec()
}

#[test]
fn install_pulls_the_clone_on_its_base_fast_forward_runs_its_command_and_records_its_last_20_lines()
{
    let t = with_install();
    let printed: Vec<String> = (1..=25).map(|n| format!("line {n}")).collect();
    (t.world.shell_runs.borrow_mut()).insert(INSTALL.into(), (true, printed.join("\n") + "\n"));
    t.world
        .heads
        .borrow_mut()
        .insert("/src/api HEAD".into(), "f00d".into());

    let ran = t.cli(&["install", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json(), json!({ "installed": "acme/api at f00d" }));
    assert_eq!(
        before_checks(&t),
        [
            "git -C /src/api default-branch",
            "git -C /src/api branch --show-current",
            "git -C /src/api status --porcelain --untracked-files=no",
            PULL,
            "git -C /src/api rev-parse HEAD",
            &format!("cd /src/api && sh -c {INSTALL}"),
        ]
    );
    let last = json!({
        "at": "2026-09-30T12:00:00Z",
        "sha": "f00d",
        "ok": true,
        "output": printed[5..].join("\n"),
    });
    assert_eq!(installs(&t), json!({ "acme/api": { "last": last } }));
    let shown = &status(&t)["repos"][0];
    assert_eq!(
        shown["install"],
        json!({ "command": INSTALL, "last": last })
    );
    // Its Readiness checks ran after it, and say so since now.
    assert_eq!(shown["checks"]["at"], "2026-09-30T12:00:00Z");
}

#[test]
fn install_refuses_a_clone_off_its_base_or_with_tracked_changes_and_records_the_refusal() {
    let off_base = with_install();
    (off_base.world.branches.borrow_mut()).insert("/src/api".into(), "spike".into());
    let changed = with_install();
    (changed.world.tracked_changes.borrow_mut()).insert(
        "/src/api".into(),
        vec!["M src/lib.rs".into(), "D notes.md".into()],
    );
    let detached = with_install();
    (detached.world.branches.borrow_mut()).insert("/src/api".into(), "".into());

    for (t, said) in [
        (&off_base, "/src/api is on spike, not its Base main"),
        (
            &changed,
            "/src/api has changes to tracked files: M src/lib.rs, D notes.md",
        ),
        (&detached, "/src/api is on no branch, not its Base main"),
    ] {
        let ran = t.cli(&["install", "acme/api", "--json"]);

        assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
        assert_eq!(
            ran.json(),
            json!({
                "error": format!("the Install of acme/api failed: {said}"),
                "help": ["Run `nico-agent install acme/api` once it is fixed"],
            })
        );
        let calls = before_checks(t);
        assert!(
            !calls
                .iter()
                .any(|c| c.contains("pull") || c.contains("sh -c")),
            "{calls:?}"
        );
        assert_eq!(
            installs(t),
            json!({ "acme/api": { "last": {
                "at": "2026-09-30T12:00:00Z", "sha": null, "ok": false, "output": said,
            } } })
        );
    }
}

#[test]
fn a_failed_pull_or_command_is_recorded_as_a_failed_install_with_its_output() {
    let diverged = with_install();
    let refused =
        "`git pull --ff-only` failed in /src/api: fatal: Not possible to fast-forward, aborting.";
    diverged.world.fail_call(PULL, refused);
    let broken = with_install();
    (broken.world.shell_runs.borrow_mut()).insert(
        INSTALL.into(),
        (
            false,
            "Compiling nico-agent\nerror: could not compile\n".into(),
        ),
    );

    let pull = diverged.cli(&["install", "acme/api", "--json"]);
    let command = broken.cli(&["install", "acme/api", "--json"]);

    assert_eq!((pull.exit_code, command.exit_code), (1, 1));
    assert_eq!(
        pull.json()["error"],
        format!("the Install of acme/api failed: {refused}")
    );
    assert_eq!(
        command.json()["error"],
        "the Install of acme/api failed: error: could not compile"
    );
    assert_eq!(
        installs(&diverged)["acme/api"]["last"],
        json!({ "at": "2026-09-30T12:00:00Z", "sha": null, "ok": false, "output": refused })
    );
    assert_eq!(
        installs(&broken)["acme/api"]["last"],
        json!({
            "at": "2026-09-30T12:00:00Z", "sha": "abc1234", "ok": false,
            "output": "Compiling nico-agent\nerror: could not compile",
        })
    );
}

#[test]
fn install_refuses_a_repo_with_no_install_command_and_records_nothing() {
    let t = serving();

    let ran = t.cli(&["install", "acme/api", "--json"]);

    assert_eq!(
        (ran.exit_code, ran.json()),
        (
            1,
            json!({
                "error": "acme/api has no install command",
                "help": ["Set it on acme/api's tab, or as repos.\"acme/api\".install in config.toml"],
            })
        )
    );
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert!(!t.config_dir.join("installs.json").exists());
}

/// `t` with each of `issues` of `acme/api` dispatched and its PR open
/// against `main`, PR `n + 2` for issue `n`, seen by a tick; no calls recorded yet.
fn with_prs(t: Setup, issues: &[u64]) -> Setup {
    for &n in issues {
        t.world.add_issue("acme/api", github_issue("acme/api", n));
    }
    for &n in issues {
        let ran = t.cli(&["dispatch", &format!("acme/api#{n}"), "--json"]);
        assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
        t.world.add_pr(PullRequest {
            head_branch: Some(format!("agent/api-{n}")),
            ..pull_request("acme/api", n + 2)
        });
    }
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

fn merge(t: &Setup, pr: u64) {
    let mut prs = t.world.prs.borrow_mut();
    prs.iter_mut().find(|p| p.number == pr).unwrap().state = PrState::Merged;
}

/// Run a tick: what it said of Installs, and the calls it made opening one,
/// not a Close of a Dispatch's workspace.
fn tick_installs(t: &Setup) -> (Vec<String>, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let said = t.tick();
    let said = said.into_iter().filter(|l| l.contains("Install")).collect();
    let text = std::fs::read_to_string(t.config_dir.join("dispatches.json")).unwrap();
    let dispatches: Value = serde_json::from_str(&text).unwrap();
    let closes: Vec<String> = (dispatches.as_array().unwrap().iter())
        .map(|d| format!("herdr workspace close {}", d["workspace"].as_str().unwrap()))
        .collect();
    let opening = ["herdr workspace", "herdr tab", "herdr pane run"];
    let calls = (t.world.calls().into_iter())
        .filter(|c| opening.iter().any(|o| c.starts_with(o)) && !closes.contains(c))
        .collect();
    (said, calls)
}

#[test]
fn a_merge_into_the_base_opens_one_pane_in_install_repo_running_nico_agent_install() {
    let t = with_prs(with_install(), &[7]);
    merge(&t, 9);

    let merged = tick_installs(&t);
    let after = tick_installs(&t);

    assert_eq!(
        merged,
        (
            vec!["acme/api: Install started in install-api".to_string()],
            vec![
                "herdr workspace create --cwd /src/api --label install-api --no-focus".to_string(),
                "herdr tab create --workspace w2 --cwd /src/api --label install --no-focus".into(),
                "herdr pane run w2:p2 nico-agent install acme/api".into(),
            ]
        )
    );
    assert_eq!(after, (vec![], vec![]));
    assert_eq!(installs(&t), json!({ "acme/api": { "workspace": "w2" } }));
}

#[test]
fn no_pane_opens_for_a_merge_into_another_branch_nor_for_a_repo_without_an_install_command() {
    let stacked = with_prs(with_install(), &[7]);
    (stacked.world.prs.borrow_mut())[0].base_branch = "agent/api-6".into();
    merge(&stacked, 9);
    let plain = setup();
    plain
        .world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    plain.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    let plain = with_prs(plain, &[7]);
    merge(&plain, 9);

    let on_dev = with_install();
    let text = config(&on_dev) + "base = \"dev\"\n";
    std::fs::write(on_dev.config_dir.join("config.toml"), text).unwrap();
    let on_dev = with_prs(on_dev, &[7]);
    merge(&on_dev, 9);

    for t in [&stacked, &plain, &on_dev] {
        assert_eq!(tick_installs(t), (vec![], vec![]));
        assert!(!t.config_dir.join("installs.json").exists());
    }
}

/// `t`'s Install of `acme/api` run by process 777, its workspace `w9`, as
/// `nico-agent install` keeps it.
fn running(t: &Setup) {
    let running =
        json!({ "acme/api": { "runner": 777, "runner_boot": "boot-1", "workspace": "w9" } });
    std::fs::write(t.config_dir.join("installs.json"), running.to_string()).unwrap();
}

#[test]
fn merges_during_a_running_install_queue_exactly_one_more_started_once_it_ends() {
    let t = with_prs(with_install(), &[7, 8]);
    running(&t);
    merge(&t, 9);

    let first = tick_installs(&t);
    merge(&t, 10);
    let second = tick_installs(&t);
    let queued = installs(&t);
    t.world.dead_pids.borrow_mut().push(777);
    let ended = tick_installs(&t);
    let after = tick_installs(&t);

    let while_running =
        "acme/api: a PR merged into main while its Install runs (pid 777); one more queued";
    assert_eq!(first, (vec![while_running.to_string()], vec![]));
    assert_eq!(second, (vec![while_running.to_string()], vec![]));
    assert_eq!(queued["acme/api"]["queued"], true);
    assert_eq!(
        ended,
        (
            vec!["acme/api: Install started in install-api".to_string()],
            vec![
                "herdr workspace close w9".to_string(),
                "herdr workspace create --cwd /src/api --label install-api --no-focus".into(),
                "herdr tab create --workspace w3 --cwd /src/api --label install --no-focus".into(),
                "herdr pane run w3:p2 nico-agent install acme/api".into(),
            ]
        )
    );
    assert_eq!(after, (vec![], vec![]));
    assert_eq!(installs(&t)["acme/api"].get("queued"), None);
}

#[test]
fn install_run_while_another_runs_queues_one_more_instead() {
    let t = with_install();
    running(&t);

    let ran = t.cli(&["install", "acme/api", "--json"]);

    assert_eq!(
        (ran.exit_code, ran.json()),
        (
            1,
            json!({
                "error": "an Install of acme/api is running (pid 777)",
                "help": ["One more runs once it ends"],
            })
        )
    );
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert_eq!(installs(&t)["acme/api"]["queued"], true);
}

#[test]
fn an_install_that_could_not_be_started_is_queued_again_and_started_next_tick() {
    let t = with_prs(with_install(), &[7]);
    merge(&t, 9);
    t.world.fail_call("herdr pane run", "herdr is not running");

    let failed = tick_installs(&t);
    t.world.clear_failures();
    let next = tick_installs(&t);

    assert_eq!(
        failed.0,
        ["could not start the Install of acme/api, queued again: herdr is not running"]
    );
    assert_eq!(next.0, ["acme/api: Install started in install-api"]);
    assert_eq!(
        next.1[..2],
        [
            "herdr workspace close w2",
            "herdr workspace create --cwd /src/api --label install-api --no-focus",
        ]
    );
}

#[test]
fn a_merge_whose_base_cannot_be_told_installs_rather_than_be_lost() {
    let t = with_prs(with_install(), &[7]);
    merge(&t, 9);
    t.world.fail_call(
        "git -C /src/api default-branch",
        "no origin/HEAD in /src/api",
    );

    let (said, calls) = tick_installs(&t);

    assert_eq!(
        said,
        [
            "could not tell whether a merge into acme/api was into its Base, so its Install runs: no origin/HEAD in /src/api",
            "acme/api: Install started in install-api",
        ]
    );
    assert_eq!(
        calls.last().unwrap(),
        "herdr pane run w2:p2 nico-agent install acme/api"
    );
}
