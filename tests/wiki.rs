mod common;

use common::{Setup, blob, setup};
use serde_json::{Value, json};

const BUCKET: &str = "/mnt/agents-land/nico-agent-bucket";
const WIKI: &str = "/mnt/agents-land/nico-agent-bucket/wiki/acme/api/wiki.json";

const LIB: &str = "pub mod config;\npub mod web;\n\npub fn run() {}\n";
const CONFIG: &str = "pub struct Config;\n";
const WEB: &str = "export const serve = () => {};\nexport const port = 80;\n";

/// Repo `acme/api` at `/src/api`, with `toml` added to its config, whose
/// `origin/main` holds `src/lib.rs`, `src/config.rs` and `web/app.ts`.
fn with_repo(toml: &str) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_clone(BUCKET, &[]);
    for (file, text) in [
        ("src/lib.rs", LIB),
        ("src/config.rs", CONFIG),
        ("web/app.ts", WEB),
    ] {
        t.world.add_tree_file("/src/api", "origin/main", file, text);
    }
    t
}

/// Where the build checks `acme/api` out.
fn checkout(t: &Setup) -> String {
    t.config_dir
        .join("wiki/acme/api/checkout")
        .display()
        .to_string()
}

/// The part whose prompt names `trail` answers `answer`.
fn answer(t: &Setup, trail: &str, answer: Value) {
    (t.world.headless.borrow_mut()).push((format!("## The part: {trail}"), answer.to_string()));
}

fn interpretation(kind: &str, text: &str, path: &str, start: u64, end: u64) -> Value {
    json!({ "kind": kind, "text": text, "anchors": [{ "path": path, "start": start, "end": end }] })
}

/// The Wiki the Bucket holds.
fn wiki(t: &Setup) -> Value {
    let files = t.world.files.borrow();
    let kept = files.get(WIKI).expect("the Wiki is in the Bucket");
    serde_json::from_slice(kept).unwrap()
}

/// What `wikis.json` keeps of each Wiki's last build.
fn outcomes(t: &Setup) -> Value {
    let text = std::fs::read_to_string(t.config_dir.join("wikis.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

/// The commits made to the Bucket.
fn commits(t: &Setup) -> Vec<String> {
    let prefix = format!("git -C {BUCKET} add -- ");
    (t.world.calls().into_iter())
        .filter(|c| c.starts_with(&prefix))
        .collect()
}

#[test]
fn a_leaf_lands_in_the_bucket_as_one_commit_and_the_build_says_built() {
    let t = with_repo("");
    let role = interpretation(
        "role",
        "lib.rs declares the crate's modules.",
        "src/lib.rs",
        1,
        2,
    );
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API.", "interpretations": [role] }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let built = json!({
        "outcome": "built",
        "at": "2026-09-30T12:00:00Z",
        "commit": "abc1234",
        "components": 1,
        "gaps": {},
    });
    let mut said = built.clone();
    said["wiki"] = json!("acme/api");
    assert_eq!(ran.json(), said);
    assert_eq!(
        wiki(&t),
        json!({
            "version": 1,
            "target": { "repo": "acme/api" },
            "commit": "abc1234",
            "builtAt": "2026-09-30T12:00:00Z",
            "files": [
                { "path": "src/config.rs", "blob": blob(CONFIG), "lines": 1 },
                { "path": "src/lib.rs", "blob": blob(LIB), "lines": 4 },
                { "path": "web/app.ts", "blob": blob(WEB), "lines": 2 },
            ],
            "components": [{
                "id": "index",
                "name": "acme/api",
                "parent": null,
                "overview": "A small API.",
                "files": ["src/config.rs", "src/lib.rs", "web/app.ts"],
                "interpretations": [{ "id": 1, "kind": "role", "text": "lib.rs declares the crate's modules.", "anchors": [{ "path": "src/lib.rs", "start": 1, "end": 2 }] }],
                "relationships": [],
                "gaps": [],
            }],
        })
    );
    assert_eq!(
        commits(&t),
        [format!(
            "git -C {BUCKET} add -- wiki/acme/api/wiki.json && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m wiki acme/api abc1234"
        )]
    );
    assert_eq!(outcomes(&t), json!({ "acme/api": built }));
    // The checkout is gone once the Wiki is built.
    let dir = checkout(&t);
    let calls = t.world.calls();
    assert!(calls.contains(&format!(
        "git -C /src/api worktree add --detach --quiet {dir} origin/main"
    )));
    assert_eq!(
        calls.last().unwrap(),
        &format!(
            "git -C {BUCKET} add -- wiki/acme/api/wiki.json && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m wiki acme/api abc1234"
        )
    );
    assert!(!(t.world.files.borrow().keys()).any(|f| f.starts_with(&format!("{dir}/"))));
}

#[test]
fn a_division_and_its_leaves_land_as_one_wiki_of_components_with_their_relationships() {
    let t = with_repo("");
    let entry = interpretation("role", "run is the entry point.", "src/lib.rs", 4, 4);
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "division",
            "overview": "An API and its web front.",
            "components": [
                { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
                { "name": "Web front", "summary": "The page.", "files": ["web/app.ts"] },
            ],
            "relationships": [{ "from": "Web front", "to": "Core", "kind": "calls", "description": "It calls the API." }],
            "interpretations": [entry.clone()],
        }),
    );
    let config = interpretation(
        "invariant",
        "Config is a unit struct.",
        "src/config.rs",
        1,
        1,
    );
    // A file of another part is still a file of the Repo.
    let served = interpretation(
        "role",
        "The crate is served by the page.",
        "web/app.ts",
        1,
        1,
    );
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate's modules.", "interpretations": [config.clone(), served.clone()] }),
    );
    let port = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2);
    answer(
        &t,
        "acme/api > Web front",
        json!({ "kind": "leaf", "overview": "The page.", "interpretations": [port.clone()] }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["components"], 3);
    let numbered = |mut i: Value, id: u64| {
        i["id"] = json!(id);
        i
    };
    assert_eq!(
        wiki(&t)["components"],
        json!([
            {
                "id": "index",
                "name": "acme/api",
                "parent": null,
                "overview": "An API and its web front.",
                "files": ["src/config.rs", "src/lib.rs", "web/app.ts"],
                "interpretations": [numbered(entry, 1)],
                "relationships": [],
                "gaps": [],
            },
            {
                "id": "core",
                "name": "Core",
                "parent": "index",
                "overview": "The crate's modules.",
                "files": ["src/lib.rs", "src/config.rs"],
                "interpretations": [numbered(config, 1), numbered(served, 2)],
                "relationships": [],
                "gaps": [],
            },
            {
                "id": "web-front",
                "name": "Web front",
                "parent": "index",
                "overview": "The page.",
                "files": ["web/app.ts"],
                "interpretations": [numbered(port, 1)],
                "relationships": [{ "to": "core", "kind": "calls", "description": "It calls the API." }],
                "gaps": [],
            },
        ])
    );
    assert_eq!(commits(&t).len(), 1);
    // A part's prompt says what its parent's division said of it.
    let asked: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.contains("## The part: acme/api > Core\n"))
        .collect();
    assert_eq!(asked.len(), 1);
    assert!(
        asked[0]
            .contains("This part is the Component \"Core\" of acme/api, described as: The crate.")
    );
    assert!(asked[0].contains("- src/lib.rs (4 lines)\n- src/config.rs (1 lines)\n"));
}

