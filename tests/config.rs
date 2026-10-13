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

/// The Projects `status` shows, each as written: its name, Repos and
/// defaults, without the settings it shows of them.
fn written(status: &serde_json::Value) -> serde_json::Value {
    let projects = status["projects"].as_array().expect("projects");
    (projects.iter())
        .map(|p| json!({ "name": p["name"], "repos": p["repos"], "defaults": p["defaults"] }))
        .collect()
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
            "config.toml line 3: repos.acme/api.rom: unknown field `rom`, expected one of `path`, `linear`, `project`, `install`, `room`, `base`, `implementer`, `reviewer`, `quality_scan`, `faux_nico`, `switches`",
        ),
        (
            "\n[repos.\"acme/api\"]\nroom = 2\n",
            "config.toml line 2: repos.acme/api: missing field `path`",
        ),
        // A launch is taken whole, so one written without its Harness gets none.
        (
            "[repos.\"acme/api\"]\npath = \"/src/api\"\nimplementer = { model = \"opus\" }\n",
            "config.toml line 3: repos.acme/api.implementer: missing field `harness`",
        ),
        (
            "stall_minutes = 0\n",
            "config.toml line 1: stall_minutes: invalid value: integer `0`, expected a nonzero u32",
        ),
        (
            "\nport = 0\n",
            "config.toml line 2: port: invalid value: integer `0`, expected a nonzero u16",
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
            "answer": false, "gardening": true, "quality_scan": false, "wiki": false,
        })
    );
}

/// Two Repos of the Project `shop`, each setting some of what it holds.
const PROJECT: &str = r#"
[projects.shop]
room = 2
base = "develop"
implementer = { harness = "codex", model = "gpt-5", effort = "high" }
switches = { review = false, gardening = true }

[repos."acme/api"]
path = "/src/api"
project = "shop"

[repos."acme/web"]
path = "/src/web"
project = "shop"
room = 5
implementer = { harness = "claude" }
switches = { gardening = false, stack = false }
"#;

#[test]
fn a_project_s_value_reaches_its_repos_and_a_repo_s_own_wins() {
    let t = with_config(PROJECT);

    let repos = t.cli(&["repo", "list", "--json"]).json()["repos"].clone();

    let (api, web) = (&repos[0], &repos[1]);
    assert_eq!((&api["room"], &web["room"]), (&json!(2), &json!(5)));
    assert_eq!(
        (&api["base"], &web["base"]),
        (&json!("develop"), &json!("develop"))
    );
    assert_eq!(
        api["implementer"],
        json!({ "harness": "codex", "model": "gpt-5", "effort": "high" })
    );
    // A launch is replaced whole: the Project's model and Effort stay out.
    assert_eq!(
        web["implementer"],
        json!({ "harness": "claude", "model": null, "effort": null })
    );
    let switches = json!({
        "dispatch": true, "stack": true, "review": false, "restart": true, "flip": true,
        "answer": false, "gardening": true, "quality_scan": false, "wiki": false,
    });
    assert_eq!(api["switches"], switches);
    let mut web_switches = switches;
    web_switches["gardening"] = json!(false);
    web_switches["stack"] = json!(false);
    assert_eq!(web["switches"], web_switches);
}

#[test]
fn repo_list_shows_each_repo_s_project_its_own_named_by_its_slug_without_one() {
    let t = with_config(&format!(
        "{PROJECT}\n[repos.\"acme/cli\"]\npath = \"/src/cli\"\n"
    ));

    let repos = t.cli(&["repo", "list", "--json"]).json()["repos"].clone();

    let projects: Vec<(&str, &str)> = (repos.as_array().unwrap().iter())
        .map(|r| (r["slug"].as_str().unwrap(), r["project"].as_str().unwrap()))
        .collect();
    assert_eq!(
        projects,
        [
            ("acme/api", "shop"),
            ("acme/cli", "acme/cli"),
            ("acme/web", "shop")
        ]
    );
}

