//! Library Wikis: a Library version, linked by a Repo or added under
//! `[wiki]`, built once at its tag from a bare clone cached in the config
//! directory, covering only its subfolder.

mod common;

use std::time::Duration;

use common::{Setup, blob, setup};
use serde_json::{Value, json};

const BUCKET: &str = "/mnt/agents-land/nico-agent-bucket";
const ORIGIN: &str = "https://github.com/Effect-TS/effect.git";
const TAG: &str = "effect@3.17.0";
/// The Library version `acme/api` links, by its id.
const EFFECT: &str = "Effect-TS/effect@effect@3.17.0:packages/effect";

const EFFECT_TS: &str = "export const succeed = (a) => a;\nexport const fail = (e) => e;\n";
const PACKAGE: &str = "{ \"name\": \"effect\" }\n";
const README: &str = "# Effect\n";

/// Repo `acme/api` at `/src/api` linking `Effect-TS/effect` at `effect@3.17.0`
/// under `packages/effect`, with `toml` after it, and the Library's origin
/// holding that tag: two files under the subfolder, two outside it.
fn with_library(toml: &str) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!(
        "[repos.\"acme/api\"]\npath = \"/src/api\"\nlibraries = [{{ repo = \"Effect-TS/effect\", tag = \"{TAG}\", path = \"packages/effect\" }}]\n{toml}\n"
    );
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_clone(BUCKET, &[]);
    for (file, text) in [
        ("packages/effect/src/Effect.ts", EFFECT_TS),
        ("packages/effect/package.json", PACKAGE),
        ("packages/stream/index.ts", "export {};\n"),
        ("README.md", README),
    ] {
        tag_file(&t, TAG, file, text);
    }
    t
}

/// Put `file`, holding `text`, at the tag `tag` of the Library's origin.
fn tag_file(t: &Setup, tag: &str, file: &str, text: &str) {
    t.world
        .add_tree_file(ORIGIN, &format!("refs/tags/{tag}"), file, text);
}

/// The Library's bare clone, in the config directory.
fn clone(t: &Setup) -> String {
    let clone = t.config_dir.join("libraries/Effect-TS/effect.git");
    clone.display().to_string()
}

/// Where the build of the Library version in the folder `folder` checks it out.
fn checkout(t: &Setup, folder: &str) -> String {
    let dir = t.config_dir.join("wiki").join(folder).join("checkout");
    dir.display().to_string()
}

/// The part whose prompt names `trail` answers `answer`.
fn answer(t: &Setup, trail: &str, answer: Value) {
    (t.world.headless.borrow_mut()).push((format!("## The part: {trail}"), answer.to_string()));
}

/// The Wiki the Bucket holds at `wiki/<folder>/wiki.json`.
fn kept(t: &Setup, folder: &str) -> Value {
    let files = t.world.files.borrow();
    let kept = (files.get(&format!("{BUCKET}/wiki/{folder}/wiki.json")))
        .unwrap_or_else(|| panic!("no Wiki in the Bucket at wiki/{folder}"));
    serde_json::from_slice(kept).unwrap()
}