/// The headless calls made, each cut before its prompt.
fn headless_calls(t: &Setup) -> Vec<String> {
    let dir = checkout(t);
    (t.world.calls().into_iter())
        .filter(|c| c.starts_with(&format!("cd {dir} && ")))
        .map(|c| {
            c.split_once(" You are writing")
                .expect("a prompt")
                .0
                .to_string()
        })
        .collect()
}

const READ_ONLY: &str = r#"OPENCODE_CONFIG_CONTENT={"permission":{"bash":"deny","edit":"deny","execute":"deny","external_directory":"deny","task":"deny","webfetch":"deny","websearch":"deny"}}"#;

#[test]
fn each_part_is_one_read_only_opencode2_run_on_the_default_wiki_launch_and_budget() {
    let t = with_repo("");
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API." }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let dir = checkout(&t);
    assert_eq!(
        headless_calls(&t),
        [format!(
            "cd {dir} && env {READ_ONLY} opencode2 run --standalone -m opencode-go/deepseek-v4.1-flash --format json"
        )]
    );
    assert!(
        t.world.logged().iter().any(|l| l
            .ends_with("building the Wiki of acme/api at abc1234: 48 calls, 7 deep, 4 at once")),
        "{:?}",
        t.world.logged()
    );
}

#[test]
fn the_wiki_launch_s_effort_goes_with_its_model_and_its_harness_s_own_command_runs() {
    let t = with_repo(
        "[wiki]\nlaunch = { harness = \"opencode\", model = \"opencode-go/kimi\", effort = \"high\" }\n[harnesses.opencode]\ncommand = \"/opt/opencode2\"",
    );
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API." }),
    );

    t.cli(&["wiki", "build", "acme/api", "--json"]);

    let dir = checkout(&t);
    assert_eq!(
        headless_calls(&t),
        [format!(
            "cd {dir} && env {READ_ONLY} /opt/opencode2 run --standalone -m opencode-go/kimi#high --format json"
        )]
    );
}

