mod common;

use common::{Setup, setup};
use serde_json::{Value, json};

/// How the fetch check asks origin: never prompting, so a key not loaded fails at once.
const LS_REMOTE: &str = "GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND=\"ssh -o BatchMode=yes -o ConnectTimeout=10\" git -C /src/api ls-remote origin";

/// Repo `acme/api` with everything its Readiness checks look for: a clone
/// of it, `.evidence/` ignored and a Verification skill on `main`, the
/// skills its steps name for claude and codex (its Reviewer's), and the
/// GitHub App on it; no calls recorded yet.
fn ready() -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    let tip = |file: &str, text: &str| t.world.add_tree_file("/src/api", "origin/main", file, text);
    tip(".gitignore", "target/\n.evidence/\n");
    tip(
        ".agents/skills/verify-api/SKILL.md",
        "---\nname: verify-api\n---\n",
    );
    for skill in ["~/.claude/skills/implement", "~/.claude/skills/research"] {
        t.world.add_file(&format!("{skill}/SKILL.md"), b"");
    }
    t.world.add_file("~/.agents/skills/verdict/SKILL.md", b"");
    t.world.app_repos.borrow_mut().push("acme/api".into());
    t.world.calls.borrow_mut().clear();
    t
}

fn checks_file(t: &Setup) -> Value {
    let text = std::fs::read_to_string(t.config_dir.join("checks.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn status_checks(t: &Setup) -> Value {
    t.cli(&["status", "--json"]).json()["repos"][0]["checks"].clone()
}

#[test]
fn serve_checks_each_repo_at_start_with_a_call_per_check_and_keeps_each_result() {
    let t = ready();

    let ran = t.cli(&["serve"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let calls = t.world.calls();
    let listen = calls.iter().position(|c| c.starts_with("listen ")).unwrap();
    assert_eq!(
        calls[..listen],
        [
            "git remotes /src/api",
            LS_REMOTE,
            "git -C /src/api default-branch",
            "git -C /src/api fetch origin +refs/heads/main:refs/remotes/origin/main",
            "git -C /src/api show origin/main:.gitignore",
            "git -C /src/api ls-tree --name-only origin/main .agents/skills/",
            "test -f ~/.claude/skills/implement/SKILL.md",
            "read ~/.claude/skills/implement/SKILL.md",
            "test -f ~/.claude/skills/research/SKILL.md",
            "read ~/.claude/skills/research/SKILL.md",
            "test -f ~/.codex/skills/verdict/SKILL.md",
            "test -f ~/.agents/skills/verdict/SKILL.md",
            "read ~/.agents/skills/verdict/SKILL.md",
            "github app repos",
            "herdr agent list",
        ]
    );
    let ok =
        |name: &str, said: &str| json!({ "name": name, "ok": true, "said": said, "help": null });
    let checks = json!({
        "at": "2026-09-30T12:00:00Z",
        "results": [
            ok("clone", "/src/api is a clone of acme/api"),
            ok("fetch", "/src/api fetches from origin without asking"),
            ok("evidence", ".evidence/ is ignored on main"),
            ok("verification", "main has the Verification skill verify-api"),
            ok("skills", "each skill a step names is installed for its Harness"),
            ok("bot", "the GitHub App is installed on acme/api"),
            ok("herdr", "herdr answers `herdr agent list`"),
        ],
    });
    assert_eq!(checks_file(&t), json!({ "acme/api": checks }));
    assert_eq!(status_checks(&t), checks);
}

/// The Repo's checks after `serve` starts.
fn served(t: &Setup) -> Value {
    let ran = t.cli(&["serve"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    status_checks(t)["results"].clone()
}

fn failing(name: &str, said: &str, help: &str) -> Value {
    json!({ "name": name, "ok": false, "said": said, "help": help })
}

#[test]
fn each_failing_check_says_what_will_break_and_the_help_to_fix_it() {
    let t = ready();
    let denied =
        "`git ls-remote origin` failed in /src/api: git@github.com: Permission denied (publickey).";
    t.world.fail_call(LS_REMOTE, denied);
    set_repo(&t, "base = \"main\"\n");
    t.world.tree.borrow_mut().clear();
    t.world
        .add_tree_file("/src/api", "origin/main", ".gitignore", "target/\n");
    t.world.files.borrow_mut().clear();
    t.world.app_repos.borrow_mut().clear();

    let results = served(&t);

    let install = |skill: &str, dirs: &str| format!("Install {skill} in one of {dirs}");
    let claude = "~/.claude/skills, /src/api/.claude/skills";
    assert_eq!(
        results,
        json!([
            { "name": "clone", "ok": true, "said": "/src/api is a clone of acme/api", "help": null },
            failing("fetch", denied, "Load its key with `ssh-add`, or set origin to its https URL"),
            failing("evidence", ".evidence/ is not ignored on main", "Add `.evidence/` to the Base's .gitignore, or Close cannot remove a worktree"),
            failing("verification", "main has no Verification skill under .agents/skills/verify-*/", "Add the Repo's Verification skill as .agents/skills/verify-<name>/ on the Base; without it every Verdict fails"),
            failing(
                "skills",
                "no implement skill for claude, the Implementer's Harness; no research skill for claude, the Implementer's Harness; no verdict skill for codex, the Reviewer's Harness",
                &[
                    install("implement", claude),
                    install("research", claude),
                    install("verdict", "~/.codex/skills, ~/.agents/skills, /src/api/.agents/skills"),
                ].join("; "),
            ),
            // Without the App its PRs are opened as the user, a choice, not a failure.
            { "name": "bot", "ok": true, "said": "the GitHub App is not installed on acme/api, so its PRs are opened as you", "help": null },
            { "name": "herdr", "ok": true, "said": "herdr answers `herdr agent list`", "help": null },
        ])
    );
    // origin did not answer: the Base's tip is the clone's, unfetched.
    assert!(!t.world.calls().iter().any(|c| c.contains(" fetch origin")));
}

/// Append `toml` to `acme/api`'s table, the last in config.toml.
fn set_repo(t: &Setup, toml: &str) {
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, format!("{config}{toml}")).unwrap();
}

#[test]
fn with_origin_asking_and_no_base_set_the_base_s_tip_is_not_checked_rather_than_origin_asked_for_its_default_branch()
 {
    let t = ready();
    t.world.fail_call(
        LS_REMOTE,
        "`git ls-remote origin` failed in /src/api: Host key verification failed.",
    );

    let results = served(&t);

    let names: Vec<&str> = (results.as_array().unwrap().iter())
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["clone", "fetch", "skills", "bot", "herdr"]);
    assert!(
        !t.world
            .calls()
            .iter()
            .any(|c| c.ends_with("default-branch"))
    );
}

#[test]
fn a_harness_that_names_no_skill_dirs_fails_the_skills_check_asking_for_them() {
    let t = ready();
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    let mine = "[harnesses.mine]\nlaunch_mode = \"herdr-kind\"\nkind = \"mine\"\nsigil = \"/\"\nmodel_args = []\neffort_args = []\n";
    std::fs::write(
        &file,
        format!("{mine}{config}reviewer = {{ harness = \"mine\" }}\n"),
    )
    .unwrap();

    let results = served(&t);

    assert_eq!(
        results[4],
        failing(
            "skills",
            "no verdict skill for mine, the Reviewer's Harness",
            "Set harnesses.mine.skill_dirs to where mine reads skills"
        )
    );
}

#[test]
fn a_herdr_server_older_than_its_client_fails_the_herdr_check() {
    // After an upgrade, a server still on the old protocol refuses every call till it restarts.
    let t = ready();
    let mismatch =
        "`herdr agent list` failed: protocol_mismatch: client protocol 22, server protocol 20";
    t.world.fail_call("herdr agent list", mismatch);

    let results = served(&t);

    let herdr = (results.as_array().unwrap().iter()).find(|r| r["name"] == "herdr");
    assert_eq!(
        herdr.unwrap(),
        &failing(
            "herdr",
            mismatch,
            "Start herdr; after an upgrade, `herdr server stop` and start it again so the server's protocol matches the client's"
        )
    );
}

#[test]
fn failing_checks_stop_no_step_of_the_loop() {
    let t = ready();
    t.world.clones.borrow_mut().clear();
    t.world.app_repos.borrow_mut().clear();
    t.world
        .add_issue("acme/api", common::github_issue("acme/api", 7));

    let said = t.tick();

    assert_eq!(said, ["acme/api#7 dispatched"]);
    assert_eq!(status_checks(&t)["results"][0]["ok"], false);
}

#[test]
fn a_path_that_is_no_longer_a_clone_fails_the_clone_check_and_the_checks_in_it_are_not_run() {
    let t = ready();
    t.world.clones.borrow_mut().clear();
    t.world.fail_call(
        "github app repos",
        "`ghbot` is not installed or not on PATH",
    );

    let results = served(&t);

    assert_eq!(
        results,
        json!([
            failing("clone", "/src/api is not a git clone", "Run `git clone https://github.com/acme/api /src/api` first, or pass the path of an existing clone"),
            { "name": "skills", "ok": true, "said": "each skill a step names is installed for its Harness", "help": null },
            failing("bot", "could not check the GitHub App on acme/api: `ghbot` is not installed or not on PATH", "Run `ghbot api /installation/repositories` to see why; till then its PRs are opened as you, not the bot"),
            { "name": "herdr", "ok": true, "said": "herdr answers `herdr agent list`", "help": null },
        ])
    );
    assert!(
        !t.world
            .calls()
            .iter()
            .any(|c| c.starts_with("git -C /src/api"))
    );
}

#[test]
fn a_reviewer_on_a_harness_with_no_verdict_skill_fails_the_skills_check_before_any_reviewer_starts()
{
    // #279's night: the verdict skill was linked for claude only, and every Reviewer ran on codex.
    let t = ready();
    t.world
        .files
        .borrow_mut()
        .remove("~/.agents/skills/verdict/SKILL.md");
    t.world.add_file("~/.claude/skills/verdict/SKILL.md", b"");

    let results = served(&t);

    assert_eq!(
        results[4],
        failing(
            "skills",
            "no verdict skill for codex, the Reviewer's Harness",
            "Install verdict in one of ~/.codex/skills, ~/.agents/skills, /src/api/.agents/skills"
        )
    );
}

#[test]
fn a_skill_the_prompted_skill_calls_is_checked_for_the_same_harness_one_level_deep() {
    let t = ready();
    t.world.add_file(
        "~/.agents/skills/verdict/SKILL.md",
        b"Call the Skill tool with \"tdd\" first, then the Skill tool with \"pr\".",
    );
    t.world.add_file(
        "~/.agents/skills/tdd/SKILL.md",
        b"Call the Skill tool with \"deeper\".",
    );

    let results = served(&t);

    // `deeper`, two levels down, is not asked for.
    assert_eq!(
        results[4],
        failing(
            "skills",
            "no pr skill for codex, the Reviewer's Harness, which verdict calls",
            "Install pr in one of ~/.codex/skills, ~/.agents/skills, /src/api/.agents/skills"
        )
    );

    t.world.add_file("/src/api/.agents/skills/pr/SKILL.md", b"");
    assert_eq!(served(&t)[4]["ok"], true);
}

#[test]
fn a_skill_installed_only_as_a_claude_plugin_is_found_for_claude_and_said_so_for_another_harness() {
    let t = ready();
    let call = b"Call the Skill tool with \"ponytail-audit\".";
    t.world
        .add_file("~/.claude/skills/implement/SKILL.md", call);
    t.world.add_file("~/.agents/skills/verdict/SKILL.md", call);
    let plugin = "/home/u/.claude/plugins/cache/ponytail/ponytail/5.1.0";
    t.world.add_file(
        "~/.claude/plugins/installed_plugins.json",
        format!(
            r#"{{"version":2,"plugins":{{"ponytail@ponytail":[{{"installPath":"{plugin}"}}]}}}}"#
        )
        .as_bytes(),
    );
    t.world
        .add_file(&format!("{plugin}/skills/ponytail-audit/SKILL.md"), b"");

    let results = served(&t);

    assert_eq!(
        results[4],
        failing(
            "skills",
            "no ponytail-audit skill for codex, the Reviewer's Harness, which verdict calls; it is installed only as a claude plugin",
            "Install ponytail-audit in one of ~/.codex/skills, ~/.agents/skills, /src/api/.agents/skills"
        )
    );
}

#[test]
fn the_skills_check_asks_for_faux_nico_and_quality_scan_only_while_their_switches_are_on_and_finds_skills_in_the_clone()
 {
    let t = ready();
    set_repo(
        &t,
        "switches = { answer = true, quality_scan = true, review = false }\nfaux_nico = { harness = \"opencode\" }\n",
    );
    t.world
        .add_file("/src/api/.claude/skills/quality-scan/SKILL.md", b"");

    let results = served(&t);

    let asked: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("test -f"))
        .collect();
    assert_eq!(
        asked,
        [
            "test -f ~/.claude/skills/implement/SKILL.md",
            "test -f ~/.claude/skills/research/SKILL.md",
            "test -f ~/.config/opencode/skills/faux-nico/SKILL.md",
            "test -f ~/.claude/skills/faux-nico/SKILL.md",
            "test -f ~/.agents/skills/faux-nico/SKILL.md",
            "test -f /src/api/.opencode/skills/faux-nico/SKILL.md",
            "test -f /src/api/.claude/skills/faux-nico/SKILL.md",
            "test -f /src/api/.agents/skills/faux-nico/SKILL.md",
            "test -f ~/.claude/skills/quality-scan/SKILL.md",
            "test -f /src/api/.claude/skills/quality-scan/SKILL.md",
        ]
    );
    assert_eq!(
        results[3]["said"],
        "no faux-nico skill for opencode, faux-nico's Harness"
    );
}

#[test]
fn a_repo_that_does_not_review_has_no_verification_check() {
    let t = ready();
    set_repo(&t, "switches = { review = false }\n");

    let results = served(&t);

    let names: Vec<&str> = (results.as_array().unwrap().iter())
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["clone", "fetch", "evidence", "skills", "bot", "herdr"]
    );
    assert!(!t.world.calls().iter().any(|c| c.contains(" ls-tree ")));
}

#[test]
fn evidence_is_ignored_by_a_line_naming_the_root_s_evidence_folder_till_a_later_line_negates_it() {
    for (gitignore, ignored) in [
        ("/.evidence/\n", true),
        ("target/\n.evidence/**\n", true),
        ("**/.evidence\n", true),
        ("# .evidence/\n.evidence-old/\n", false),
        (".evidence/\n!.evidence/\n", false),
        ("!.evidence/\n.evidence/\n", true),
    ] {
        let t = ready();
        t.world
            .add_tree_file("/src/api", "origin/main", ".gitignore", gitignore);

        let results = served(&t);

        assert_eq!(results[2]["ok"], ignored, "{gitignore:?}");
    }
}

/// How many times the Repo was checked among `calls`: its fetch check's call, once a check.
fn times_checked(calls: &[String]) -> usize {
    calls.iter().filter(|c| *c == LS_REMOTE).count()
}

#[test]
fn a_tick_of_serve_after_its_start_runs_no_check() {
    let t = ready();
    t.world.timer_runs.set(2);

    t.cli(&["serve"]);

    assert_eq!(times_checked(&t.world.calls()), 1);
}

#[test]
fn refresh_checks_every_repo_again_after_its_tick() {
    let t = ready();
    t.cli(&["serve"]);
    t.world.files.borrow_mut().clear();
    t.world.calls.borrow_mut().clear();

    let refreshed = t.cli(&["refresh", "--json"]);
    let answered = t.send("POST", "/api/refresh", "");

    assert_eq!(refreshed.exit_code, 0, "{}", refreshed.stdout);
    assert_eq!(answered.0, 200, "{}", answered.1);
    let calls = t.world.calls();
    assert_eq!(times_checked(&calls), 2);
    assert_eq!(calls.last().unwrap(), "herdr agent list");
    assert_eq!(status_checks(&t)["results"][4]["ok"], false);
}

/// `ready` with a second Repo, `acme/web`, in the Project `shop` with
/// `acme/api`, and serve started; no calls recorded since.
fn shop() -> Setup {
    let t = ready();
    t.world
        .add_clone("/src/web", &["git@github.com:acme/web.git"]);
    t.cli(&[
        "repo",
        "add",
        "acme/web",
        "--path",
        "/src/web",
        "--project",
        "shop",
    ]);
    t.cli(&["serve"]);
    t.world.calls.borrow_mut().clear();
    t
}

#[test]
fn a_write_to_a_repo_s_settings_checks_that_repo_and_one_to_a_project_s_checks_its_repos() {
    let t = shop();

    let repo = t.send("PATCH", "/api/repo/acme/api", r#"{"project": "shop"}"#);
    let after_repo = t.world.calls.borrow_mut().drain(..).collect::<Vec<_>>();
    let switches = t.send(
        "PATCH",
        "/api/repo/acme/api/switches",
        r#"{"review": false}"#,
    );
    let after_switches = t.world.calls.borrow_mut().drain(..).collect::<Vec<_>>();
    let project = t.send("PATCH", "/api/project/shop", r#"{"room": 2}"#);
    let after_project = t.world.calls();

    for (status, body) in [repo, switches, project] {
        assert_eq!(status, 200, "{body}");
    }
    let checked =
        |calls: &[String], path: &str| (calls.iter()).any(|c| c == &format!("git remotes {path}"));
    assert!(checked(&after_repo, "/src/api") && !checked(&after_repo, "/src/web"));
    assert!(checked(&after_switches, "/src/api") && !checked(&after_switches, "/src/web"));
    assert!(checked(&after_project, "/src/api") && checked(&after_project, "/src/web"));
    // review off: the Reviewer's verdict skill is no longer asked for.
    assert!(!after_switches.iter().any(|c| c.contains("/verdict/")));
}

#[test]
fn changed_is_sent_only_when_a_check_s_result_flips_and_at_says_since_when() {
    let t = ready();
    t.tick();
    let mut events = t.events();
    t.world.advance(std::time::Duration::from_secs(60));

    t.tick();
    let same = events.next();
    let unmoved = status_checks(&t)["at"].clone();
    t.world.app_repos.borrow_mut().clear();
    t.world.advance(std::time::Duration::from_secs(60));
    t.tick();
    let flipped = events.next();
    let moved = status_checks(&t)["at"].clone();

    assert_eq!(same, ": keepalive\n\n");
    assert_eq!(unmoved, "2026-09-30T12:00:00Z");
    assert_eq!(flipped, "event: changed\ndata: {}\n\n");
    assert_eq!(moved, "2026-09-30T12:02:00Z");
}
