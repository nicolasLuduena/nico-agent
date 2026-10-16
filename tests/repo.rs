mod common;

use std::time::Duration;

use common::{Setup, github_issue, implementer_idle, pull_request, setup};
use nico_agent::world::{PrState, PullRequest};
use serde_json::json;

fn with_clone(path: &str, remote: &str) -> Setup {
    let t = setup();
    t.world.add_clone(path, &[remote]);
    t
}

#[test]
fn add_reads_the_remotes_and_list_shows_the_repo_with_defaults_filled_in() {
    let t = with_clone("/src/api", "git@github.com:acme/api.git");

    let added = t.cli(&["repo", "add", "acme/api", "--path", "/src/api", "--json"]);

    assert_eq!(added.exit_code, 0, "{}", added.stdout);
    assert_eq!(
        added.json(),
        json!({ "repo": "acme/api added", "path": "/src/api" })
    );
    let bucket = "/mnt/agents-land/nico-agent-bucket";
    assert_eq!(
        t.world.calls(),
        [
            "git remotes /src/api".to_string(),
            format!("git remotes {bucket}"),
            format!("git init {bucket}"),
            format!("write {bucket}/README.md"),
            format!(
                "git -C {bucket} add -- README.md && git -C {bucket} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m nico-agent's Bucket"
            ),
        ]
    );
    assert_eq!(
        t.cli(&["repo", "list", "--json"]).json(),
        json!({ "repos": [{
            "slug": "acme/api",
            "path": "/src/api",
            "linear": null,
            "project": "acme/api",
            "install": null,
            "room": 3,
            "base": null,
            "implementer": { "harness": "claude", "model": null, "effort": null },
            "reviewer": { "harness": "codex", "model": null, "effort": null },
            "switches": {
                "dispatch": true, "mine": false, "stack": true, "review": true, "restart": true, "flip": true,
                "answer": false, "gardening": false, "quality_scan": false, "wiki": false,
            },
        }] })
    );
}

#[test]
fn add_refuses_a_path_that_is_not_a_clone_of_the_slug_with_help() {
    let t = with_clone("/src/web", "git@github.com:acme/web.git");

    let not_a_clone = t.cli(&[
        "repo",
        "add",
        "acme/api",
        "--path",
        "/src/nothing",
        "--json",
    ]);
    assert_eq!(not_a_clone.exit_code, 1);
    assert_eq!(
        not_a_clone.json(),
        json!({
            "error": "/src/nothing is not a git clone",
            "help": ["Run `git clone https://github.com/acme/api /src/nothing` first, or pass the path of an existing clone"],
        })
    );

    let other_repo = t.cli(&["repo", "add", "acme/api", "--path", "/src/web", "--json"]);
    assert_eq!(other_repo.exit_code, 1);
    assert_eq!(
        other_repo.json(),
        json!({
            "error": "/src/web is not a clone of acme/api (its remotes: git@github.com:acme/web.git)",
            "help": ["Run `nico-agent repo add <owner/name> --path /src/web` with the slug its remote points at"],
        })
    );
    assert!(!t.config_dir.exists(), "a refusal writes nothing");
}