#[test]
fn a_wiki_launch_on_another_harness_fails_the_build_saying_only_opencode_builds_one() {
    let t = with_repo("[wiki]\nlaunch = { harness = \"claude\" }");

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 1);
    assert_eq!(
        ran.json()["error"],
        "could not build the Wiki of acme/api: claude has no headless form: only opencode builds a Wiki"
    );
    assert_eq!(outcomes(&t)["acme/api"]["outcome"], "failed");
    assert!(!t.world.calls().iter().any(|c| c.contains(" worktree add ")));
}

#[test]
fn each_interpretation_failing_a_check_is_dropped_and_its_part_recorded_as_a_gap() {
    let t = with_repo("");
    let kept = interpretation("postcondition", "run returns nothing.", "src/lib.rs", 4, 4);
    let unanchored = json!({ "kind": "role", "text": "No Anchor.", "anchors": [] });
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "leaf",
            "overview": "A small API.",
            "interpretations": [
                interpretation("other", "Not one of the five kinds.", "src/lib.rs", 1, 1),
                unanchored,
                interpretation("role", "Past its file's end.", "web/app.ts", 2, 3),
                interpretation("role", "From line 0.", "web/app.ts", 0, 1),
                interpretation("role", "Ends before it starts.", "src/lib.rs", 3, 2),
                interpretation("role", "In no file of the tree.", "src/main.rs", 1, 1),
                json!({ "kind": "role", "text": "Its anchors do not read." }),
                kept.clone(),
            ],
        }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({ "unreadable": 1 }));
    let index = &wiki(&t)["components"][0];
    let mut numbered = kept;
    numbered["id"] = json!(1);
    assert_eq!(index["interpretations"], json!([numbered]));
    assert_eq!(
        index["gaps"],
        json!([{ "paths": ["src/config.rs", "src/lib.rs", "web/app.ts"], "reason": "unreadable" }])
    );
    assert_eq!(outcomes(&t)["acme/api"]["gaps"], json!({ "unreadable": 1 }));
}

#[test]
fn a_component_outside_its_part_and_a_relationship_to_no_component_are_dropped_as_a_gap() {
    let t = with_repo("");
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "division",
            "overview": "An API.",
            "components": [
                { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
                { "name": "Docs", "summary": "Not in the tree.", "files": ["README.md"] },
                { "name": "Empty", "summary": "No files.", "files": [] },
            ],
            "relationships": [
                { "from": "Core", "to": "Docs", "kind": "uses", "description": "A dropped Component." },
                { "from": "Core", "to": "Web", "kind": "uses", "description": "No such Component." },
                { "from": "Core", "to": "Core", "kind": "owns", "description": "No such kind." },
            ],
        }),
    );
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate." }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let components = wiki(&t)["components"].clone();
    let names: Vec<&str> = (components.as_array().unwrap().iter())
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["acme/api", "Core"]);
    assert_eq!(components[1]["relationships"], json!([]));
    assert_eq!(
        components[0]["gaps"],
        json!([{ "paths": ["src/config.rs", "src/lib.rs", "web/app.ts"], "reason": "unreadable" }])
    );
    assert_eq!(components[1]["gaps"], json!([]));
}

#[test]
fn an_answer_that_is_no_json_of_either_shape_leaves_its_part_a_gap_and_the_build_succeeds() {
    let t = with_repo("");
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "division",
            "overview": "An API.",
            "components": [
                { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
                { "name": "Web", "summary": "The page.", "files": ["web/app.ts"] },
            ],
        }),
    );
    (t.world.headless.borrow_mut()).push((
        "## The part: acme/api > Core".into(),
        "I could not decide.".into(),
    ));
    // Fenced, it reads; a leaf's Components are no division.
    let web = json!({
        "kind": "leaf",
        "overview": "The page.",
        "components": [{ "name": "Inner", "summary": "Not asked.", "files": ["web/app.ts"] }],
    });
    (t.world.headless.borrow_mut()).push((
        "## The part: acme/api > Web".into(),
        format!("Here it is:\n```json\n{web}\n```"),
    ));

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({ "unreadable": 1 }));
    let components = wiki(&t)["components"].clone();
    assert_eq!(components.as_array().unwrap().len(), 3);
    assert_eq!(components[1]["overview"], "The crate.");
    assert_eq!(
        components[1]["gaps"],
        json!([{ "paths": ["src/lib.rs", "src/config.rs"], "reason": "unreadable" }])
    );
    assert_eq!(components[2]["overview"], "The page.");
    assert_eq!(components[2]["gaps"], json!([]));
}