#[test]
fn a_repo_without_project_takes_the_defaults_of_the_project_named_by_its_slug() {
    let t = with_config(
        "[projects.\"acme/cli\"]\nroom = 4\n\n[repos.\"acme/cli\"]\npath = \"/src/cli\"\n",
    );

    let status = t.cli(&["status", "--json"]).json();

    assert_eq!(
        status["repos"][0]["room"],
        json!({ "value": 4, "from": "project" })
    );
    assert_eq!(
        written(&status),
        json!([{ "name": "acme/cli", "repos": ["acme/cli"], "defaults": { "room": 4 } }])
    );
    assert_eq!(
        status["projects"][0]["room"],
        json!({ "value": 4, "from": "project" })
    );
}

#[test]
fn status_shows_each_project_and_where_each_setting_of_a_repo_comes_from() {
    let t = with_config(&format!(
        r#"{PROJECT}
[repos."acme/cli"]
path = "/src/cli"
reviewer = {{ harness = "opencode" }}

[repos."acme/docs"]
path = "/src/docs"
project = "docs"
"#
    ));

    let status = t.cli(&["status", "--json"]).json();

    assert_eq!(
        written(&status),
        json!([
            { "name": "acme/cli", "repos": ["acme/cli"], "defaults": {} },
            { "name": "docs", "repos": ["acme/docs"], "defaults": {} },
            {
                "name": "shop",
                "repos": ["acme/api", "acme/web"],
                "defaults": {
                    "room": 2,
                    "base": "develop",
                    "implementer": { "harness": "codex", "model": "gpt-5", "effort": "high" },
                    "switches": { "gardening": true, "review": false },
                },
            },
        ])
    );
    let setting = |value: serde_json::Value, from: &str| json!({ "value": value, "from": from });
    let launch = |harness: &str| json!({ "harness": harness, "model": null, "effort": null });
    let gpt_5 = json!({ "harness": "codex", "model": "gpt-5", "effort": "high" });
    let switches = |set: &[(&str, bool, &str)]| {
        let mut all = json!({
            "dispatch": setting(json!(true), "default"),
            "stack": setting(json!(true), "default"),
            "review": setting(json!(true), "default"),
            "restart": setting(json!(true), "default"),
            "flip": setting(json!(true), "default"),
            "answer": setting(json!(false), "default"),
            "gardening": setting(json!(false), "default"),
            "quality_scan": setting(json!(false), "default"),
            "wiki": setting(json!(false), "default"),
        });
        for (name, on, from) in set {
            all[name] = setting(json!(on), from);
        }
        all
    };
    let settings = |repo: &serde_json::Value| {
        let keys = [
            "room",
            "base",
            "implementer",
            "reviewer",
            "quality_scan",
            "faux_nico",
            "switches",
        ];
        let shown = keys.map(|key| (key.to_string(), repo[key].clone()));
        serde_json::Value::Object(shown.into_iter().collect())
    };
    let repos = &status["repos"];
    assert_eq!(
        (&repos[0]["slug"], settings(&repos[0])),
        (
            &json!("acme/api"),
            json!({
                "room": setting(json!(2), "project"),
                "base": setting(json!("develop"), "project"),
                "implementer": setting(gpt_5.clone(), "project"),
                // Another Harness than the implementer's, as by default.
                "reviewer": setting(launch("claude"), "default"),
                "quality_scan": setting(gpt_5.clone(), "default"),
                "faux_nico": setting(gpt_5.clone(), "default"),
                "switches": switches(&[("review", false, "project"), ("gardening", true, "project")]),
            })
        )
    );
    // A Project's own, or the defaults: what a Repo of it that sets none takes.
    assert_eq!(
        settings(&status["projects"][2]),
        json!({
            "room": setting(json!(2), "project"),
            "base": setting(json!("develop"), "project"),
            "implementer": setting(gpt_5.clone(), "project"),
            "reviewer": setting(launch("claude"), "default"),
            "quality_scan": setting(gpt_5.clone(), "default"),
            "faux_nico": setting(gpt_5, "default"),
            "switches": switches(&[("review", false, "project"), ("gardening", true, "project")]),
        })
    );
    assert_eq!(
        (&repos[1]["slug"], settings(&repos[1])),
        (
            &json!("acme/cli"),
            json!({
                "room": setting(json!(3), "default"),
                "base": setting(json!(null), "default"),
                "implementer": setting(launch("claude"), "default"),
                "reviewer": setting(launch("opencode"), "repo"),
                "quality_scan": setting(launch("claude"), "default"),
                "faux_nico": setting(launch("claude"), "default"),
                "switches": switches(&[]),
            })
        )
    );
    assert_eq!(repos[2]["room"], setting(json!(3), "default"));
    assert_eq!(
        (&repos[3]["slug"], settings(&repos[3])),
        (
            &json!("acme/web"),
            json!({
                "room": setting(json!(5), "repo"),
                "base": setting(json!("develop"), "project"),
                "implementer": setting(launch("claude"), "repo"),
                "reviewer": setting(launch("codex"), "default"),
                "quality_scan": setting(launch("claude"), "default"),
                "faux_nico": setting(launch("claude"), "default"),
                "switches": switches(&[
                    ("review", false, "project"),
                    ("gardening", false, "repo"),
                    ("stack", false, "repo"),
                ]),
            })
        )
    );
}

