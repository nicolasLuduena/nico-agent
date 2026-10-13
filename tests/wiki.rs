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

/// A division's claim about how its Core and its web front work together.
fn across() -> Value {
    json!({ "kind": "role", "text": "The page serves run, the entry point.", "anchors": [{ "path": "src/lib.rs", "start": 4, "end": 4 }, { "path": "web/app.ts", "start": 1, "end": 1 }] })
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
    // Then its records are embedded.
    assert_eq!(
        calls[calls.len() - 2..],
        [
            format!(
                "git -C {BUCKET} add -- wiki/acme/api/wiki.json && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m wiki acme/api abc1234"
            ),
            format!(
                "{EMBED}{}",
                json!({ "model": "nomic-embed-text", "input": ["A small API.", "lib.rs declares the crate's modules."] })
            ),
        ]
    );
    assert!(!(t.world.files.borrow().keys()).any(|f| f.starts_with(&format!("{dir}/"))));
}

#[test]
fn a_division_and_its_leaves_land_as_one_wiki_of_components_with_their_relationships() {
    let t = with_repo("");
    let entry = across();
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
fn a_wiki_launch_on_a_harness_with_no_headless_form_fails_the_build_naming_those_with_one() {
    let t = with_repo(
        "[wiki]\nlaunch = { harness = \"aider\" }\n[harnesses.aider]\nlaunch_mode = \"pane-command\"\ncommand = \"aider\"\nsigil = \"/\"\nmodel_args = []\neffort_args = []",
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 1);
    assert_eq!(
        ran.json()["error"],
        "could not build the Wiki of acme/api: aider has no headless form: a Wiki builds on claude, codex or opencode"
    );
    assert_eq!(outcomes(&t)["acme/api"]["outcome"], "failed");
    assert!(!t.world.calls().iter().any(|c| c.contains(" worktree add ")));
}

/// A leaf whose second Interpretation runs past its file's end, then the
/// same corrected: one call and one correction.
fn corrected_once(t: &Setup) {
    let kept = interpretation("role", "run is the entry point.", "src/lib.rs", 4, 4);
    let past = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 3);
    let port = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2);
    let leaf = |i: Vec<Value>| json!({ "kind": "leaf", "overview": "A small API.", "interpretations": i, "explainer": null });
    answer(t, "acme/api", leaf(vec![kept.clone(), past]));
    corrected(t, "acme/api", leaf(vec![kept, port]));
}

/// The headless calls made, each cut before its prompt, its JSON schema
/// argument, if any, put aside as `<schema>`; and that schema.
fn schema_aside(t: &Setup) -> (Vec<String>, Option<Value>) {
    let mut schema = None;
    let calls = (whole_headless_calls(t).into_iter())
        .map(|call| {
            let cut = [" You are writing", " ## Corrections"]
                .iter()
                .find_map(|at| call.split_once(at))
                .expect("a prompt")
                .0;
            let words: Vec<String> = (cut.split(' '))
                .map(|word| match serde_json::from_str::<Value>(word) {
                    Ok(read @ Value::Object(_)) => {
                        schema = Some(read);
                        "<schema>".into()
                    }
                    _ => word.into(),
                })
                .collect();
            words.join(" ")
        })
        .collect();
    (calls, schema)
}

/// What every answer must hold, as a strict JSON schema: a leaf or a division.
fn assert_is_the_answer_shape(schema: &Value) {
    assert_eq!(schema["type"], "object");
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(
        schema["properties"]["kind"]["enum"],
        json!(["leaf", "division"])
    );
    let mut required: Vec<&str> = (schema["required"].as_array().unwrap().iter())
        .map(|key| key.as_str().unwrap())
        .collect();
    required.sort();
    assert_eq!(
        required,
        [
            "components",
            "explainer",
            "interpretations",
            "kind",
            "overview",
            "relationships"
        ]
    );
}

