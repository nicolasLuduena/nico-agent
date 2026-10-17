//! Library versions linked and added from the Board: a Repo's settings link
//! them through `PATCH /api/repo/<slug>`, the Libraries tab adds and removes
//! the ones no Repo links through `POST /api/libraries` and `DELETE
//! /api/libraries/<id>`; each linked or added version with no Wiki is queued.

mod common;

use common::{Setup, setup};
use serde_json::{Value, json};

const BUCKET: &str = "/mnt/agent-land/nico-agent-bucket";
/// Where the Bucket keeps `EFFECT`'s Wiki.
const KEPT: &str = "wiki/Effect-TS/effect/effect@3.17.0/packages/effect/wiki.json";

/// The Library version the tests link and add, by its id.
const EFFECT: &str = "Effect-TS/effect@effect@3.17.0:packages/effect";
const EFFECT_JSON: &str =
    r#"{"repo": "Effect-TS/effect", "tag": "effect@3.17.0", "path": "packages/effect"}"#;

/// Repo `acme/api` as the user wrote it, linking nothing.
const WRITTEN: &str = "# Mine.\n[repos.\"acme/api\"]\npath = \"/src/api\" # the clone\n";

/// `serve` listening on `toml` as the user wrote it.
fn serving(toml: &str) -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    std::fs::write(t.config_dir.join("config.toml"), toml).unwrap();
    t.tick();
    t
}

fn config(t: &Setup) -> String {
    std::fs::read_to_string(t.config_dir.join("config.toml")).unwrap()
}