fn outcomes(t: &Setup) -> Value {
    let text = std::fs::read_to_string(t.config_dir.join("wikis.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn leaf(overview: &str) -> Value {
    json!({ "kind": "leaf", "overview": overview })
}

#[test]
fn a_linked_library_version_builds_at_its_tag_covering_only_its_subfolder() {
    let t = with_library("");
    let succeed = json!({
        "kind": "role",
        "text": "succeed wraps a value.",
        "anchors": [{ "path": "packages/effect/src/Effect.ts", "start": 1, "end": 1 }],
    });
    answer(
        &t,
        EFFECT,
        json!({ "kind": "leaf", "overview": "Effect's core.", "interpretations": [succeed] }),
    );

    let ran = t.cli(&["wiki", "build", EFFECT, "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let built = json!({
        "outcome": "built",
        "at": "2026-09-30T12:00:00Z",
        "commit": "abc1234",
        "components": 1,
        "gaps": {},
    });
    let mut said = built.clone();
    said["wiki"] = json!(EFFECT);
    assert_eq!(ran.json(), said);
    let folder = "Effect-TS/effect/effect@3.17.0/packages/effect";
    let wiki = kept(&t, folder);
    assert_eq!(
        wiki["target"],
        json!({ "repo": "Effect-TS/effect", "tag": TAG, "path": "packages/effect" })
    );
    // Only the subfolder's files, by their paths from the repo's root.
    assert_eq!(
        wiki["files"],
        json!([
            { "path": "packages/effect/package.json", "blob": blob(PACKAGE), "lines": 1 },
            { "path": "packages/effect/src/Effect.ts", "blob": blob(EFFECT_TS), "lines": 2 },
        ])
    );
    let index = &wiki["components"][0];
    assert_eq!(
        (
            &index["id"],
            &index["name"],
            &index["overview"],
            &index["files"]
        ),
        (
            &json!("index"),
            &json!(EFFECT),
            &json!("Effect's core."),
            &json!([
                "packages/effect/package.json",
                "packages/effect/src/Effect.ts"
            ])
        )
    );
    assert_eq!(
        index["interpretations"][0]["anchors"],
        json!([{ "path": "packages/effect/src/Effect.ts", "start": 1, "end": 1 }])
    );
    assert_eq!(outcomes(&t), json!({ EFFECT: built }));

    let (clone, dir) = (clone(&t), checkout(&t, folder));
    let calls = t.world.calls();
    let git: Vec<&String> = (calls.iter())
        .filter(|c| c.contains(&clone) && !c.starts_with("cd "))
        .collect();
    assert_eq!(
        git,
        [
            &format!(
                "git init --bare --quiet {clone} && git -C {clone} fetch --quiet --depth 1 {ORIGIN} +refs/tags/{TAG}:refs/tags/{TAG}"
            ),
            &format!("git -C {clone} worktree remove --force {dir}"),
            &format!("git -C {clone} worktree add --detach --quiet {dir} refs/tags/{TAG}"),
            &format!("git -C {clone} worktree remove --force {dir}"),
        ]
    );
    // The part is asked in the checkout, of the subfolder's files alone.
    let asked: Vec<&String> = (calls.iter())
        .filter(|c| c.starts_with(&format!("cd {dir} && ")))
        .collect();
    assert_eq!(asked.len(), 1);
    assert!(asked[0].contains(&format!("You are writing one part of the Wiki of {EFFECT}")));
    assert!(asked[0].contains(
        "- packages/effect/package.json (1 lines)\n- packages/effect/src/Effect.ts (2 lines)\n\n"
    ));
    assert!(!asked[0].contains("README.md") && !asked[0].contains("packages/stream"));
    assert!(calls.contains(&format!(
        "git -C {BUCKET} add -- wiki/{folder}/wiki.json && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m wiki {EFFECT} abc1234"
    )));
    // The checkout is gone once the Wiki is built.
    assert!(!(t.world.files.borrow().keys()).any(|f| f.starts_with(&format!("{dir}/"))));
}

/// A version no Repo links, added under `[wiki]`: a tag with a `/`, and no subfolder.
const ADDED: &str = "[wiki]\nlibraries = [{ repo = \"Effect-TS/effect\", tag = \"release/3.16\" }]";

#[test]
fn a_second_version_fetches_into_the_same_clone_its_tag_kept_as_one_folder_in_the_bucket() {
    let t = with_library(ADDED);
    tag_file(
        &t,
        "release/3.16",
        "packages/effect/src/Effect.ts",
        EFFECT_TS,
    );
    tag_file(&t, "release/3.16", "README.md", README);
    answer(&t, EFFECT, leaf("Effect's core."));
    answer(&t, "Effect-TS/effect@release/3.16", leaf("All of Effect."));

    let first = t.cli(&["wiki", "build", EFFECT, "--json"]);
    let second = t.cli(&["wiki", "build", "Effect-TS/effect@release/3.16", "--json"]);

    assert_eq!(first.exit_code, 0, "{}", first.stdout);
    assert_eq!(second.exit_code, 0, "{}", second.stdout);
    let clone = clone(&t);
    let fetches: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.starts_with("git init --bare"))
        .collect();
    assert_eq!(
        fetches,
        [
            format!(
                "git init --bare --quiet {clone} && git -C {clone} fetch --quiet --depth 1 {ORIGIN} +refs/tags/{TAG}:refs/tags/{TAG}"
            ),
            format!(
                "git init --bare --quiet {clone} && git -C {clone} fetch --quiet --depth 1 {ORIGIN} +refs/tags/release/3.16:refs/tags/release/3.16"
            ),
        ]
    );
    // With no subfolder, every file of the tag.
    let wiki = kept(&t, "Effect-TS/effect/release%2F3.16");
    assert_eq!(
        wiki["target"],
        json!({ "repo": "Effect-TS/effect", "tag": "release/3.16" })
    );
    assert_eq!(
        wiki["components"][0]["files"],
        json!(["README.md", "packages/effect/src/Effect.ts"])
    );
    // The first version's Wiki stays where it was.
    assert_eq!(
        kept(&t, "Effect-TS/effect/effect@3.17.0/packages/effect")["components"][0]["overview"],
        "Effect's core."
    );
    let checkout = checkout(&t, "Effect-TS/effect/release%2F3.16");
    assert!(!(t.world.files.borrow().keys()).any(|f| f.starts_with(&format!("{checkout}/"))));
}

#[test]
fn a_tag_the_library_does_not_have_fails_the_build_with_why_and_nothing_in_the_bucket() {
    let t = with_library("[wiki]\nlibraries = [{ repo = \"Effect-TS/effect\", tag = \"v9\" }]");

    let ran = t.cli(&["wiki", "build", "Effect-TS/effect@v9", "--json"]);

    assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
    let clone = clone(&t);
    let why = format!(
        "`git fetch --quiet --depth 1 {ORIGIN} +refs/tags/v9:refs/tags/v9` failed in {clone}: fatal: couldn't find remote ref refs/tags/v9"
    );
    assert_eq!(
        ran.json()["error"],
        format!("could not build the Wiki of Effect-TS/effect@v9: {why}")
    );
    assert_eq!(
        outcomes(&t),
        json!({ "Effect-TS/effect@v9": { "outcome": "failed", "at": "2026-09-30T12:00:00Z", "why": why } })
    );
    assert!(!(t.world.calls().iter()).any(|c| c.contains("worktree add") || c.starts_with("cd ")));
    assert!(!(t.world.files.borrow().keys()).any(|f| f.starts_with(&format!("{BUCKET}/wiki/"))));
}

#[test]
fn a_library_version_the_config_does_not_name_is_refused_and_no_outcome_written() {
    let t = with_library("");

    let ran = t.cli(&["wiki", "build", "Effect-TS/effect@effect@3.16.0", "--json"]);

    assert_eq!(ran.exit_code, 1, "{}", ran.stdout);
    let config = t.config_dir.join("config.toml");
    assert_eq!(
        ran.json(),
        json!({
            "error": "Effect-TS/effect@effect@3.16.0 is no Library version a Repo links or [wiki] adds",
            "help": [format!("Link it in a Repo's `libraries`, or add it to `libraries` under [wiki], in {}", config.display())],
        })
    );
    assert!(!t.config_dir.join("wikis.json").exists());
    assert!(!(t.world.calls().iter()).any(|c| c.starts_with("git ")));
}

const TICK: Duration = Duration::from_secs(600);
/// From 12:20 to 02:00 the next day: the wiki hour.
const TO_2AM: Duration = Duration::from_secs(13 * 3600 + 40 * 60);

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// The calls but the Source reads and the read of herdr's agents.
fn started(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| !c.starts_with("github ") && *c != "herdr agent list")
        .map(String::as_str)
        .collect()
}