#[test]
fn a_bad_key_or_launch_in_a_project_is_refused_at_its_own_line() {
    let repo = "[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"shop\"\n\n";
    let switches = "`dispatch`, `stack`, `review`, `restart`, `flip`, `answer`, `gardening`, `quality_scan`, `wiki`";
    let cases = [
        (
            format!("{repo}[projects.shop]\npath = \"/src/shop\"\n"),
            "config.toml line 6: projects.shop.path: unknown field `path`, expected one of `room`, `base`, `implementer`, `reviewer`, `quality_scan`, `faux_nico`, `switches`".to_string(),
        ),
        // A Repo's Install runs in its own clone: no Project holds one.
        (
            format!("{repo}[projects.shop]\nroom = 2\ninstall = \"make\"\n"),
            "config.toml line 7: projects.shop.install: unknown field `install`, expected one of `room`, `base`, `implementer`, `reviewer`, `quality_scan`, `faux_nico`, `switches`".to_string(),
        ),
        (
            format!("{repo}[projects.shop]\nroom = 0\n"),
            "config.toml line 6: projects.shop.room: invalid value: integer `0`, expected a nonzero u32".to_string(),
        ),
        (
            format!("{repo}[projects.shop]\nswitches = {{ revew = false }}\n"),
            format!("config.toml line 6: projects.shop.switches.revew: unknown field `revew`, expected one of {switches}"),
        ),
    ];
    for (text, error) in cases {
        let t = with_config(&text);
        assert_eq!(
            refusal(&t),
            (
                error,
                vec!["Fix it in config.toml and run the command again".to_string()]
            ),
        );
    }

    let t = with_config(&format!(
        "{repo}[projects.shop]\nroom = 2\nreviewer = {{ harness = \"pi\" }}\n"
    ));
    assert_eq!(
        refusal(&t),
        (
            "config.toml line 7: projects.shop.reviewer.harness: `pi` is not a Harness".to_string(),
            vec![
                "Fix it in config.toml and run the command again".to_string(),
                "Harnesses: claude, codex, opencode".to_string(),
            ],
        )
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
    // Each add made the Bucket, if missing, under the Bucket's lock.
    assert_eq!(files, ["bucket.lock", "config.toml", "config.toml.lock"]);
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
            .ends_with("line 1: room: unknown field `room`, expected one of `repos`, `projects`, `harnesses`, `bucket`, `quality_scan`, `morning`, `wiki`, `prompts`, `tick_minutes`, `stall_minutes`, `max_restarts_per_reason`, `port`")
    );
    assert_eq!(
        fs::read_to_string(t.config_dir.join("config.toml")).unwrap(),
        "room = \"three\"\n"
    );
}