/// What `status` shows of each Wiki.
fn wikis(t: &Setup) -> Value {
    let ran = t.cli(&["status", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    ran.json()["wikis"].clone()
}

fn queued(id: &str) -> Value {
    json!([{
        "wiki": id,
        "target": { "repo": "Effect-TS/effect", "tag": "effect@3.17.0", "path": "packages/effect" },
        "state": "queued",
        "commit": null,
        "built_at": null,
        "gaps": null,
        "pane": null,
        "progress": null,
    }])
}

#[test]
fn linking_a_version_in_a_repos_settings_writes_it_keeping_comments_and_queues_its_build() {
    let t = serving(WRITTEN);

    let (status, linked) = t.send(
        "PATCH",
        "/api/repo/acme%2Fapi",
        &format!(r#"{{"libraries": [{EFFECT_JSON}]}}"#),
    );

    assert_eq!(status, 200, "{linked}");
    assert_eq!(
        linked["libraries"],
        json!({
            "value": [{ "repo": "Effect-TS/effect", "tag": "effect@3.17.0", "path": "packages/effect" }],
            "from": "repo",
        })
    );
    assert_eq!(
        config(&t),
        format!(
            "{WRITTEN}libraries = [{{ repo = \"Effect-TS/effect\", tag = \"effect@3.17.0\", path = \"packages/effect\" }}]\n"
        )
    );
    assert_eq!(wikis(&t), queued(EFFECT));
    // Queued once: the tick starts it, and queues it no more.
    assert_eq!(t.tick(), [format!("{EFFECT}: wiki started on opencode")]);
}

#[test]
fn adding_a_version_from_the_libraries_tab_writes_it_under_wiki_and_queues_its_build() {
    let t = serving(WRITTEN);

    let added = t.send("POST", "/api/libraries", EFFECT_JSON);
    let again = t.send("POST", "/api/libraries", EFFECT_JSON);

    assert_eq!(
        added,
        (200, json!({ "library": format!("{EFFECT} added") }))
    );
    assert_eq!(
        again,
        (
            200,
            json!({ "library": format!("{EFFECT} already added (no-op)") })
        )
    );
    assert_eq!(
        config(&t),
        format!(
            "{WRITTEN}\n[wiki]\nlibraries = [{{ repo = \"Effect-TS/effect\", tag = \"effect@3.17.0\", path = \"packages/effect\" }}]\n"
        )
    );
    assert_eq!(wikis(&t), queued(EFFECT));
    // The page's Libraries tab lists it.
    assert_eq!(
        t.get("/api/status").1["libraries"],
        json!([{ "repo": "Effect-TS/effect", "tag": "effect@3.17.0", "path": "packages/effect" }])
    );
}

#[test]
fn adding_keeps_the_wiki_sections_comments_and_a_version_a_repo_links_is_not_added_again() {
    let written = format!(
        "{WRITTEN}libraries = [{{ repo = \"Effect-TS/effect\", tag = \"effect@3.17.0\" }}]\n\n# Builds.\n[wiki]\ncalls = 12 # cheap\nlibraries = [\n  {{ repo = \"acme/kit\", tag = \"v1\" }}, # mine\n]\n"
    );
    let t = serving(&written);

    let linked = t.send(
        "POST",
        "/api/libraries",
        r#"{"repo": "Effect-TS/effect", "tag": "effect@3.17.0"}"#,
    );
    let added = t.send("POST", "/api/libraries", EFFECT_JSON);

    assert_eq!(
        linked,
        (
            200,
            json!({ "library": "Effect-TS/effect@effect@3.17.0 already linked by acme/api (no-op)" })
        )
    );
    assert_eq!(added.0, 200, "{}", added.1);
    assert_eq!(
        config(&t),
        written.replace(
            "# mine\n]",
            "# mine\n  { repo = \"Effect-TS/effect\", tag = \"effect@3.17.0\", path = \"packages/effect\" },\n]"
        )
    );
    // Only the version the tab adds; the one acme/api links is its own.
    let listed = t.get("/api/status").1["libraries"].clone();
    assert_eq!(
        listed,
        json!([
            { "repo": "acme/kit", "tag": "v1" },
            { "repo": "Effect-TS/effect", "tag": "effect@3.17.0", "path": "packages/effect" },
        ])
    );
}

#[test]
fn a_bad_version_is_refused_and_nothing_written() {
    let t = serving(WRITTEN);
    let help = "libraries is a list of {repo, tag, path}: a GitHub repository's owner/name, one of its tags and, if only part of it, a subfolder";

    let up = t.send(
        "POST",
        "/api/libraries",
        r#"{"repo": "Effect-TS/effect", "tag": "v1", "path": "../.."}"#,
    );
    let no_tag = t.send("POST", "/api/libraries", r#"{"repo": "Effect-TS/effect"}"#);
    let linked = t.send(
        "PATCH",
        "/api/repo/acme%2Fapi",
        r#"{"libraries": [{"repo": "effect", "tag": "v1"}]}"#,
    );

    assert_eq!(
        up,
        (
            400,
            json!({
                "error": "invalid value: string \"../..\", expected a folder's path from the repository's root, such as packages/effect",
                "help": [help],
            })
        )
    );
    assert_eq!(
        no_tag,
        (
            400,
            json!({ "error": "missing field `tag`", "help": [help] })
        )
    );
    assert_eq!(
        linked,
        (
            400,
            json!({
                "error": "libraries: invalid value: string \"effect\", expected a GitHub repository's owner/name",
                "help": [help],
            })
        )
    );
    assert_eq!(config(&t), WRITTEN);
}

/// `EFFECT` added under `[wiki]` beside `acme/kit`, as the user wrote it,
/// and its Wiki built.
fn with_built() -> Setup {
    let t = serving(&format!(
        "{WRITTEN}\n[wiki]\nlibraries = [\n  # For my sessions.\n  {{ repo = \"acme/kit\", tag = \"v1\" }}, # mine\n  # To learn it.\n  {EFFECT_TOML}, # effect\n]\n"
    ));
    t.world.add_clone(BUCKET, &[]);
    (t.world).add_tree_file(
        "https://github.com/Effect-TS/effect.git",
        "refs/tags/effect@3.17.0",
        "packages/effect/index.ts",
        "export {};\n",
    );
    (t.world.headless.borrow_mut()).push((
        format!("## The part: {EFFECT}"),
        json!({ "kind": "leaf", "overview": "Effect's core." }).to_string(),
    ));
    let ran = t.cli(&["wiki", "build", EFFECT, "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    // Its Run closed, acme/kit's started.
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

/// What `status` shows of `EFFECT`'s Wiki; null when it shows none.
fn effect(t: &Setup) -> Value {
    let wikis = wikis(t);
    let shown = wikis
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["wiki"] == EFFECT);
    shown.cloned().unwrap_or_default()
}

const EFFECT_TOML: &str =
    r#"{ repo = "Effect-TS/effect", tag = "effect@3.17.0", path = "packages/effect" }"#;
const EFFECT_PATH: &str = "/api/libraries/Effect-TS%2Feffect%40effect%403.17.0%3Apackages%2Feffect";

#[test]
fn removing_an_unlinked_version_takes_its_wiki_out_of_the_bucket_in_one_commit() {
    let t = with_built();
    assert!(
        t.world
            .files
            .borrow()
            .contains_key(&format!("{BUCKET}/{KEPT}"))
    );

    let removed = t.send("DELETE", EFFECT_PATH, "");

    assert_eq!(
        removed,
        (
            200,
            json!({ "library": format!("{EFFECT} removed"), "stays": ["its Wiki, in the Bucket's history"] })
        )
    );
    assert_eq!(
        t.world.calls(),
        [
            format!("read {BUCKET}/{KEPT}"),
            format!(
                "git -C {BUCKET} rm --quiet -r -- {KEPT} && git -C {BUCKET} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m wiki {EFFECT} removed"
            ),
        ]
    );
    assert!(
        !t.world
            .files
            .borrow()
            .contains_key(&format!("{BUCKET}/{KEPT}"))
    );
    assert_eq!(
        config(&t),
        format!(
            "{WRITTEN}\n[wiki]\nlibraries = [\n  # For my sessions.\n  {{ repo = \"acme/kit\", tag = \"v1\" }}, # mine\n]\n"
        )
    );
    assert_eq!(effect(&t), Value::Null);
    // Added again, it is built again.
    t.send("POST", "/api/libraries", EFFECT_JSON);
    assert_eq!(effect(&t)["state"], "queued");
}

#[test]
fn removing_a_linked_version_is_refused_with_help_and_changes_nothing() {
    let t = with_built();
    let linked = format!("{WRITTEN}libraries = [{EFFECT_TOML}]\n");
    let written = config(&t).replace(WRITTEN, &linked);
    std::fs::write(t.config_dir.join("config.toml"), &written).unwrap();

    let refused = t.send("DELETE", EFFECT_PATH, "");
    let unknown = t.send("DELETE", "/api/libraries/acme%2Fkit%40v2", "");

    assert_eq!(
        refused,
        (
            409,
            json!({
                "error": format!("{EFFECT} is linked by acme/api"),
                "help": ["Unlink it in acme/api's settings first; the Libraries tab holds only the versions no Repo links"],
            })
        )
    );
    assert_eq!(
        unknown,
        (200, json!({ "library": "acme/kit@v2 not added (no-op)" }))
    );
    assert_eq!(config(&t), written);
    assert_eq!(t.world.calls(), Vec::<String>::new());
    assert!(
        t.world
            .files
            .borrow()
            .contains_key(&format!("{BUCKET}/{KEPT}"))
    );
}

#[test]
fn removing_a_version_while_its_wiki_builds_is_refused() {
    let t = serving(WRITTEN);
    t.send("POST", "/api/libraries", EFFECT_JSON);
    assert_eq!(t.tick(), [format!("{EFFECT}: wiki started on opencode")]);
    let written = config(&t);

    let refused = t.send("DELETE", EFFECT_PATH, "");

    assert_eq!(
        refused,
        (
            409,
            json!({
                "error": format!("the Wiki of {EFFECT} is building"),
                "help": ["Remove it once its build ends, built or failed, as `nico-agent status` shows"],
            })
        )
    );
    assert_eq!(config(&t), written);
    assert_eq!(wikis(&t)[0]["state"], "building");
}

/// Repo `acme/api` linking two versions, one per line, with comments.
const LINKS: &str = "[repos.\"acme/api\"]\npath = \"/src/api\"\nlibraries = [\n  # Pinned for the api.\n  { repo = \"acme/kit\", tag = \"v1\" }, # the old one\n  { repo = \"acme/ui\", tag = \"v2\" },\n]\n";

#[test]
fn linking_and_unlinking_in_a_repos_settings_keeps_each_other_link_as_written() {
    let t = serving(LINKS);
    let (kit, ui) = (
        r#"{"repo": "acme/kit", "tag": "v1"}"#,
        r#"{"repo": "acme/ui", "tag": "v2"}"#,
    );

    let linked = t.send(
        "PATCH",
        "/api/repo/acme%2Fapi",
        &format!(r#"{{"libraries": [{kit}, {ui}, {EFFECT_JSON}]}}"#),
    );
    let after_link = config(&t);
    let unlinked = t.send(
        "PATCH",
        "/api/repo/acme%2Fapi",
        &format!(r#"{{"libraries": [{ui}, {EFFECT_JSON}]}}"#),
    );

    assert_eq!(
        (linked.0, unlinked.0),
        (200, 200),
        "{linked:?} {unlinked:?}"
    );
    assert_eq!(
        after_link,
        LINKS.replace(
            "  { repo = \"acme/ui\", tag = \"v2\" },\n",
            &format!("  {{ repo = \"acme/ui\", tag = \"v2\" }},\n  {EFFECT_TOML},\n"),
        )
    );
    // The old one goes with the comments about it.
    assert_eq!(
        config(&t),
        format!(
            "[repos.\"acme/api\"]\npath = \"/src/api\"\nlibraries = [\n  {{ repo = \"acme/ui\", tag = \"v2\" }},\n  {EFFECT_TOML},\n]\n"
        )
    );
}

#[test]
fn a_version_without_a_subfolder_may_send_it_null_and_one_written_twice_is_removed_whole() {
    let t = serving(&format!(
        "{WRITTEN}\n[wiki]\nlibraries = [{{ repo = \"acme/app\", tag = \"v1\" }}, {{ repo = \"acme/kit\", tag = \"v1\" }}, {{ repo = \"acme/kit\", tag = \"v1\" }}]\n"
    ));
    // The tick started acme/app's build, the first.
    let listed = t.get("/api/status").1["libraries"].clone();

    let added = t.send(
        "POST",
        "/api/libraries",
        r#"{"repo": "acme/ui", "tag": "v2", "path": null}"#,
    );
    let removed = t.send("DELETE", "/api/libraries/acme%2Fkit%40v1", "");

    // The tab lists it once.
    assert_eq!(
        listed,
        json!([{ "repo": "acme/app", "tag": "v1" }, { "repo": "acme/kit", "tag": "v1" }])
    );
    assert_eq!(added, (200, json!({ "library": "acme/ui@v2 added" })));
    assert_eq!(removed.0, 200, "{}", removed.1);
    assert_eq!(
        config(&t),
        format!(
            "{WRITTEN}\n[wiki]\nlibraries = [{{ repo = \"acme/app\", tag = \"v1\" }}, {{ repo = \"acme/ui\", tag = \"v2\" }}]\n"
        )
    );
}

#[test]
fn removing_a_version_a_repo_takes_from_its_project_points_at_the_projects_defaults() {
    let t = serving(&format!(
        "[projects.shop]\nlibraries = [{EFFECT_TOML}]\n\n[repos.\"acme/api\"]\npath = \"/src/api\"\nproject = \"shop\"\n\n[wiki]\nlibraries = [{EFFECT_TOML}]\n"
    ));

    let refused = t.send("DELETE", EFFECT_PATH, "");

    assert_eq!(
        refused,
        (
            409,
            json!({
                "error": format!("{EFFECT} is linked by acme/api"),
                "help": ["Unlink it from projects.\"shop\".libraries in config.toml, which acme/api takes it from; the Libraries tab holds only the versions no Repo links"],
            })
        )
    );
}