#[test]
fn a_wiki_launch_on_claude_asks_each_part_with_claude_p_read_only_and_corrects_it_with_resume() {
    let t = with_repo(
        "[wiki]\nlaunch = { harness = \"claude\", model = \"sonnet\", effort = \"low\" }",
    );
    corrected_once(&t);

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({}));
    let dir = checkout(&t);
    let claude = "claude -p --output-format json --json-schema <schema> --tools=Read,Grep,Glob --strict-mcp-config --permission-prompts none --model sonnet --effort low";
    let (calls, schema) = schema_aside(&t);
    assert_eq!(
        calls,
        [
            format!("cd {dir} && env {claude}"),
            format!("cd {dir} && env {claude} --resume ses_1"),
        ]
    );
    assert_is_the_answer_shape(&schema.unwrap());
    assert_eq!(
        wiki(&t)["components"][0]["interpretations"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn a_wiki_launch_on_codex_asks_each_part_with_codex_exec_read_only_and_corrects_it_with_exec_resume()
 {
    let t = with_repo(
        "[wiki]\nlaunch = { harness = \"codex\", model = \"gpt-5.5\", effort = \"low\" }",
    );
    corrected_once(&t);

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({}));
    let dir = checkout(&t);
    let file = t.config_dir.join("wiki/answer.schema.json");
    let rest = format!(
        "--ignore-user-config -c sandbox_mode=\"read-only\" --skip-git-repo-check --json --output-schema {} -m gpt-5.5 -c model_reasoning_effort=low",
        file.display()
    );
    let (calls, _) = schema_aside(&t);
    assert_eq!(
        calls,
        [
            format!("cd {dir} && env codex exec {rest}"),
            format!("cd {dir} && env codex exec resume ses_1 {rest}"),
        ]
    );
    let schema = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    assert_is_the_answer_shape(&schema);
    assert_eq!(
        wiki(&t)["components"][0]["interpretations"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn each_interpretation_still_failing_a_check_after_its_third_round_is_dropped_and_its_part_a_gap() {
    let t = with_repo("");
    let kept = interpretation("postcondition", "run returns nothing.", "src/lib.rs", 4, 4);
    let unanchored = json!({ "kind": "role", "text": "No Anchor.", "anchors": [] });
    let leaf = json!({
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
    });
    answer(&t, "acme/api", leaf.clone());
    corrected(&t, "acme/api", leaf);

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    // Asked once, then three rounds in the session the first answer opened.
    let calls = whole_headless_calls(&t);
    assert_eq!(calls.len(), 4);
    for correction in &calls[1..] {
        assert!(
            correction.contains(" --format json -s ses_1 ## Corrections to the part: acme/api\n"),
            "{correction}"
        );
    }
    let failed: Vec<&str> = (calls[1].lines())
        .filter_map(|l| l.strip_prefix("- interpretation "))
        .map(|l| l.split_once(' ').unwrap().0)
        .collect();
    assert_eq!(failed, ["1", "2", "3", "4", "5", "6", "7"]);
    assert!(calls[1].contains(
        ": its kind `other` is not one of invariant, precondition, postcondition, effect, role\n"
    ));
    assert!(calls[1].contains(": src/main.rs is not one of the Wiki's files\n"));
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

/// What the part whose prompt names `trail` answers each correction.
fn corrected(t: &Setup, trail: &str, answer: Value) {
    (t.world.headless.borrow_mut()).push((
        format!("## Corrections to the part: {trail}"),
        answer.to_string(),
    ));
}

/// The headless calls made, whole.
fn whole_headless_calls(t: &Setup) -> Vec<String> {
    let dir = checkout(t);
    (t.world.calls().into_iter())
        .filter(|c| c.starts_with(&format!("cd {dir} && ")))
        .collect()
}

#[test]
fn a_claim_corrected_in_its_first_round_is_kept_in_the_same_session_and_leaves_no_gap() {
    let t = with_repo("");
    let kept = interpretation("role", "run is the entry point.", "src/lib.rs", 4, 4);
    let past = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 3);
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API.", "interpretations": [kept.clone(), past] }),
    );
    let port = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2);
    corrected(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API.", "interpretations": [kept.clone(), port.clone()] }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({}));
    let index = &wiki(&t)["components"][0];
    let numbered = |mut i: Value, id: u64| {
        i["id"] = json!(id);
        i
    };
    assert_eq!(
        index["interpretations"],
        json!([numbered(kept, 1), numbered(port, 2)])
    );
    assert_eq!(index["gaps"], json!([]));
    let dir = checkout(&t);
    assert_eq!(
        whole_headless_calls(&t)[1..],
        [format!(
            "cd {dir} && env {READ_ONLY} opencode2 run --standalone -m opencode-go/deepseek-v4.1-flash --format json -s ses_1 ## Corrections to the part: acme/api\n\nThese claims of your last answer failed their checks, each by its id:\n\n- interpretation 2 {{\"anchors\":[{{\"end\":3,\"path\":\"web/app.ts\",\"start\":2}}],\"kind\":\"effect\",\"text\":\"The page serves on port 80.\"}}: lines 2-3 are not inside web/app.ts (2 lines)\n\nCorrect each one, reading again the lines it cites, and answer again with the whole JSON object in the same shape, every other claim as it was."
        )]
    );
}

#[test]
fn a_component_outside_its_part_and_a_relationship_to_no_component_are_dropped_as_a_gap() {
    let t = with_repo("");
    let division = json!({
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
    });
    answer(&t, "acme/api", division.clone());
    corrected(&t, "acme/api", division);
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
    let failed: Vec<String> = (whole_headless_calls(&t)[1].lines())
        .filter_map(|l| l.strip_prefix("- "))
        .map(|l| l.split(' ').take(2).collect::<Vec<_>>().join(" "))
        .collect();
    assert_eq!(
        failed,
        [
            "component 2",
            "component 3",
            "relationship 1",
            "relationship 2",
            "relationship 3"
        ]
    );
    assert_eq!(components[1]["relationships"], json!([]));
    assert_eq!(
        components[0]["gaps"],
        json!([{ "paths": ["src/config.rs", "src/lib.rs", "web/app.ts"], "reason": "unreadable" }])
    );
    assert_eq!(components[1]["gaps"], json!([]));
}

#[test]
fn a_division_s_interpretation_anchored_only_in_one_component_s_files_is_sent_back_then_dropped() {
    let t = with_repo("");
    let in_core = json!({ "kind": "invariant", "text": "lib.rs declares config.", "anchors": [
        { "path": "src/lib.rs", "start": 1, "end": 1 },
        { "path": "src/config.rs", "start": 1, "end": 1 },
    ] });
    let in_web = interpretation("role", "The page exports serve.", "web/app.ts", 1, 1);
    let division = json!({
        "kind": "division",
        "overview": "An API and its web front.",
        "components": [
            { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
            { "name": "Web front", "summary": "The page.", "files": ["web/app.ts"] },
        ],
        "interpretations": [in_core, across(), in_web],
    });
    answer(&t, "acme/api", division.clone());
    corrected(&t, "acme/api", division);
    for trail in ["acme/api > Core", "acme/api > Web front"] {
        answer(&t, trail, json!({ "kind": "leaf", "overview": "A part." }));
    }

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let corrections: Vec<String> = (whole_headless_calls(&t).into_iter())
        .filter(|c| c.contains("## Corrections to the part: acme/api\n"))
        .collect();
    assert_eq!(corrections.len(), 3);
    let failed: Vec<(&str, &str)> = (corrections[0].lines())
        .filter_map(|l| l.strip_prefix("- interpretation "))
        .map(|l| {
            (
                l.split_once(' ').unwrap().0,
                l.rsplit_once("}: ").unwrap().1,
            )
        })
        .collect();
    let about = |name: &str| {
        format!(
            "its Anchors all fall in the files of {name}, so it is about that Component, not how the division's Components work together"
        )
    };
    assert_eq!(
        failed,
        [("1", about("Core").as_str()), ("3", &about("Web front"))]
    );
    assert_eq!(ran.json()["gaps"], json!({ "unreadable": 1 }));
    let index = &wiki(&t)["components"][0];
    let mut kept = across();
    kept["id"] = json!(1);
    assert_eq!(index["interpretations"], json!([kept]));
    assert_eq!(
        index["gaps"],
        json!([{ "paths": ["src/config.rs", "src/lib.rs", "web/app.ts"], "reason": "unreadable" }])
    );
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
    (t.world.headless.borrow_mut()).push((
        "## Corrections to the part: acme/api > Core".into(),
        "Still nothing.".into(),
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
    let corrections: Vec<String> = (whole_headless_calls(&t).into_iter())
        .filter(|c| c.contains("## Corrections to the part: acme/api > Core\n"))
        .collect();
    assert_eq!(corrections.len(), 3);
    assert!(
        corrections[0]
            .contains("\n- the answer: it is no JSON object of either shape, leaf or division\n")
    );
}

#[test]
fn a_correction_that_does_not_read_leaves_the_last_answer_that_did() {
    let t = with_repo("");
    let kept = interpretation("role", "run is the entry point.", "src/lib.rs", 4, 4);
    let past = interpretation("role", "Past its file's end.", "web/app.ts", 2, 3);
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API.", "interpretations": [kept.clone(), past] }),
    );
    (t.world.headless.borrow_mut()).push((
        "## Corrections to the part: acme/api".into(),
        "I cannot find those lines.".into(),
    ));

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(whole_headless_calls(&t).len(), 4);
    // Each round sends back the claim of the answer that read, saying the reply did not.
    let calls = whole_headless_calls(&t);
    let unread = "\n- your last reply: it is no JSON object of either shape, leaf or division, so the claims below are of the answer before it\n- interpretation 2 {";
    assert!(!calls[1].contains("your last reply"));
    assert!(calls[2].contains(unread), "{}", calls[2]);
    assert!(calls[3].contains(unread));
    let index = &wiki(&t)["components"][0];
    let mut numbered = kept;
    numbered["id"] = json!(1);
    assert_eq!(
        (index["overview"].clone(), index["interpretations"].clone()),
        (json!("A small API."), json!([numbered]))
    );
    assert_eq!(
        index["gaps"],
        json!([{ "paths": ["src/config.rs", "src/lib.rs", "web/app.ts"], "reason": "unreadable" }])
    );
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
fn a_correction_round_is_a_call_of_the_budget_and_leaves_fewer_for_the_parts_below() {
    let t = with_repo("[wiki]\ncalls = 3");
    let core = json!({ "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] });
    let web = json!({ "name": "Web", "summary": "The page.", "files": ["web/app.ts"] });
    let calls = |to: &str| json!({ "from": "Web", "to": to, "kind": "calls", "description": "It calls the API." });
    answer(
        &t,
        "acme/api",
        json!({ "kind": "division", "overview": "An API.", "components": [core, web], "relationships": [calls("Server")] }),
    );
    corrected(
        &t,
        "acme/api",
        json!({ "kind": "division", "overview": "An API.", "components": [core, web], "relationships": [calls("Core")] }),
    );
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate's modules." }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(whole_headless_calls(&t).len(), 3);
    assert_eq!(ran.json()["gaps"], json!({ "budget": 1 }));
    let components = wiki(&t)["components"].clone();
    assert_eq!(components[0]["gaps"], json!([]));
    assert_eq!(
        components[2]["relationships"],
        json!([{ "to": "core", "kind": "calls", "description": "It calls the API." }])
    );
    assert_eq!(
        components[2]["gaps"],
        json!([{ "paths": ["web/app.ts"], "reason": "budget" }])
    );
    let logged = t.world.logged();
    for line in [
        "acme/api: asked (call 1 of 3)",
        "acme/api: 1 claim(s) failed, sent back (round 1 of 3, call 2 of 3)",
        "acme/api > Core: asked (call 3 of 3)",
    ] {
        assert!(
            logged.iter().any(|l| l.ends_with(line)),
            "{line}: {logged:?}"
        );
    }
}

#[test]
fn a_claim_still_failing_when_the_calls_are_spent_is_dropped_and_its_part_a_budget_gap() {
    let t = with_repo("[wiki]\ncalls = 2");
    let leaf = json!({
        "kind": "leaf",
        "overview": "A small API.",
        "interpretations": [interpretation("role", "Past its file's end.", "web/app.ts", 2, 3)],
    });
    answer(&t, "acme/api", leaf.clone());
    corrected(&t, "acme/api", leaf);

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(whole_headless_calls(&t).len(), 2);
    assert_eq!(ran.json()["gaps"], json!({ "budget": 1 }));
    let index = &wiki(&t)["components"][0];
    assert_eq!(index["interpretations"], json!([]));
    assert_eq!(
        index["gaps"],
        json!([{ "paths": ["src/config.rs", "src/lib.rs", "web/app.ts"], "reason": "budget" }])
    );
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

const EMBED: &str = "curl -X POST http://127.0.0.1:11434/api/embed -d ";

/// What the config directory keeps of the embeddings of acme/api's Wiki.
fn vectors(t: &Setup) -> Option<Value> {
    let file = t.config_dir.join("wiki/acme/api/vectors.json");
    let text = std::fs::read_to_string(file).ok()?;
    Some(serde_json::from_str(&text).unwrap())
}

#[test]
fn a_build_ends_by_embedding_every_overview_and_interpretation_through_ollama() {
    let t = with_repo("");
    let entry = across();
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
            "interpretations": [entry],
        }),
    );
    let config = interpretation(
        "invariant",
        "Config is a unit struct.",
        "src/config.rs",
        1,
        1,
    );
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate's modules.", "interpretations": [config] }),
    );
    let port = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2);
    answer(
        &t,
        "acme/api > Web front",
        json!({ "kind": "leaf", "overview": "The page.", "interpretations": [port] }),
    );
    (t.world.embeddings.borrow_mut()).insert("The page serves on port 80.".into(), vec![1.0, 0.0]);

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let texts = [
        "An API and its web front.",
        "The page serves run, the entry point.",
        "The crate's modules.",
        "Config is a unit struct.",
        "The page.",
        "The page serves on port 80.",
    ];
    let embedded = json!({ "model": "nomic-embed-text", "input": texts });
    // After the Wiki is in the Bucket: a Wiki is served without its embeddings.
    let calls = t.world.calls();
    assert_eq!(calls.last().unwrap(), &format!("{EMBED}{embedded}"));
    assert!(calls[calls.len() - 2].starts_with(&format!("git -C {BUCKET} add -- ")));
    let mut kept: serde_json::Map<String, Value> = (texts.iter())
        .map(|text| (text.to_string(), json!([0.0, 1.0])))
        .collect();
    kept.insert("The page serves on port 80.".into(), json!([1.0, 0.0]));
    assert_eq!(
        vectors(&t),
        Some(json!({ "model": "nomic-embed-text", "vectors": kept }))
    );
    assert_eq!(outcomes(&t)["acme/api"]["outcome"], "built");
}

#[test]
fn a_failed_embedding_leaves_the_wiki_built_without_its_vectors_on_the_ollama_configured() {
    let t = with_repo("[wiki]\nembed_model = \"mxbai-embed-large\"\nollama = \"http://gpu:11434\"");
    answer(
        &t,
        "acme/api",
        json!({ "kind": "leaf", "overview": "A small API." }),
    );
    let embed = "curl -X POST http://gpu:11434/api/embed -d ";
    t.world.fail_call(
        embed,
        "could not reach http://gpu:11434/api/embed: connection refused",
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["outcome"], "built");
    let embedded = json!({ "model": "mxbai-embed-large", "input": ["A small API."] });
    assert!(t.world.calls().contains(&format!("{embed}{embedded}")));
    assert_eq!(vectors(&t), None);
    assert!(
        t.world.logged().iter().any(|l| l.ends_with(
            "could not embed the Wiki of acme/api, so ask embeds it first: could not reach http://gpu:11434/api/embed: connection refused"
        )),
        "{:?}",
        t.world.logged()
    );
}

#[test]
fn serve_answers_each_built_wiki_and_a_wiki_by_its_id_and_404s_one_it_has_not() {
    let t = with_repo("");
    let past_the_end = interpretation("role", "Past the end.", "src/lib.rs", 1, 9);
    let leaf =
        json!({ "kind": "leaf", "overview": "A small API.", "interpretations": [past_the_end] });
    answer(&t, "acme/api", leaf.clone());
    corrected(&t, "acme/api", leaf);
    t.cli(&["wiki", "build", "acme/api", "--json"]);
    let config = std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap();
    let web = "[repos.\"acme/web\"]\npath = \"/src/web\"\n";
    std::fs::write(t.config_dir.join("config.toml"), config + web).unwrap();
    t.tick();

    let listed = t.get("/api/wikis");
    let one = t.get("/api/wiki/acme/api");
    let unbuilt = t.get("/api/wiki/acme/web");
    let unknown = t.get("/api/wiki/acme/nope");

    let built = json!({
        "id": "acme/api",
        "target": { "repo": "acme/api" },
        "commit": "abc1234",
        "builtAt": "2026-09-30T12:00:00Z",
        "gaps": 1,
        "budget": 0,
        "calls": 48,
        "state": "built",
        "pane": null,
        "why": null,
    });
    assert_eq!(listed, (200, json!([built])));
    let mut marked = wiki(&t);
    marked["base"] = json!("main");
    marked["behind"] = json!(0);
    marked["stale"] = json!(0);
    assert_eq!(one, (200, marked));
    let help = json!([
        "Ask for a Wiki /api/wikis lists, or build one: nico-agent wiki build <owner/name>[@<tag>[:<path>]]"
    ]);
    assert_eq!(
        unbuilt,
        (
            404,
            json!({ "error": "acme/web has no Wiki", "help": help })
        )
    );
    assert_eq!(
        unknown,
        (
            404,
            json!({ "error": "acme/nope has no Wiki", "help": help })
        )
    );
}

fn step(n: u64, caption: &str, path: &str, start: u64, end: u64) -> Value {
    json!({ "n": n, "caption": caption, "anchors": [{ "path": path, "start": start, "end": end }] })
}

#[test]
fn a_leaf_s_explainer_lands_on_its_component_and_a_division_s_is_not_asked_for() {
    let t = with_repo("");
    let explainer = json!({
        "title": "How the crate starts",
        "steps": [
            { "n": 1, "caption": "lib.rs declares the modules.", "anchors": [{ "path": "src/lib.rs", "start": 1, "end": 2 }], "lane": "Crate" },
            { "n": 2, "caption": "run starts it.", "anchors": [{ "path": "src/lib.rs", "start": 4, "end": 4 }], "lane": "Crate" },
            step(3, "Config is read.", "src/config.rs", 1, 1),
        ],
        "arrows": [{ "from": 1, "to": 2, "label": "then" }, { "from": 2, "to": 3 }],
    });
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
            "explainer": explainer,
        }),
    );
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate.", "explainer": explainer }),
    );
    answer(
        &t,
        "acme/api > Web",
        json!({ "kind": "leaf", "overview": "The page.", "explainer": null }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({}));
    let components = wiki(&t)["components"].clone();
    assert_eq!(components[1]["explainer"], explainer);
    assert_eq!(components[1]["gaps"], json!([]));
    assert!(components[0].get("explainer").is_none());
    assert!(components[2].get("explainer").is_none());
    // A leaf's prompt asks for one.
    let asked = (t.world.calls().into_iter())
        .find(|c| c.contains("## The part: acme/api > Core\n"))
        .unwrap();
    assert!(asked.contains("\"explainer\": {\"title\": "), "{asked}");
}

#[test]
fn an_explainer_citing_no_real_anchor_with_an_arrow_to_no_step_or_over_8_steps_is_dropped_as_a_gap()
{
    let t = with_repo("");
    let parts = [
        (
            "Past the end",
            vec![step(1, "Past the end.", "src/lib.rs", 4, 5)],
            json!([]),
        ),
        (
            "Unanchored",
            vec![json!({ "n": 1, "caption": "No Anchor.", "anchors": [] })],
            json!([]),
        ),
        (
            "Missing step",
            vec![
                step(1, "One.", "src/lib.rs", 1, 1),
                step(2, "Two.", "src/lib.rs", 2, 2),
            ],
            json!([{ "from": 1, "to": 2 }, { "from": 2, "to": 3 }]),
        ),
        (
            "Nine steps",
            (1..=9)
                .map(|n| step(n, "A step.", "src/lib.rs", 1, 1))
                .collect(),
            json!([]),
        ),
        (
            "Out of order",
            vec![
                step(2, "Two.", "src/lib.rs", 2, 2),
                step(1, "One.", "src/lib.rs", 1, 1),
            ],
            json!([]),
        ),
    ];
    let components: Vec<Value> = (parts.iter())
        .map(|(name, _, _)| json!({ "name": name, "summary": "A part.", "files": ["src/lib.rs"] }))
        .collect();
    answer(
        &t,
        "acme/api",
        json!({ "kind": "division", "overview": "An API.", "components": components }),
    );
    let kept = interpretation("role", "run is the entry point.", "src/lib.rs", 4, 4);
    for (name, steps, arrows) in &parts {
        let explainer = json!({ "title": name, "steps": steps, "arrows": arrows });
        let leaf = json!({ "kind": "leaf", "overview": "A part.", "interpretations": [kept], "explainer": explainer });
        answer(&t, &format!("acme/api > {name}"), leaf.clone());
        corrected(&t, &format!("acme/api > {name}"), leaf);
    }

    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({ "unreadable": 5 }));
    let components = wiki(&t)["components"].clone();
    for leaf in &components.as_array().unwrap()[1..] {
        assert!(leaf.get("explainer").is_none(), "{leaf}");
        assert_eq!(leaf["interpretations"].as_array().unwrap().len(), 1);
        assert_eq!(
            leaf["gaps"],
            json!([{ "paths": ["src/lib.rs"], "reason": "unreadable" }])
        );
    }
    let logged = t.world.logged();
    for (part, why) in [
        (
            "Past the end",
            "step 1: lines 4-5 are not inside src/lib.rs (4 lines)",
        ),
        ("Unanchored", "step 1: it cites no Anchor"),
        (
            "Missing step",
            "its arrow 2 to 3 is not between two of its steps",
        ),
        ("Nine steps", "it has 9 steps, not 1 to 8"),
        ("Out of order", "its steps are not numbered 1 to 2 in order"),
    ] {
        assert!(
            (logged.iter())
                .any(|l| l.contains(&format!("acme/api > {part}: dropped")) && l.ends_with(why)),
            "{part}: {logged:?}"
        );
    }
}

