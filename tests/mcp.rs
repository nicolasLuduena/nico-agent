mod common;

use common::{Setup, setup};
use serde_json::{Value, json};

const BUCKET: &str = "/mnt/agents-land/nico-agent-bucket";

const LIB: &str = "pub mod config;\npub mod web;\n\npub fn run() {}\n";
const CONFIG: &str = "pub struct Config;\n";
const APP: &str = "export const serve = () => {};\nexport const port = 80;\n";
const PAGE: &str = "<h1>Hi</h1>\n";

/// Repos `acme/api` at `/src/api` and `acme/web` at `/src/web`, each with
/// its Wiki built: acme/api's divided into Core and Web front, which calls
/// it, with a claim of Web front's dropped as a Gap; acme/web's one leaf.
fn with_wikis() -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config =
        "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n[repos.\"acme/web\"]\npath = \"/src/web\"\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_clone(BUCKET, &[]);
    for (file, text) in [
        ("src/lib.rs", LIB),
        ("src/config.rs", CONFIG),
        ("web/app.ts", APP),
    ] {
        t.world.add_tree_file("/src/api", "origin/main", file, text);
    }
    t.world
        .add_tree_file("/src/web", "origin/main", "index.html", PAGE);
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "division",
            "overview": "An HTTP API and the web page in front of it.",
            "components": [
                { "name": "Core", "summary": "The crate.", "files": ["src/lib.rs", "src/config.rs"] },
                { "name": "Web front", "summary": "The page.", "files": ["web/app.ts"] },
            ],
            "relationships": [{ "from": "Web front", "to": "Core", "kind": "calls", "description": "It calls the API." }],
            "interpretations": [{ "kind": "role", "text": "The page calls run, the entry point.", "anchors": [{ "path": "src/lib.rs", "start": 4, "end": 4 }, { "path": "web/app.ts", "start": 1, "end": 1 }] }],
            "terms": [{ "name": "run", "meaning": "The crate's entry point.", "anchors": [{ "path": "src/lib.rs", "start": 4, "end": 4 }] }],
        }),
    );
    answer(
        &t,
        "acme/api > Core",
        json!({
            "kind": "leaf",
            "overview": "The crate's modules and its config.",
            "interpretations": [interpretation("invariant", "Config is a unit struct.", "src/config.rs", 1, 1)],
        }),
    );
    let web_front = json!({
        "kind": "leaf",
        "overview": "The web page, served on port 80.",
        "interpretations": [
            interpretation("effect", "The page serves on port 80.", "web/app.ts", 2, 2),
            interpretation("role", "Past the end.", "web/app.ts", 2, 9),
        ],
    });
    answer(&t, "acme/api > Web front", web_front.clone());
    // Each correction answers the same, so "Past the end." is dropped: a Gap.
    (t.world.headless.borrow_mut()).push((
        "## Corrections to the part: acme/api > Web front".into(),
        web_front.to_string(),
    ));
    answer(
        &t,
        "acme/web",
        json!({ "kind": "leaf", "overview": "A static page.", "interpretations": [] }),
    );
    for slug in ["acme/api", "acme/web"] {
        let ran = t.cli(&["wiki", "build", slug, "--json"]);
        assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    }
    t
}

/// The part whose prompt names `trail` answers `answer`.
fn answer(t: &Setup, trail: &str, answer: Value) {
    (t.world.headless.borrow_mut()).push((format!("## The part: {trail}"), answer.to_string()));
}

fn interpretation(kind: &str, text: &str, path: &str, start: u64, end: u64) -> Value {
    json!({ "kind": kind, "text": text, "anchors": [{ "path": path, "start": start, "end": end }] })
}