/// The top part of `acme/api` divided into Core and Web.
fn divided(t: &Setup) {
    answer(
        t,
        "acme/api",
        json!({
            "kind": "division",
            "overview": "An API.",
            "components": [
                { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
                { "name": "Web", "summary": "The page.", "files": ["web/app.ts"] },
            ],
        }),
    );
}

#[test]
fn a_part_reached_once_calls_are_spent_is_a_budget_gap_and_the_build_still_succeeds() {
    let t = with_repo("[wiki]\ncalls = 2");
    divided(&t);
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate's modules." }),
    );
    answer(
        &t,
        "acme/api > Web",
        json!({ "kind": "leaf", "overview": "Never asked." }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({ "budget": 1 }));
    assert_eq!(headless_calls(&t).len(), 2);
    let web = &wiki(&t)["components"][2];
    assert_eq!(
        (
            web["id"].clone(),
            web["overview"].clone(),
            web["interpretations"].clone()
        ),
        (json!("web"), json!("The page."), json!([]))
    );
    assert_eq!(
        web["gaps"],
        json!([{ "paths": ["web/app.ts"], "reason": "budget" }])
    );
    assert_eq!(outcomes(&t)["acme/api"]["outcome"], "built");
}

#[test]
fn a_part_below_the_deepest_division_is_a_depth_gap_and_the_build_still_succeeds() {
    let t = with_repo("[wiki]\ndepth = 1");
    divided(&t);
    answer(
        &t,
        "acme/api > Core",
        json!({
            "kind": "division",
            "overview": "The crate.",
            "components": [
                { "name": "Lib", "summary": "Its root.", "files": ["src/lib.rs"] },
                { "name": "Config", "summary": "Its config.", "files": ["src/config.rs"] },
            ],
        }),
    );
    answer(
        &t,
        "acme/api > Web",
        json!({ "kind": "leaf", "overview": "The page." }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({ "depth": 2 }));
    assert_eq!(headless_calls(&t).len(), 3);
    let components = wiki(&t)["components"].clone();
    assert_eq!(
        (components[3]["id"].clone(), components[3]["parent"].clone()),
        (json!("core/lib"), json!("core"))
    );
    assert_eq!(
        components[3]["gaps"],
        json!([{ "paths": ["src/lib.rs"], "reason": "depth" }])
    );
    assert_eq!(
        components[4]["gaps"],
        json!([{ "paths": ["src/config.rs"], "reason": "depth" }])
    );
}

/// Whether `wikis.json` was there during each call starting with `prefix`.
fn outcome_seen_during(t: &Setup, prefix: &str) -> std::rc::Rc<std::cell::RefCell<Vec<bool>>> {
    let seen = std::rc::Rc::new(std::cell::RefCell::new(vec![]));
    let (file, during) = (t.config_dir.join("wikis.json"), seen.clone());
    t.world
        .during_call(prefix, move || during.borrow_mut().push(file.exists()));
    seen
}

#[test]
fn the_outcome_is_written_after_the_wiki_is_committed_to_the_bucket() {
    let t = with_repo("");
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API." }),
    );
    let at_commit = outcome_seen_during(&t, &format!("git -C {BUCKET} add"));

    t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(*at_commit.borrow(), [false]);
    assert_eq!(outcomes(&t)["acme/api"]["outcome"], "built");
}

#[test]
fn a_call_that_errors_fails_the_build_with_why_written_last_and_nothing_in_the_bucket() {
    let t = with_repo("");
    let dir = checkout(&t);
    t.world.fail_call(
        &format!("cd {dir} && "),
        "`opencode2 run` failed: Model unavailable: opencode-go/deepseek-v4.1-flash",
    );
    let at_removal = outcome_seen_during(&t, "git -C /src/api worktree remove");

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
    let why = "`opencode2 run` failed: Model unavailable: opencode-go/deepseek-v4.1-flash";
    assert_eq!(
        ran.json()["error"],
        format!("could not build the Wiki of acme/api: {why}")
    );
    assert_eq!(
        outcomes(&t),
        json!({ "acme/api": { "outcome": "failed", "at": "2026-09-30T12:00:00Z", "why": why } })
    );
    // Removed before the build and after it, before the outcome.
    assert_eq!(*at_removal.borrow(), [false, false]);
    assert!(commits(&t).is_empty());
    assert!(!(t.world.files.borrow().keys()).any(|f| f.starts_with(&format!("{dir}/"))));
}

#[test]
fn a_repo_not_configured_is_refused_and_no_outcome_written() {
    let t = with_repo("");

    let ran = t.cli(&["wiki", "build", "acme/web", "--json"]);

    assert_eq!(ran.exit_code, 1);
    assert!(!t.config_dir.join("wikis.json").exists());
    assert_eq!(t.cli(&["wiki", "--json"]).exit_code, 2);
    assert_eq!(t.cli(&["wiki", "build", "--json"]).exit_code, 2);
}
