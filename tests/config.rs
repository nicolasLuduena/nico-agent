mod common;

use std::fs;

use common::{Setup, setup};
use serde_json::json;

fn with_config(text: &str) -> Setup {
    let t = setup();
    fs::create_dir_all(&t.config_dir).unwrap();
    fs::write(t.config_dir.join("config.toml"), text).unwrap();
    t
}

/// What `repo list` refuses the config with: its error and help.
fn refusal(t: &Setup) -> (String, Vec<String>) {
    let ran = t.cli(&["repo", "list", "--json"]);
    assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
    let answer = ran.json();
    let file = t.config_dir.join("config.toml").display().to_string();
    let error = answer["error"]
        .as_str()
        .unwrap()
        .replace(&file, "config.toml");
    let help = answer["help"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h.as_str().unwrap().replace(&file, "config.toml"))
        .collect();
    (error, help)
}

#[test]
fn a_bad_value_is_refused_naming_its_key_and_line() {
    let cases = [
        (
            "tick_minutes = 5\n\n[repos.\"acme/api\"]\npath = \"/src/api\"\nroom = \"three\"\n",
            "config.toml line 5: repos.acme/api.room: invalid type: string \"three\", expected a nonzero u32",
        ),
        (
            "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { dispatch = \"yes\" }\n",
            "config.toml line 3: repos.acme/api.switches.dispatch: invalid type: string \"yes\", expected a boolean",
        ),
        (
            "[repos.\"acme/api\"]\npath = \"/src/api\"\nrom = 3\n",
            "config.toml line 3: repos.acme/api.rom: unknown field `rom`, expected one of `path`, `linear`, `room`, `base`, `implementer`, `reviewer`, `switches`",
        ),
        (
            "\n[repos.\"acme/api\"]\nroom = 2\n",
            "config.toml line 2: repos.acme/api: missing field `path`",
        ),
        (
            "stall_minutes = 0\n",
            "config.toml line 1: stall_minutes: invalid value: integer `0`, expected a nonzero u32",
        ),
        (
            "[repos.\"acme/api\"\npath = 1\n",
            "config.toml line 1: unclosed table, expected `]`",
        ),
        (
            "[harnesses.pi]\nlaunch_mode = \"pane-command\"\nsigil = \"/\"\nmodel_args = []\neffort_args = []\n",
            "config.toml line 1: harnesses.pi: a pane-command Harness needs command",
        ),
    ];

    for (text, error) in cases {
        let t = with_config(text);
        assert_eq!(
            refusal(&t),
            (
                error.to_string(),
                vec!["Fix it in config.toml and run the command again".to_string()]
            ),
        );
    }
}

#[test]
fn a_launch_on_an_unknown_harness_is_refused_listing_the_harnesses() {
    let t = with_config(
        "[repos.\"acme/api\"]\npath = \"/src/api\"\nreviewer = { harness = \"pi\", model = \"x\" }\n",
    );

    assert_eq!(
        refusal(&t),
        (
            "config.toml line 3: repos.acme/api.reviewer.harness: `pi` is not a Harness"
                .to_string(),
            vec![
                "Fix it in config.toml and run the command again".to_string(),
                "Harnesses: claude, codex, opencode".to_string(),
            ],
        )
    );
}

#[test]
fn what_the_user_sets_is_kept_and_the_rest_defaulted() {
    let t = with_config(
        r#"
[harnesses.pi]
launch_mode = "herdr-kind"
kind = "pi"
sigil = "/"
model_args = []
effort_args = []

[repos."acme/api"]
path = "/src/api"
room = 1
base = "develop"
implementer = { harness = "codex", model = "gpt-5", effort = "high" }

[repos."acme/api".switches]
dispatch = false
gardening = true
"#,
    );

    let repos = t.cli(&["repo", "list", "--json"]).json()["repos"].clone();

    assert_eq!(repos[0]["room"], 1);
    assert_eq!(repos[0]["base"], "develop");
    assert_eq!(
        repos[0]["implementer"],
        json!({ "harness": "codex", "model": "gpt-5", "effort": "high" })
    );
    assert_eq!(
        repos[0]["reviewer"],
        json!({ "harness": "claude", "model": null, "effort": null })
    );
    assert_eq!(
        repos[0]["switches"],
        json!({
            "dispatch": false, "stack": true, "review": true, "restart": true, "flip": true,
            "answer": false, "gardening": true, "quality_scan": false,
        })
    );
}

#[test]
fn repo_add_keeps_what_the_user_wrote_around_its_entry() {
    let hand_written = r#"# my loop
tick_minutes = 5 # quicker

[prompts]
implement = "{sigil}implement {issueUrl} carefully"

[repos."acme/web"]
path = "/src/web"
room = 1 # web is fragile
"#;
    let t = with_config(hand_written);
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);

    t.cli(&[
        "repo",
        "add",
        "acme/api",
        "--path",
        "/src/api",
        "--linear-team",
        "BLE",
    ]);

    assert_eq!(
        fs::read_to_string(t.config_dir.join("config.toml")).unwrap(),
        format!(
            "{hand_written}\n[repos.\"acme/api\"]\npath = \"/src/api\"\nlinear = {{ team = \"BLE\" }}\n"
        )
    );
}

#[test]
fn concurrent_writers_leave_a_valid_file_with_every_change() {
    let config_dir = setup().config_dir;
    let writers: Vec<_> = (0..12)
        .map(|i| {
            let config_dir = config_dir.clone();
            std::thread::spawn(move || {
                let t = Setup {
                    world: common::FakeWorld::default(),
                    config_dir,
                };
                let path = format!("/src/r{i}");
                t.world
                    .add_clone(&path, &[&format!("git@github.com:acme/r{i}.git")]);
                t.cli(&["repo", "add", &format!("acme/r{i}"), "--path", &path])
                    .exit_code
            })
        })
        .collect();
    for writer in writers {
        assert_eq!(writer.join().unwrap(), 0);
    }

    let t = Setup {
        world: common::FakeWorld::default(),
        config_dir,
    };
    let listed = t.cli(&["repo", "list", "--json"]);
    assert_eq!(listed.exit_code, 0, "{}", listed.stdout);
    assert_eq!(listed.json()["repos"].as_array().unwrap().len(), 12);
    let mut files: Vec<String> = fs::read_dir(&t.config_dir)
        .unwrap()
        .map(|f| f.unwrap().file_name().into_string().unwrap())
        .collect();
    files.sort();
    assert_eq!(files, ["config.toml", "config.toml.lock"]);
}

#[test]
fn an_invalid_config_is_refused_not_rewritten() {
    let t = with_config("room = \"three\"\n");
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);

    let added = t.cli(&["repo", "add", "acme/api", "--path", "/src/api", "--json"]);

    assert_eq!(added.exit_code, 1);
    assert!(
        added.json()["error"]
            .as_str()
            .unwrap()
            .ends_with("line 1: room: unknown field `room`, expected one of `repos`, `harnesses`, `bucket`, `prompts`, `tick_minutes`, `stall_minutes`, `max_restarts_per_reason`")
    );
    assert_eq!(
        fs::read_to_string(t.config_dir.join("config.toml")).unwrap(),
        "room = \"three\"\n"
    );
}