/// What `status` shows of each Wiki.
fn wikis(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()["wikis"].clone()
}

#[test]
fn a_linked_library_version_with_no_wiki_starts_its_build_at_the_next_tick_and_status_lists_it() {
    let t = with_library("");

    let (said, calls) = calls_after(&t, || t.tick());

    // Linked, it is built though the Repo's own wiki switch is off.
    assert_eq!(
        said,
        [
            format!("{EFFECT}: wiki queued, it has none"),
            format!("{EFFECT}: wiki started on opencode"),
        ]
    );
    let config = t.config_dir.display();
    assert_eq!(
        started(&calls),
        [
            format!(
                "herdr workspace create --cwd {config} --label wiki-effect-effect-3-17-0-packag --no-focus"
            ),
            format!("herdr tab create --workspace w1 --cwd {config} --label wiki --no-focus"),
            format!("herdr pane run w1:p2 nico-agent wiki build {EFFECT}; exit"),
        ]
    );
    assert_eq!(
        wikis(&t),
        json!([{
            "wiki": EFFECT,
            "target": { "repo": "Effect-TS/effect", "tag": TAG, "path": "packages/effect" },
            "state": "building",
            "commit": null,
            "built_at": null,
            "gaps": null,
            "pane": "w1:p2",
        }])
    );
}