/// Run `nico-agent mcp <args> --json` with `requests` on its stdin, a line
/// each: the lines it wrote to stdout, read as JSON.
fn mcp(t: &Setup, args: &[&str], requests: &[Value]) -> Vec<Value> {
    let lines = requests.iter().map(Value::to_string);
    t.world.stdin.borrow_mut().extend(lines);
    let ran = t.cli(&[&["mcp"], args, &["--json"]].concat());
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(ran.stdout, "", "stdout is the protocol's alone");
    (t.world.stdout.borrow_mut().drain(..))
        .map(|line| serde_json::from_str(&line).unwrap())
        .collect()
}

/// What calling the tool `name` with `arguments` answers, after the handshake:
/// its JSON, or its error's text.
fn call(t: &Setup, args: &[&str], name: &str, arguments: Value) -> Result<Value, String> {
    let called = request(
        2,
        "tools/call",
        json!({ "name": name, "arguments": arguments }),
    );
    let answered = mcp(t, args, &[initialize(), called]);
    let result = &answered[1]["result"];
    let text = result["content"][0]["text"].as_str().unwrap().to_string();
    assert_eq!(result["content"][0]["type"], "text");
    match result["isError"].as_bool() {
        Some(true) => Err(text),
        _ => Ok(serde_json::from_str(&text).unwrap()),
    }
}

fn initialize() -> Value {
    request(
        1,
        "initialize",
        json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "claude-code", "version": "2.1.296" } }),
    )
}

fn request(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

#[test]
fn it_answers_the_handshake_as_mcp_requires_and_never_a_notification() {
    let t = setup();
    let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });

    let answered = mcp(
        &t,
        &[],
        &[initialize(), initialized, request(2, "ping", json!({}))],
    );

    assert_eq!(answered.len(), 2, "{answered:?}");
    let init = &answered[0];
    assert_eq!(init["jsonrpc"], "2.0");
    assert_eq!(init["id"], 1);
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(init["result"]["capabilities"], json!({ "tools": {} }));
    assert_eq!(
        init["result"]["serverInfo"],
        json!({ "name": "nico-agent", "version": env!("CARGO_PKG_VERSION") })
    );
    assert_eq!(
        answered[1],
        json!({ "jsonrpc": "2.0", "id": 2, "result": {} })
    );
}