/// `acme/api` built at abc1234, divided into Core (`src/lib.rs` and
/// `src/config.rs`) and Web (`web/app.ts`), each a leaf of one role; then
/// its Base moved on to def5678, as `files` say, and the model's script
/// and the calls cleared. The Wiki it built.
fn built_then_moved(t: &Setup, files: &[(&str, Option<&str>)]) -> Value {
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
            "interpretations": [across()],
        }),
    );
    let core = interpretation(
        "invariant",
        "Config is a unit struct.",
        "src/config.rs",
        1,
        1,
    );
    answer(
        t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate.", "interpretations": [core] }),
    );
    let web = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2);
    answer(
        t,
        "acme/api > Web",
        json!({ "kind": "leaf", "overview": "The page.", "interpretations": [web] }),
    );
    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    for (file, text) in files {
        let key = format!("/src/api origin/main:{file}");
        match text {
            Some(text) => t.world.add_tree_file("/src/api", "origin/main", file, text),
            None => drop(t.world.tree.borrow_mut().remove(&key)),
        }
    }
    (t.world.heads.borrow_mut()).insert(format!("{} HEAD", checkout(t)), "def5678".into());
    t.world.headless.borrow_mut().clear();
    t.world.calls.borrow_mut().clear();
    wiki(t)
}