#[test]
fn adding_twice_is_a_no_op_that_says_so_and_a_change_updates_the_entry() {
    let t = with_clone("/src/api", "git@github.com:acme/api.git");
    t.world
        .add_clone("/work/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    let written = std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap();

    let again = t.cli(&["repo", "add", "acme/api", "--path", "/src/api", "--json"]);
    assert_eq!(again.exit_code, 0);
    assert_eq!(
        again.json(),
        json!({ "repo": "acme/api already added (no-op)", "path": "/src/api" })
    );
    assert_eq!(
        std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap(),
        written
    );

    let moved = t.cli(&[
        "repo",
        "add",
        "ACME/api",
        "--path=/work/api",
        "--linear-team",
        "BLE",
        "--linear-label",
        "agent",
        "--json",
    ]);
    assert_eq!(
        moved.json(),
        json!({ "repo": "acme/api updated", "path": "/work/api" })
    );
    let repos = t.cli(&["repo", "list", "--json"]).json()["repos"].clone();
    assert_eq!(repos.as_array().unwrap().len(), 1);
    assert_eq!(repos[0]["slug"], "acme/api");
    assert_eq!(repos[0]["path"], "/work/api");
    assert_eq!(
        repos[0]["linear"],
        json!({ "team": "BLE", "project": null, "label": "agent" })
    );

    let same_without_selector =
        t.cli(&["repo", "add", "acme/api", "--path", "/work/api", "--json"]);
    assert_eq!(
        same_without_selector.json()["repo"],
        "acme/api already added (no-op)"
    );
}

#[test]
fn add_with_project_names_the_repo_s_project_and_again_without_it_keeps_it() {
    let t = with_clone("/src/api", "git@github.com:acme/api.git");
    t.cli(&[
        "repo",
        "add",
        "acme/api",
        "--path",
        "/src/api",
        "--project",
        "shop",
    ]);

    let moved = t.cli(&[
        "repo",
        "add",
        "acme/api",
        "--path",
        "/src/api",
        "--project=mall",
        "--json",
    ]);
    let again = t.cli(&["repo", "add", "acme/api", "--path", "/src/api", "--json"]);

    assert_eq!(
        moved.json(),
        json!({ "repo": "acme/api updated", "path": "/src/api" })
    );
    assert_eq!(
        again.json(),
        json!({ "repo": "acme/api already added (no-op)", "path": "/src/api" })
    );
    assert_eq!(
        std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap(),
        "[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"mall\"\n"
    );
    assert_eq!(
        t.cli(&["repo", "list", "--json"]).json()["repos"][0]["project"],
        "mall"
    );
}

#[test]
fn rm_removes_the_entry_and_says_what_stays() {
    let t = with_clone("/src/api", "git@github.com:acme/api.git");
    t.world
        .add_clone("/src/web", &["git@github.com:acme/web.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.cli(&["repo", "add", "acme/web", "--path", "/src/web"]);

    let removed = t.cli(&["repo", "rm", "Acme/API", "--json"]);

    assert_eq!(removed.exit_code, 0, "{}", removed.stdout);
    assert_eq!(
        removed.json(),
        json!({ "repo": "acme/api removed", "stays": ["the clone at /src/api"] })
    );
    let repos = t.cli(&["repo", "list", "--json"]).json()["repos"].clone();
    assert_eq!(repos.as_array().unwrap().len(), 1);
    assert_eq!(repos[0]["slug"], "acme/web");

    let again = t.cli(&["repo", "rm", "acme/api", "--json"]);
    assert_eq!(again.exit_code, 0);
    assert_eq!(
        again.json(),
        json!({ "repo": "acme/api not configured (no-op)" })
    );
}

#[test]
fn a_removed_repos_work_in_flight_is_still_watched_reviewed_flipped_restarted_and_closed() {
    let t = with_clone("/src/api", "git@github.com:acme/api.git");
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t.tick();
    let tick = Duration::from_secs(600);

    let removed = t.cli(&["repo", "rm", "acme/api", "--json"]);
    // Ready now, but the Repo takes no new work.
    t.world.add_issue("acme/api", github_issue("acme/api", 8));
    implementer_idle(&t, 7);
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.world.advance(tick);
    t.world.calls.borrow_mut().clear();
    let mut night = vec![t.tick()];
    let reviewer_start =
        (t.world.calls().into_iter()).find(|c| c.starts_with("herdr agent start rev-"));
    let verdict = t.cli(&["verdict", "acme/api#7", "pass", "--sha", "sha9", "--json"]);
    t.world.advance(tick);
    night.push(t.tick());
    t.world.agents.borrow_mut().remove("impl-api-7");
    t.world.advance(tick);
    night.push(t.tick());
    t.world.prs.borrow_mut()[0].state = PrState::Merged;
    t.world.advance(tick);
    night.push(t.tick());

    assert_eq!(
        removed.json(),
        json!({
            "repo": "acme/api removed",
            "stays": ["the clone at /src/api", "acme/api#7, In flight till it is Closed"],
        })
    );
    assert_eq!(verdict.exit_code, 0, "{}", verdict.stdout);
    assert_eq!(
        night,
        [
            vec![
                "acme/api#7: PR https://github.com/acme/api/pull/9 found",
                "acme/api#7: Reviewer started on codex for sha9",
            ],
            vec!["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"],
            vec!["acme/api#7 restarted: rebooted"],
            vec!["acme/api#7 Closed: its PR https://github.com/acme/api/pull/9 merged"],
        ]
    );
    // Trusting the clone it was dispatched from.
    assert_eq!(
        reviewer_start.as_deref(),
        Some(
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p3 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#
        )
    );
}

#[test]
fn a_bad_invocation_exits_2_with_the_usage_before_any_outside_call() {
    let t = setup();
    let usage = "Run `nico-agent repo add <owner/name> --path <clone> [--project <name>] [--linear-team <team> --linear-project <project> --linear-label <label>]` to add a Repo";
    let cases: [(&[&str], &str); 8] = [
        (&["repo", "add", "acme/api"], "missing required flag --path"),
        (
            &["repo", "add", "--path", "/src/api"],
            "<owner/name> is required",
        ),
        (
            &["repo", "add", "acme", "--path", "/src/api"],
            "`acme` is not an owner/name slug",
        ),
        (
            &["repo", "add", "acme/api", "--path"],
            "--path needs a value",
        ),
        (
            &[
                "repo", "add", "acme/api", "--path", "/src/api", "--room", "4",
            ],
            "unknown flag --room for `repo add`",
        ),
        (
            &["repo", "add", "acme/api", "extra", "--path", "/src/api"],
            "unexpected argument `extra` for `repo add`",
        ),
        (
            &[
                "repo",
                "add",
                "acme/api",
                "--path",
                "/src/api",
                "--linear-project",
                "P",
            ],
            "--linear-project and --linear-label need --linear-team",
        ),
        (
            &[
                "repo",
                "add",
                "acme/api",
                "--path",
                "/src/api",
                "--project",
                " shop",
            ],
            "` shop` is not a Project's name",
        ),
    ];

    for (argv, error) in cases {
        let ran = t.cli(&[argv, &["--json"]].concat());
        assert_eq!(ran.exit_code, 2, "{argv:?}");
        assert_eq!(
            ran.json(),
            json!({ "error": error, "help": [usage] }),
            "{argv:?}"
        );
    }
    let bare = t.cli(&["repo", "--json"]);
    assert_eq!(bare.exit_code, 2);
    assert_eq!(
        bare.json()["error"],
        "`repo` needs a subcommand: add, rm or list"
    );
    assert_eq!(bare.json()["help"].as_array().unwrap().len(), 3);
    assert_eq!(
        t.cli(&["repo", "rm", "--json"]).json()["error"],
        "<owner/name> is required"
    );
    assert!(t.world.calls().is_empty());
}

#[test]
fn any_github_remote_form_of_the_slug_is_a_clone_of_it() {
    let t = setup();
    let remotes = [
        ("/src/a", "https://github.com/Acme/API.git"),
        (
            "/src/b",
            "https://x-access-token:secret@github.com/acme/api",
        ),
        ("/src/c", "ssh://git@github.com/acme/api.git/"),
        ("/src/d", "git@github.com:acme/api"),
    ];
    for (path, remote) in remotes {
        t.world
            .add_clone(path, &["https://gitlab.com/acme/api.git", remote]);
    }

    for (path, _) in remotes {
        let added = t.cli(&["repo", "add", "acme/api", "--path", path, "--json"]);
        assert_eq!(added.exit_code, 0, "{path}: {}", added.stdout);
    }
}