#[test]
fn a_library_wiki_built_is_never_queued_again_and_a_failed_one_is_tried_again_at_the_wiki_hour() {
    let t = with_library("[wiki]\nlibraries = [{ repo = \"Effect-TS/effect\", tag = \"v9\" }]");
    answer(&t, EFFECT, leaf("Effect's core."));
    t.tick();
    let built = t.cli(&["wiki", "build", EFFECT, "--json"]);
    t.world.advance(TICK);
    let first = t.tick();
    // v9 is no tag of the Library: its build fails.
    let failed = t.cli(&["wiki", "build", "Effect-TS/effect@v9", "--json"]);
    t.world.advance(TICK);
    let second = t.tick();
    t.world.advance(TICK);
    let after = t.tick();
    t.world.advance(TO_2AM - TICK);

    let (night, calls) = calls_after(&t, || t.tick());

    assert_eq!(built.exit_code, 0, "{}", built.stdout);
    assert_eq!(failed.exit_code, 1, "{}", failed.stdout);
    assert_eq!(
        first,
        [
            format!("{EFFECT}: wiki built at abc1234; its workspace closed"),
            "Effect-TS/effect@v9: wiki started on opencode".into(),
        ]
    );
    assert!(second[0].starts_with("Effect-TS/effect@v9: wiki failed: `git fetch"));
    assert_eq!(after, Vec::<String>::new());
    // At the wiki hour: the failed one again, the built one not, and no Base asked of either.
    assert_eq!(
        night,
        [
            "Effect-TS/effect@v9: wiki queued, it has none",
            "Effect-TS/effect@v9: wiki started on opencode",
        ]
    );
    assert!(!calls.iter().any(|c| c.starts_with("git ")));
    let shown = wikis(&t);
    let states: Vec<(&Value, &Value)> = (shown.as_array().unwrap().iter())
        .map(|w| (&w["wiki"], &w["state"]))
        .collect();
    assert_eq!(
        states,
        [
            (&json!(EFFECT), &json!("built")),
            (&json!("Effect-TS/effect@v9"), &json!("building"))
        ]
    );
}

#[test]
fn a_version_unlinked_before_its_turn_leaves_the_queue_and_a_repos_build_comes_first() {
    let t = with_library("switches = { wiki = true }");
    (t.world).add_tree_file("/src/api", "origin/main", "src/lib.rs", "pub fn run() {}\n");

    let queued = t.tick();
    let config = t.config_dir.join("config.toml");
    let text = std::fs::read_to_string(&config).unwrap();
    let unlinked: String = (text.lines())
        .filter(|l| !l.starts_with("libraries"))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(&config, unlinked).unwrap();
    (t.world.headless.borrow_mut()).push((
        "## The part: acme/api".into(),
        leaf("A small crate.").to_string(),
    ));
    t.cli(&["wiki", "build", "acme/api", "--json"]);
    t.world.advance(TICK);

    let said = t.tick();

    assert_eq!(
        queued,
        [
            "acme/api: wiki queued, it has none".to_string(),
            format!("{EFFECT}: wiki queued, it has none"),
            "acme/api: wiki started on opencode".into(),
        ]
    );
    assert_eq!(
        said,
        ["acme/api: wiki built at abc1234; its workspace closed"]
    );
    assert_eq!(wikis(&t).as_array().unwrap().len(), 1);
}

const QUESTION: &str = "How does Effect fail?";