/// The part whose prompt names `trail` answers `answer` from now on.
fn answer_first(t: &Setup, trail: &str, answer: Value) {
    let line = format!("## The part: {trail}");
    (t.world.headless.borrow_mut()).insert(0, (line, answer.to_string()));
}

/// The parts asked about since the calls were cleared, by their trail.
fn asked(t: &Setup) -> Vec<String> {
    (t.world.calls().iter())
        .flat_map(|c| c.lines().filter_map(|l| l.strip_prefix("## The part: ")))
        .map(String::from)
        .collect()
}

const NEW_WEB: &str = "export const serve = () => {};\nexport const port = 8080;\n";

#[test]
fn update_with_one_file_changed_asks_again_only_its_leaf_and_copies_every_other_part() {
    let t = with_repo("");
    let before = built_then_moved(&t, &[("web/app.ts", Some(NEW_WEB))]);
    let port = interpretation(
        "effect",
        "The page serves on port 8080.",
        "web/app.ts",
        2,
        2,
    );
    answer(
        &t,
        "acme/api > Web",
        json!({ "kind": "leaf", "overview": "The page, moved.", "interpretations": [port] }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--update", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["commit"], "def5678");
    assert_eq!(ran.json()["components"], 3);
    assert_eq!(asked(&t), ["acme/api > Web"]);
    let mut after = before.clone();
    after["commit"] = json!("def5678");
    after["files"][2]["blob"] = json!(blob(NEW_WEB));
    // The top part, kept, cites web/app.ts too: pinned where it was written.
    after["components"][0]["blobs"] = json!({ "web/app.ts": blob(WEB) });
    after["components"][2]["overview"] = json!("The page, moved.");
    after["components"][2]["interpretations"][0]["text"] = json!("The page serves on port 8080.");
    assert_eq!(wiki(&t), after);
    // The re-asked part is told what its parent's division said of it.
    let call = (t.world.calls().into_iter())
        .find(|c| c.contains("## The part: acme/api > Web\n"))
        .unwrap();
    assert!(
        call.contains("This part is the Component \"Web\" of acme/api, described as: The page.")
    );
    let message = "-m wiki acme/api def5678";
    assert!(t.world.calls().iter().any(|c| c.ends_with(message)));
}

#[test]
fn update_with_a_file_added_divides_again_only_the_part_it_sits_under() {
    let t = with_repo("");
    let before = built_then_moved(&t, &[("web/style.css", Some("body {}\n"))]);
    answer(
        &t,
        "acme/api > Web",
        json!({
            "kind": "division",
            "overview": "The page and its style.",
            "components": [
                { "name": "Script", "summary": "Its code.", "files": ["web/app.ts"] },
                { "name": "Style", "summary": "Its look.", "files": ["web/style.css"] },
            ],
        }),
    );
    for (part, overview) in [("Script", "Its code."), ("Style", "Its look.")] {
        answer(
            &t,
            &format!("acme/api > Web > {part}"),
            json!({ "kind": "leaf", "overview": overview }),
        );
    }

    let ran = t.cli(&["wiki", "build", "acme/api", "--update", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        asked(&t),
        [
            "acme/api > Web",
            "acme/api > Web > Script",
            "acme/api > Web > Style"
        ]
    );
    let call = (t.world.calls().into_iter())
        .find(|c| c.contains("## The part: acme/api > Web\n"))
        .unwrap();
    assert!(call.contains("- web/app.ts (2 lines)\n- web/style.css (1 lines)\n"));
    let after = wiki(&t);
    let components = after["components"].as_array().unwrap();
    let ids: Vec<&str> = components
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["index", "core", "web", "web/script", "web/style"]);
    let mut index = before["components"][0].clone();
    index["files"] = json!(["src/config.rs", "src/lib.rs", "web/app.ts", "web/style.css"]);
    assert_eq!(components[0], index);
    assert_eq!(components[1], before["components"][1]);
    assert_eq!(components[2]["overview"], "The page and its style.");
    assert_eq!(
        components[2]["files"],
        json!(["web/app.ts", "web/style.css"])
    );
    assert_eq!(components[4]["parent"], "web");
}

#[test]
fn update_with_a_file_removed_divides_again_only_the_part_it_was_in() {
    let t = with_repo("");
    let before = built_then_moved(&t, &[("src/config.rs", None)]);
    let entry = interpretation("role", "run is the entry point.", "src/lib.rs", 4, 4);
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate, without its config.", "interpretations": [entry] }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--update", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(asked(&t), ["acme/api > Core"]);
    let call = (t.world.calls().into_iter())
        .find(|c| c.contains("## The part: acme/api > Core\n"))
        .unwrap();
    assert!(call.contains("- src/lib.rs (4 lines)\n\n"), "{call}");
    let after = wiki(&t);
    assert_eq!(
        after["files"],
        json!([
            { "path": "src/lib.rs", "blob": blob(LIB), "lines": 4 },
            { "path": "web/app.ts", "blob": blob(WEB), "lines": 2 },
        ])
    );
    let mut index = before["components"][0].clone();
    index["files"] = json!(["src/lib.rs", "web/app.ts"]);
    assert_eq!(after["components"][0], index);
    // In the order it had: the part asked again keeps its place.
    assert_eq!(after["components"][1]["id"], "core");
    assert_eq!(after["components"][1]["files"], json!(["src/lib.rs"]));
    assert_eq!(
        after["components"][1]["overview"],
        "The crate, without its config."
    );
    assert_eq!(after["components"][2], before["components"][2]);
}

const NEW_LIB: &str = "pub mod config;\npub mod web;\n\npub fn run() { web::serve(); }\n";

/// The calls `GET path` makes, and its answer.
fn served(t: &Setup, path: &str) -> ((u16, Value), Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let answer = t.get(path);
    (answer, t.world.calls())
}

#[test]
fn an_interpretation_citing_a_file_changed_on_the_base_is_stale_until_an_update_asks_it_again() {
    let t = with_repo("");
    let before = built_then_moved(&t, &[("src/lib.rs", Some(NEW_LIB))]);
    (t.world.behind.borrow_mut()).insert("/src/api abc1234..origin/main".into(), 3);
    t.tick();

    let (moved, calls) = served(&t, "/api/wiki/acme/api");

    // The top part's claim cites src/lib.rs; Core's and Web's cite neither.
    let mut stale = before.clone();
    stale["components"][0]["interpretations"][0]["stale"] = json!(true);
    stale["base"] = json!("main");
    stale["behind"] = json!(3);
    stale["stale"] = json!(1);
    assert_eq!(moved, (200, stale));
    // Against the Base as the clone has it: nothing fetched.
    assert_eq!(
        calls,
        [
            &format!("read {WIKI}"),
            "git -C /src/api default-branch",
            "git -C /src/api ls-tree -r -z origin/main",
            "git -C /src/api rev-list --count abc1234..origin/main",
        ]
    );

    // An Update asks Core again; the top part, kept, keeps its claim, Stale.
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate, serving.", "interpretations": [interpretation("effect", "run serves the page.", "src/lib.rs", 4, 4)] }),
    );
    let ran = t.cli(&["wiki", "build", "acme/api", "--update", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(asked(&t), ["acme/api > Core"]);
    let (updated, _) = served(&t, "/api/wiki/acme/api");

    let (status, updated) = updated;
    assert_eq!(status, 200);
    assert_eq!(
        (&updated["behind"], &updated["stale"]),
        (&json!(0), &json!(1))
    );
    let index = &updated["components"][0];
    assert_eq!(index["interpretations"][0]["stale"], true);
    assert_eq!(index["blobs"], json!({ "src/lib.rs": blob(LIB) }));
    let core = &updated["components"][1];
    assert_eq!(core["id"], "core");
    assert!(core["interpretations"][0].get("stale").is_none(), "{core}");
}

#[test]
fn update_never_asks_about_a_part_left_with_no_files_when_two_parts_shared_a_removed_one() {
    let t = with_repo("");
    // src/config.rs in both Core and Web, as a model may answer.
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "division",
            "overview": "An API.",
            "components": [
                { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
                { "name": "Web", "summary": "The page.", "files": ["web/app.ts", "src/config.rs"] },
            ],
        }),
    );
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate." }),
    );
    answer(
        &t,
        "acme/api > Web",
        json!({
            "kind": "division",
            "overview": "The page and its config.",
            "components": [
                { "name": "Page", "summary": "The page.", "files": ["web/app.ts"] },
                { "name": "Conf", "summary": "Its config.", "files": ["src/config.rs"] },
            ],
        }),
    );
    for part in ["Page", "Conf"] {
        let trail = format!("acme/api > Web > {part}");
        answer(&t, &trail, json!({ "kind": "leaf", "overview": part }));
    }
    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    (t.world.tree.borrow_mut()).remove("/src/api origin/main:src/config.rs");
    t.world.calls.borrow_mut().clear();

    answer_first(
        &t,
        "acme/api > Web",
        json!({
            "kind": "division",
            "overview": "The page.",
            "components": [{ "name": "Page", "summary": "The page.", "files": ["web/app.ts"] }],
        }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--update", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    // Web, its Conf left with nothing, is divided again.
    assert_eq!(
        asked(&t),
        ["acme/api > Core", "acme/api > Web", "acme/api > Web > Page"]
    );
    let after = wiki(&t);
    let ids: Vec<&str> = (after["components"].as_array().unwrap().iter())
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["index", "core", "web", "web/page"]);
}

#[test]
fn continue_asks_only_the_budget_gaps_with_a_fresh_budget_and_fills_them_in_place_at_the_wiki_s_commit()
 {
    let t = with_repo("[wiki]\ncalls = 2");
    divided(&t);
    answer(
        &t,
        "acme/api > Core",
        json!({ "kind": "leaf", "overview": "The crate's modules." }),
    );
    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);
    assert_eq!(ran.json()["gaps"], json!({ "budget": 1 }));
    let before = wiki(&t);
    // Its Base moved on since: Continue reads the commit the Wiki describes.
    for (file, text) in [
        ("src/lib.rs", LIB),
        ("src/config.rs", CONFIG),
        ("web/app.ts", WEB),
    ] {
        t.world.add_tree_file("/src/api", "abc1234", file, text);
    }
    t.world
        .add_tree_file("/src/api", "origin/main", "web/app.ts", NEW_WEB);
    (t.world.heads.borrow_mut()).insert("/src/api origin/main".into(), "def5678".into());
    t.world.calls.borrow_mut().clear();
    let port = interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2);
    answer(
        &t,
        "acme/api > Web",
        json!({ "kind": "leaf", "overview": "The page.", "interpretations": [port] }),
    );

    let ran = t.cli(&["wiki", "build", "acme/api", "--continue", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        (&ran.json()["commit"], &ran.json()["gaps"]),
        (&json!("abc1234"), &json!({}))
    );
    assert_eq!(asked(&t), ["acme/api > Web"]);
    let dir = checkout(&t);
    assert!(t.world.calls().contains(&format!(
        "git -C /src/api worktree add --detach --quiet {dir} abc1234"
    )));
    let mut after = before.clone();
    after["components"][2]["interpretations"] = json!([{ "id": 1, "kind": "effect", "text": "The page serves on port 80.", "anchors": [{ "path": "web/app.ts", "start": 2, "end": 2 }] }]);
    after["components"][2]["gaps"] = json!([]);
    assert_eq!(wiki(&t), after);
}