#[test]
fn it_lists_its_five_tools_each_read_only_with_its_arguments() {
    let t = setup();

    let answered = mcp(
        &t,
        &[],
        &[initialize(), request(2, "tools/list", json!({}))],
    );

    let tools = answered[1]["result"]["tools"].as_array().unwrap();
    let listed: Vec<(&str, &Value)> = (tools.iter())
        .map(|tool| {
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert_eq!(tool["annotations"]["readOnlyHint"], true);
            assert!(!tool["description"].as_str().unwrap().is_empty());
            (
                tool["name"].as_str().unwrap(),
                &tool["inputSchema"]["required"],
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            ("wikis", &json!([])),
            ("find_component", &json!(["wiki", "query"])),
            ("get_component", &json!(["wiki", "id"])),
            ("read_anchor", &json!(["wiki", "path", "start", "end"])),
            ("ask", &json!(["wiki", "question"])),
        ]
    );
}

#[test]
fn wikis_lists_every_wiki_with_its_commit_build_time_gap_count_and_how_far_behind_it_is() {
    let t = with_wikis();

    let wikis = call(&t, &[], "wikis", json!({}));

    assert_eq!(
        wikis,
        Ok(json!([
            { "wiki": "acme/api", "commit": "abc1234", "builtAt": "2026-09-30T12:00:00Z", "gaps": 1, "behind": 0 },
            { "wiki": "acme/web", "commit": "abc1234", "builtAt": "2026-09-30T12:00:00Z", "gaps": 0, "behind": 0 },
        ]))
    );
}

#[test]
fn find_component_lists_the_components_whose_name_or_overview_match_best_first() {
    let t = with_wikis();

    let found = call(
        &t,
        &[],
        "find_component",
        json!({ "wiki": "acme/api", "query": "Web page" }),
    );

    // Both words in Web front's overview and one in its name; none in Core's.
    assert_eq!(
        found,
        Ok(json!([
            { "id": "web-front", "name": "Web front", "overview": "The web page, served on port 80." },
            { "id": "index", "name": "acme/api", "overview": "An HTTP API and the web page in front of it." },
        ]))
    );
    let none = call(
        &t,
        &[],
        "find_component",
        json!({ "wiki": "acme/api", "query": "database" }),
    );
    assert_eq!(none, Ok(json!([])));
}

#[test]
fn find_component_finds_a_component_by_one_of_its_terms_names_as_by_its_own() {
    let t = with_wikis();

    let found = call(
        &t,
        &[],
        "find_component",
        json!({ "wiki": "acme/api", "query": "run" }),
    );

    // Only the top part's Term holds it.
    assert_eq!(
        found,
        Ok(
            json!([{ "id": "index", "name": "acme/api", "overview": "An HTTP API and the web page in front of it." }])
        )
    );
}

#[test]
fn get_component_gives_its_terms_interpretations_relationships_sub_components_and_gaps() {
    let t = with_wikis();

    let index = call(
        &t,
        &[],
        "get_component",
        json!({ "wiki": "acme/api", "id": "index" }),
    );
    let web = call(
        &t,
        &[],
        "get_component",
        json!({ "wiki": "acme/api", "id": "web-front" }),
    );
    let core = call(
        &t,
        &[],
        "get_component",
        json!({ "wiki": "acme/api", "id": "core" }),
    );

    // A parent's files are its parts': only a leaf lists them.
    assert_eq!(
        index,
        Ok(json!({
            "id": "index",
            "name": "acme/api",
            "parent": null,
            "overview": "An HTTP API and the web page in front of it.",
            "terms": [{ "name": "run", "meaning": "The crate's entry point.", "anchors": [{ "path": "src/lib.rs", "start": 4, "end": 4 }] }],
            "interpretations": [{ "id": 1, "kind": "role", "text": "The page calls run, the entry point.", "anchors": [{ "path": "src/lib.rs", "start": 4, "end": 4 }, { "path": "web/app.ts", "start": 1, "end": 1 }] }],
            "relationships": [],
            "gaps": [],
            "components": [
                { "id": "core", "name": "Core", "overview": "The crate's modules and its config." },
                { "id": "web-front", "name": "Web front", "overview": "The web page, served on port 80." },
            ],
        }))
    );
    assert_eq!(
        web,
        Ok(json!({
            "id": "web-front",
            "name": "Web front",
            "parent": "index",
            "overview": "The web page, served on port 80.",
            "files": ["web/app.ts"],
            "interpretations": [{ "id": 1, "kind": "effect", "text": "The page serves on port 80.", "anchors": [{ "path": "web/app.ts", "start": 2, "end": 2 }] }],
            "relationships": [{ "to": "core", "kind": "calls", "description": "It calls the API." }],
            "gaps": [{ "paths": ["web/app.ts"], "reason": "unreadable" }],
            "components": [],
        }))
    );
    // What uses it too, though the Wiki keeps a Relationship on its user's side.
    assert_eq!(
        core.unwrap()["relationships"],
        json!([{ "from": "web-front", "kind": "calls", "description": "It calls the API." }])
    );
    assert_eq!(
        call(
            &t,
            &[],
            "get_component",
            json!({ "wiki": "acme/api", "id": "db" })
        ),
        Err("acme/api has no Component db: find_component finds them".into())
    );
}

#[test]
fn get_component_marks_stale_each_interpretation_citing_a_file_the_base_changed() {
    let t = with_wikis();
    let moved = "export const port = 8080;\nexport const serve = () => {};\n";
    t.world
        .add_tree_file("/src/api", "origin/main", "web/app.ts", moved);

    let web = call(
        &t,
        &[],
        "get_component",
        json!({ "wiki": "acme/api", "id": "web-front" }),
    );
    let core = call(
        &t,
        &[],
        "get_component",
        json!({ "wiki": "acme/api", "id": "core" }),
    );

    assert_eq!(
        web.unwrap()["interpretations"],
        json!([{ "id": 1, "kind": "effect", "text": "The page serves on port 80.", "anchors": [{ "path": "web/app.ts", "start": 2, "end": 2 }], "stale": true }])
    );
    assert_eq!(
        core.unwrap()["interpretations"],
        json!([{ "id": 1, "kind": "invariant", "text": "Config is a unit struct.", "anchors": [{ "path": "src/config.rs", "start": 1, "end": 1 }] }])
    );
}

#[test]
fn read_anchor_reads_the_lines_at_the_wikis_commit_after_the_base_has_moved_and_writes_nothing() {
    let t = with_wikis();
    // The Base moves on past the Wiki's commit, abc1234, changing the file.
    t.world
        .add_tree_file("/src/api", "abc1234", "web/app.ts", APP);
    let moved = "export const port = 8080;\nexport const serve = () => {};\n";
    t.world
        .add_tree_file("/src/api", "origin/main", "web/app.ts", moved);
    let config = std::fs::read_dir(&t.config_dir).unwrap().count();
    let before = t.world.calls().len();

    let read = call(
        &t,
        &[],
        "read_anchor",
        json!({ "wiki": "acme/api", "path": "web/app.ts", "start": 2, "end": 2 }),
    );

    assert_eq!(
        read,
        Ok(
            json!({ "path": "web/app.ts", "start": 2, "end": 2, "commit": "abc1234", "text": "export const port = 80;" })
        )
    );
    assert_eq!(
        t.world.calls()[before..],
        [
            format!("read {BUCKET}/wiki/acme/api/wiki.json"),
            "git -C /src/api show abc1234:web/app.ts".into(),
        ]
    );
    assert_eq!(std::fs::read_dir(&t.config_dir).unwrap().count(), config);
    let both = call(
        &t,
        &[],
        "read_anchor",
        json!({ "wiki": "acme/api", "path": "web/app.ts", "start": 1, "end": 2 }),
    );
    assert_eq!(
        both.unwrap()["text"],
        "export const serve = () => {};\nexport const port = 80;"
    );
}

#[test]
fn read_anchor_refuses_lines_outside_the_file_a_file_not_at_the_commit_and_a_bad_line() {
    let t = with_wikis();
    t.world
        .add_tree_file("/src/api", "abc1234", "web/app.ts", APP);
    let read = |path: &str, start: Value, end: Value| {
        let arguments = json!({ "wiki": "acme/api", "path": path, "start": start, "end": end });
        call(&t, &[], "read_anchor", arguments)
    };

    assert_eq!(
        read("web/app.ts", json!(2), json!(9)),
        Err("lines 2-9 are not inside web/app.ts (2 lines)".into())
    );
    assert_eq!(
        read("web/app.ts", json!(2), json!(1)),
        Err("lines 2-1 are not inside web/app.ts (2 lines)".into())
    );
    assert_eq!(
        read("web/new.ts", json!(1), json!(1)),
        Err("web/new.ts is not a file of acme/api at abc1234".into())
    );
    assert_eq!(
        read("web/app.ts", json!(0), json!(1)),
        Err("`start` is required, a line number from 1".into())
    );
}

#[test]
fn wiki_limits_what_it_serves_and_an_unserved_or_unknown_wiki_is_a_tool_error() {
    let t = with_wikis();

    let wikis = call(&t, &["--wiki", "acme/web"], "wikis", json!({}));
    let unserved = call(
        &t,
        &["--wiki", "acme/web"],
        "get_component",
        json!({ "wiki": "acme/api", "id": "index" }),
    );
    let unknown = call(
        &t,
        &[],
        "find_component",
        json!({ "wiki": "acme/nope", "query": "web" }),
    );
    let both = call(
        &t,
        &["--wiki", "acme/web", "--wiki", "acme/api"],
        "wikis",
        json!({}),
    );

    assert_eq!(wikis.unwrap().as_array().unwrap().len(), 1);
    assert_eq!(wikis_of(&t, &["--wiki", "acme/web"]), ["acme/web"]);
    let not = |wiki: &str| format!("no Wiki {wiki} is served here: `wikis` lists those that are");
    assert_eq!(unserved, Err(not("acme/api")));
    assert_eq!(unknown, Err(not("acme/nope")));
    assert_eq!(both.unwrap().as_array().unwrap().len(), 2);
    // A tool error ends nothing: it goes on answering.
    assert_eq!(wikis_of(&t, &[]), ["acme/api", "acme/web"]);
}

/// The Wikis `wikis` names, served with `args`.
fn wikis_of(t: &Setup, args: &[&str]) -> Vec<String> {
    let wikis = call(t, args, "wikis", json!({})).unwrap();
    (wikis.as_array().unwrap().iter())
        .map(|w| w["wiki"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_repo_whose_wiki_is_not_built_is_not_served() {
    let t = with_wikis();
    let config =
        "[repos.\"acme/api\"]\npath = \"/src/api\"\n\n[repos.\"acme/new\"]\npath = \"/src/new\"\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();

    assert_eq!(wikis_of(&t, &[]), ["acme/api"]);
    assert_eq!(
        call(
            &t,
            &[],
            "get_component",
            json!({ "wiki": "acme/new", "id": "index" })
        ),
        Err("no Wiki acme/new is served here: `wikis` lists those that are".into())
    );
}

#[test]
fn it_answers_what_it_cannot_do_with_the_json_rpc_error_for_it() {
    let t = setup();
    let unknown = request(2, "tools/call", json!({ "name": "grep", "arguments": {} }));
    let newer = request(
        5,
        "initialize",
        json!({ "protocolVersion": "2099-01-01", "capabilities": {} }),
    );
    let missing = request(
        6,
        "tools/call",
        json!({ "name": "get_component", "arguments": { "id": "index" } }),
    );

    let answered = mcp(
        &t,
        &[],
        &[
            initialize(),
            unknown,
            request(3, "resources/list", json!({})),
            json!("not json-rpc"),
            newer,
            missing,
        ],
    );
    t.world.stdin.borrow_mut().push_back("{".into());
    let unparsed = mcp(&t, &[], &[]);

    let error = |id: Value, code: i64, message: &str| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } });
    assert_eq!(answered[1], error(json!(2), -32602, "Unknown tool: grep"));
    assert_eq!(
        answered[2],
        error(json!(3), -32601, "Method not found: resources/list")
    );
    // A batch, or anything else not one message, is no request.
    assert_eq!(answered[3], error(Value::Null, -32600, "Invalid Request"));
    assert_eq!(answered[4]["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(
        answered[5]["result"],
        json!({ "content": [{ "type": "text", "text": "`wiki` is required, a string" }], "isError": true })
    );
    assert_eq!(unparsed, [error(Value::Null, -32700, "Parse error")]);
}

const QUESTION: &str = "Which number does a browser connect to?";
const EMBED: &str = "curl -X POST http://127.0.0.1:11434/api/embed -d ";

/// acme/api with its Wiki one leaf of nine records: its overview, "The page
/// serves on port 80.", six claims of `src/lib.rs`, "Claim 1." to "Claim 6.",
/// and "Config is a unit struct.", and an Explainer of `web/app.ts`. Ollama embeds the port's claim as it
/// embeds `QUESTION`, the config's opposite it, and the rest across it.
fn with_claims() -> Setup {
    let t = setup();
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_clone(BUCKET, &[]);
    for (file, text) in [
        ("src/lib.rs", LIB),
        ("src/config.rs", CONFIG),
        ("web/app.ts", APP),
    ] {
        for rev in ["origin/main", "abc1234"] {
            t.world.add_tree_file("/src/api", rev, file, text);
        }
    }
    let mut claims = vec![interpretation(
        "effect",
        "The page serves on port 80.",
        "web/app.ts",
        2,
        2,
    )];
    claims.extend(
        (1..=6).map(|n| interpretation("role", &format!("Claim {n}."), "src/lib.rs", 1, 2)),
    );
    claims.push(interpretation(
        "invariant",
        "Config is a unit struct.",
        "src/config.rs",
        1,
        1,
    ));
    answer(
        &t,
        "acme/api",
        json!({
            "kind": "leaf",
            "overview": "An HTTP API and its web page.",
            "interpretations": claims,
            "explainer": { "title": "Serving", "steps": [{ "n": 1, "caption": "It serves on the port.", "anchors": [{ "path": "web/app.ts", "start": 1, "end": 2 }] }] },
        }),
    );
    let mut embeddings = t.world.embeddings.borrow_mut();
    embeddings.insert(QUESTION.into(), vec![1.0, 0.0]);
    embeddings.insert("The page serves on port 80.".into(), vec![1.0, 0.0]);
    embeddings.insert("Config is a unit struct.".into(), vec![-1.0, 0.0]);
    drop(embeddings);
    let ran = t.cli(&["wiki", "build", "acme/api", "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    t
}

/// The wiki model answers `QUESTION` with `sentences`.
fn answers(t: &Setup, sentences: Value) {
    let answer = json!({ "sentences": sentences }).to_string();
    (t.world.headless.borrow_mut()).push((QUESTION.into(), answer));
}

/// The calls `ask` made to the wiki model, each its whole command line.
fn asked(t: &Setup) -> Vec<String> {
    let dir = t.config_dir.display().to_string();
    (t.world.calls().into_iter())
        .filter(|c| c.starts_with(&format!("cd {dir} && ")))
        .collect()
}

#[test]
fn ask_answers_from_the_closest_records_only_and_drops_each_sentence_citing_none_of_theirs() {
    let t = with_claims();
    let port = json!({ "path": "web/app.ts", "start": 2, "end": 2 });
    answers(
        &t,
        json!([
            { "text": "A browser connects to port 80.", "anchors": [port] },
            { "text": "Config holds no fields.", "anchors": [{ "path": "src/config.rs", "start": 1, "end": 1 }] },
            { "text": "It is fast.", "anchors": [] },
            { "text": "It also serves.", "anchors": [port, { "path": "web/app.ts", "start": 1, "end": 2 }] },
            { "text": "Its first line is a module.", "anchors": [{ "path": "src/lib.rs", "start": 1, "end": 1 }] },
            { "text": "Backwards.", "anchors": [{ "path": "src/lib.rs", "start": 2, "end": 1 }] },
        ]),
    );
    let before = t.world.calls().len();

    let answered = call(
        &t,
        &[],
        "ask",
        json!({ "wiki": "acme/api", "question": QUESTION }),
    );

    let claim = |id: u64, kind: &str, text: &str, anchor: Value| json!({ "component": "index", "id": id, "kind": kind, "text": text, "anchors": [anchor] });
    let lib = json!({ "path": "src/lib.rs", "start": 1, "end": 2 });
    assert_eq!(
        answered,
        Ok(json!({
            "answer": [
                { "text": "A browser connects to port 80.", "anchors": [port] },
                { "text": "Its first line is a module.", "anchors": [{ "path": "src/lib.rs", "start": 1, "end": 1 }] },
            ],
            "records": [
                claim(1, "effect", "The page serves on port 80.", port.clone()),
                claim(2, "role", "Claim 1.", lib.clone()),
                claim(3, "role", "Claim 2.", lib.clone()),
                claim(4, "role", "Claim 3.", lib.clone()),
                claim(5, "role", "Claim 4.", lib.clone()),
                claim(6, "role", "Claim 5.", lib.clone()),
                claim(7, "role", "Claim 6.", lib),
            ],
        }))
    );
    let calls = t.world.calls()[before..].to_vec();
    let question = json!({ "model": "nomic-embed-text", "input": [QUESTION] });
    assert!(calls.contains(&format!("{EMBED}{question}")), "{calls:?}");
    // One call with no tools at all, of the eight records closest to the
    // question, best first, each claim with the lines it cites.
    let asked = asked(&t);
    assert_eq!(asked.len(), 1);
    let dir = t.config_dir.display();
    let prompt = (asked[0].strip_prefix(&format!(
        r#"cd {dir} && env OPENCODE_CONFIG_CONTENT={{"permission":{{"*":"deny"}}}} opencode2 run --standalone -m opencode-go/deepseek-v4.1-flash --format json "#
    )))
    .expect("a call with no tools");
    assert!(prompt.contains(&format!("\n{QUESTION}\n")), "{prompt}");
    let shown = |text: &str| {
        prompt
            .find(text)
            .unwrap_or_else(|| panic!("{text} in {prompt}"))
    };
    assert!(prompt.contains(
        "The page serves on port 80.\n\n{\"path\": \"web/app.ts\", \"start\": 2, \"end\": 2}\n\n```\n2: export const port = 80;\n```\n"
    ), "{prompt}");
    assert!(shown("The page serves on port 80.") < shown("An HTTP API and its web page."));
    assert!(shown("Claim 6.") > 0);
    assert!(!prompt.contains("Config is a unit struct."), "{prompt}");
    assert!(!prompt.contains("pub struct Config;"), "{prompt}");
}

#[test]
fn ask_on_a_claude_wiki_launch_is_one_claude_p_with_no_tools_at_all() {
    let t = with_claims();
    let file = t.config_dir.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap();
    std::fs::write(
        &file,
        format!("{config}\n[wiki]\nlaunch = {{ harness = \"claude\" }}\n"),
    )
    .unwrap();
    let port = json!({ "path": "web/app.ts", "start": 2, "end": 2 });
    answers(
        &t,
        json!([{ "text": "A browser connects to port 80.", "anchors": [port] }]),
    );

    let answered = call(
        &t,
        &[],
        "ask",
        json!({ "wiki": "acme/api", "question": QUESTION }),
    );

    assert_eq!(
        answered.unwrap()["answer"][0]["text"],
        "A browser connects to port 80."
    );
    let asked = asked(&t);
    assert_eq!(asked.len(), 1);
    let dir = t.config_dir.display();
    assert!(
        asked[0].starts_with(&format!(
            "cd {dir} && env claude -p --output-format json --tools= --strict-mcp-config --permission-prompts none You answer a question"
        )),
        "{}",
        asked[0]
    );
}

#[test]
fn ask_embeds_the_records_whose_vectors_are_missing_first_and_keeps_them() {
    let t = with_claims();
    let vectors = t.config_dir.join("wiki/acme/api/vectors.json");
    std::fs::remove_file(&vectors).unwrap();
    answers(&t, json!([]));
    let ask = || {
        call(
            &t,
            &[],
            "ask",
            json!({ "wiki": "acme/api", "question": QUESTION }),
        )
    };
    let embeds = || {
        (t.world.calls().into_iter())
            .filter(|c| c.starts_with(EMBED))
            .collect::<Vec<_>>()
    };
    let built = embeds().len();

    let first = ask();
    let kept = std::fs::read_to_string(&vectors);
    let second = ask();

    let records = [
        "An HTTP API and its web page.",
        "The page serves on port 80.",
        "Claim 1.",
        "Claim 2.",
        "Claim 3.",
        "Claim 4.",
        "Claim 5.",
        "Claim 6.",
        "Config is a unit struct.",
    ];
    let embed = |input: &[&str]| {
        format!(
            "{EMBED}{}",
            json!({ "model": "nomic-embed-text", "input": input })
        )
    };
    assert_eq!(
        embeds()[built..],
        [embed(&records), embed(&[QUESTION]), embed(&[QUESTION])]
    );
    assert_eq!(first, Ok(json!({ "answer": [], "records": [] })));
    assert_eq!(second, first);
    let kept: Value = serde_json::from_str(&kept.unwrap()).unwrap();
    assert_eq!(kept["model"], "nomic-embed-text");
    assert_eq!(
        kept["vectors"]["The page serves on port 80."],
        json!([1.0, 0.0])
    );
    assert_eq!(kept["vectors"].as_object().unwrap().len(), records.len());
    // One that does not read is made again, as a missing one is.
    std::fs::write(&vectors, "{\"model\": ").unwrap();
    assert_eq!(ask(), first);
    assert_eq!(embeds()[built + 3..], [embed(&records), embed(&[QUESTION])]);
}

#[test]
fn ask_says_search_is_unavailable_when_ollama_fails_and_asks_no_model() {
    let t = with_claims();
    answers(&t, json!([]));
    t.world.fail_call(
        EMBED,
        "could not reach http://127.0.0.1:11434/api/embed: Connection refused",
    );

    let answered = call(
        &t,
        &[],
        "ask",
        json!({ "wiki": "acme/api", "question": QUESTION }),
    );

    assert_eq!(
        answered,
        Err("search unavailable, use find_component".into())
    );
    assert!(asked(&t).is_empty());
}

#[test]
fn a_file_changed_on_the_base_since_the_build_flags_the_claims_and_explainer_citing_it_stale() {
    let t = with_claims();
    let port = json!({ "path": "web/app.ts", "start": 2, "end": 2 });
    answers(
        &t,
        json!([{ "text": "A browser connects to port 80.", "anchors": [port] }]),
    );
    let moved = "export const port = 8080;\nexport const serve = () => {};\n";
    t.world
        .add_tree_file("/src/api", "origin/main", "web/app.ts", moved);
    (t.world.behind.borrow_mut()).insert("/src/api abc1234..origin/main".into(), 2);
    let ask = request(
        2,
        "tools/call",
        json!({ "name": "ask", "arguments": { "wiki": "acme/api", "question": QUESTION } }),
    );

    let answered = mcp(&t, &[], &[initialize(), ask]);
    let found = call(
        &t,
        &[],
        "find_component",
        json!({ "wiki": "acme/api", "query": "page" }),
    );
    let index = call(
        &t,
        &[],
        "get_component",
        json!({ "wiki": "acme/api", "id": "index" }),
    );
    let wikis = call(&t, &[], "wikis", json!({}));

    let content = &answered[1]["result"]["content"];
    let asked: Value = serde_json::from_str(content[0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        asked["records"],
        json!([{ "component": "index", "id": 1, "kind": "effect", "text": "The page serves on port 80.", "anchors": [port], "stale": true }])
    );
    let warning = json!([{ "type": "text", "text": "Some of these are Stale: they cite a file that changed on the Repo's Base since the Wiki was built, so check them in the code." }]);
    assert_eq!(
        content.as_array().unwrap()[1..],
        warning.as_array().unwrap()[..]
    );
    assert_eq!(
        found,
        Ok(
            json!([{ "id": "index", "name": "acme/api", "overview": "An HTTP API and its web page.", "stale": true }])
        )
    );
    assert_eq!(index.unwrap()["explainer"]["stale"], true);
    assert_eq!(
        wikis,
        Ok(
            json!([{ "wiki": "acme/api", "commit": "abc1234", "builtAt": "2026-09-30T12:00:00Z", "gaps": 0, "behind": 2 }])
        )
    );
}