/// `EFFECT` built: one leaf claiming what `fail` does, at line 2 of
/// `Effect.ts`, which Ollama embeds as it embeds `QUESTION`.
fn with_built_library() -> Setup {
    let t = with_library("");
    let fail = json!({
        "kind": "effect",
        "text": "fail wraps an error.",
        "anchors": [{ "path": "packages/effect/src/Effect.ts", "start": 2, "end": 2 }],
    });
    answer(
        &t,
        EFFECT,
        json!({ "kind": "leaf", "overview": "Effect's core.", "interpretations": [fail] }),
    );
    (t.world.embeddings.borrow_mut()).insert("fail wraps an error.".into(), vec![1.0, 0.0]);
    (t.world.embeddings.borrow_mut()).insert(QUESTION.into(), vec![1.0, 0.0]);
    let ran = t.cli(&["wiki", "build", EFFECT, "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    // The commit the tag names, as the build's fetch brought it.
    (t.world).add_tree_file(
        &clone(&t),
        "abc1234",
        "packages/effect/src/Effect.ts",
        EFFECT_TS,
    );
    t
}

/// What calling the MCP tool `name` with `arguments` answers, with `args`:
/// its JSON, or its error's text.
fn call(t: &Setup, args: &[&str], name: &str, arguments: Value) -> Result<Value, String> {
    let requests = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": name, "arguments": arguments } }),
    ];
    (t.world.stdin.borrow_mut()).extend(requests.iter().map(Value::to_string));
    let ran = t.cli(&[&["mcp"], args, &["--json"]].concat());
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    let answered: Vec<Value> = (t.world.stdout.borrow_mut().drain(..))
        .map(|line| serde_json::from_str(&line).unwrap())
        .collect();
    let result = &answered[1]["result"];
    let text = result["content"][0]["text"].as_str().unwrap().to_string();
    match result["isError"].as_bool() {
        Some(true) => Err(text),
        _ => Ok(serde_json::from_str(&text).unwrap()),
    }
}

#[test]
fn the_mcp_serves_a_library_wiki_reading_its_lines_from_the_librarys_clone() {
    let t = with_built_library();
    let wiki = |more: Value| {
        let mut arguments = json!({ "wiki": EFFECT });
        arguments
            .as_object_mut()
            .unwrap()
            .extend(more.as_object().unwrap().clone());
        arguments
    };
    let before = t.world.calls().len();

    let wikis = call(&t, &[], "wikis", json!({}));
    let found = call(&t, &[], "find_component", wiki(json!({ "query": "core" })));
    let anchor = call(
        &t,
        &[],
        "read_anchor",
        wiki(json!({ "path": "packages/effect/src/Effect.ts", "start": 2, "end": 2 })),
    );
    (t.world.headless.borrow_mut()).push((
        QUESTION.into(),
        json!({ "sentences": [{ "text": "fail wraps the error it is given.", "anchors": [{ "path": "packages/effect/src/Effect.ts", "start": 2, "end": 2 }] }] }).to_string(),
    ));
    let asked = call(&t, &[], "ask", wiki(json!({ "question": QUESTION })));
    let named = call(&t, &["--wiki", EFFECT], "wikis", json!({}));
    let unserved = call(
        &t,
        &["--wiki", "acme/api"],
        "find_component",
        wiki(json!({ "query": "core" })),
    );

    assert_eq!(
        wikis,
        Ok(
            json!([{ "wiki": EFFECT, "commit": "abc1234", "builtAt": "2026-09-30T12:00:00Z", "gaps": 0 }])
        )
    );
    assert_eq!(
        found,
        Ok(json!([{ "id": "index", "name": EFFECT, "overview": "Effect's core." }]))
    );
    assert_eq!(
        anchor,
        Ok(json!({
            "path": "packages/effect/src/Effect.ts",
            "start": 2,
            "end": 2,
            "commit": "abc1234",
            "text": "export const fail = (e) => e;",
        }))
    );
    assert_eq!(
        asked.unwrap()["answer"],
        json!([{ "text": "fail wraps the error it is given.", "anchors": [{ "path": "packages/effect/src/Effect.ts", "start": 2, "end": 2 }] }])
    );
    assert_eq!(named, wikis);
    assert_eq!(
        unserved,
        Err(format!(
            "no Wiki {EFFECT} is served here: `wikis` lists those that are"
        ))
    );
    let clone = clone(&t);
    let calls = &t.world.calls()[before..];
    assert!(calls.contains(&format!(
        "git -C {clone} show abc1234:packages/effect/src/Effect.ts"
    )));
    let prompt = (calls.iter())
        .find(|c| c.starts_with("cd ") && c.contains(QUESTION))
        .expect("ask calls the wiki model");
    assert!(prompt.contains(&format!(
        "You answer a question about the code of {EFFECT} "
    )));
    assert!(prompt.contains("```\n2: export const fail = (e) => e;\n```"));
    // Its records' embeddings, kept beside its Wiki's id, are not made again.
    let vectors = t
        .config_dir
        .join("wiki/Effect-TS/effect/effect@3.17.0/packages/effect/vectors.json");
    assert!(vectors.exists());
    assert!(!(calls.iter()).any(|c| c.starts_with("curl ") && c.contains("fail wraps an error.")));
}

#[test]
fn serve_lists_a_library_wiki_and_answers_it_by_its_id() {
    let t = with_built_library();
    t.tick();

    let listed = t.get("/api/wikis");
    let one = t.get("/api/wiki/Effect-TS%2Feffect%40effect%403.17.0%3Apackages%2Feffect");

    assert_eq!(
        listed,
        (
            200,
            json!([{
                "id": EFFECT,
                "target": { "repo": "Effect-TS/effect", "tag": TAG, "path": "packages/effect" },
                "commit": "abc1234",
                "builtAt": "2026-09-30T12:00:00Z",
                "gaps": 0,
            }])
        )
    );
    assert_eq!(
        one,
        (
            200,
            kept(&t, "Effect-TS/effect/effect@3.17.0/packages/effect")
        )
    );
}

#[test]
fn a_projects_libraries_are_linked_by_its_repos_and_a_repos_own_replace_them() {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!(
        "[projects.shop]\nlibraries = [{{ repo = \"Effect-TS/effect\", tag = \"{TAG}\", path = \"packages/effect\" }}]\n\n[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"shop\"\n\n[repos.\"acme/web\"]\npath = \"/src/web\"\nproject = \"shop\"\nlibraries = [{{ repo = \"sveltejs/svelte\", tag = \"svelte@5.0.0\" }}]\n"
    );
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();

    let said = t.tick();
    let listed = t.cli(&["repo", "list", "--json"]).json();

    assert_eq!(
        said,
        [
            format!("{EFFECT}: wiki queued, it has none"),
            "sveltejs/svelte@svelte@5.0.0: wiki queued, it has none".into(),
            format!("{EFFECT}: wiki started on opencode"),
        ]
    );
    let libraries: Vec<&Value> = (listed["repos"].as_array().unwrap().iter())
        .map(|r| &r["libraries"])
        .collect();
    assert_eq!(
        libraries,
        [
            &json!([{ "repo": "Effect-TS/effect", "tag": TAG, "path": "packages/effect" }]),
            &json!([{ "repo": "sveltejs/svelte", "tag": "svelte@5.0.0" }]),
        ]
    );
}

#[test]
fn a_claim_citing_a_file_outside_the_subfolder_is_sent_back_then_dropped_as_a_gap() {
    let t = with_library("");
    let outside = json!({
        "kind": "role",
        "text": "The README names it.",
        "anchors": [{ "path": "README.md", "start": 1, "end": 1 }],
    });
    let leaf =
        json!({ "kind": "leaf", "overview": "Effect's core.", "interpretations": [outside] });
    answer(&t, EFFECT, leaf.clone());
    (t.world.headless.borrow_mut()).push((
        format!("## Corrections to the part: {EFFECT}"),
        leaf.to_string(),
    ));

    let ran = t.cli(&["wiki", "build", EFFECT, "--json"]);

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.json()["gaps"], json!({ "unreadable": 1 }));
    let sent_back: Vec<String> = (t.world.calls().into_iter())
        .filter(|c| c.contains("## Corrections to the part:"))
        .collect();
    assert_eq!(sent_back.len(), 3);
    assert!(sent_back[0].contains(": README.md is not one of the Wiki's files\n"));
    let index = &kept(&t, "Effect-TS/effect/effect@3.17.0/packages/effect")["components"][0];
    assert_eq!(index["interpretations"], json!([]));
    assert_eq!(
        index["gaps"],
        json!([{ "paths": ["packages/effect/package.json", "packages/effect/src/Effect.ts"], "reason": "unreadable" }])
    );
}