#[test]
fn continue_is_refused_for_a_repo_with_no_wiki_and_one_build_kind_is_asked_at_a_time() {
    let t = with_repo("");

    let none = t.cli(&["wiki", "build", "acme/api", "--continue", "--json"]);
    let both = t.cli(&[
        "wiki",
        "build",
        "acme/api",
        "--update",
        "--rebuild",
        "--json",
    ]);

    assert_eq!(none.exit_code, 1, "{}", none.stdout);
    assert_eq!(
        none.json()["error"],
        "could not build the Wiki of acme/api: acme/api has no Wiki to continue"
    );
    assert_eq!(both.exit_code, 2, "{}", both.stdout);
    assert_eq!(
        both.json()["error"],
        "--update, --rebuild and --continue are one at a time"
    );
}

#[test]
fn rebuild_asks_about_every_part_again_without_reading_the_wiki_before_it() {
    let t = with_repo("");
    divided(&t);
    for part in ["Core", "Web"] {
        let trail = format!("acme/api > {part}");
        answer(&t, &trail, json!({ "kind": "leaf", "overview": part }));
    }
    t.cli(&["wiki", "build", "acme/api", "--json"]);
    t.world.calls.borrow_mut().clear();

    let ran = t.cli(&["wiki", "build", "acme/api", "--rebuild", "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(asked(&t), ["acme/api", "acme/api > Core", "acme/api > Web"]);
    assert!(!t.world.calls().contains(&format!("read {WIKI}")));
}
