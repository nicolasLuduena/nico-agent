//! `nico-agent mcp`: the Wikis, served to agents as an MCP server over
//! stdio, a JSON-RPC message a line. Each call reads the config, the Bucket
//! and the clones afresh, so a build that lands meanwhile is served;
//! it writes nothing but the embeddings `ask` makes of a Wiki lacking them.

use std::cmp::Reverse;

use serde_json::{Value, json};

use crate::args::Args;
use crate::ask;
use crate::bucket;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config};
use crate::wiki::{self, Of};

/// The MCP versions it speaks, the latest last.
const VERSIONS: [&str; 4] = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

const INSTRUCTIONS: &str = "The Wikis of the user's Repos and of the Library versions they use: what each one's code does as of one commit, as a tree of Components whose every claim (an Interpretation) cites the lines it rests on (its Anchors). Ask here before reading a Repo's code: `wikis` lists them, `find_component` finds a Component by words, `get_component` reads one, the top one being `index`, `read_anchor` reads the lines a claim cites, and `ask` answers a question in a few sentences, each citing lines. Where a Wiki and the code disagree, the code wins.";

/// `mcp [--wiki <wiki>]...`: answer each request on stdin till it
/// closes, serving the Wikis named, or every one.
pub fn mcp(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let args = Args::parse("mcp", args, &["--wiki"])?;
    args.positionals(&[])?;
    let named = args.all("--wiki");
    while let Some(line) = ctx.world.read_line()? {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(answer) = answer(ctx, &named, &line) {
            ctx.world.write_line(&answer.to_string())?;
        }
    }
    // Stdout is the protocol's: nothing more to print.
    Ok(Value::Null)
}

/// The response to the message `line`; none to a notification.
fn answer(ctx: &Context, named: &[&str], line: &str) -> Option<Value> {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Some(error(Value::Null, -32700, "Parse error".into()));
    };
    // A batch too: no MCP version this speaks needs one.
    if !message.is_object() {
        return Some(error(Value::Null, -32600, "Invalid Request".into()));
    }
    let id = message.get("id")?.clone();
    let params = &message["params"];
    let result = match message["method"].as_str().unwrap_or_default() {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or_default();
            let version = VERSIONS.into_iter().find(|v| *v == asked);
            json!({
                "protocolVersion": version.unwrap_or(VERSIONS[VERSIONS.len() - 1]),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "nico-agent", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            let Some(called) = called(ctx, named, name, &params["arguments"]) else {
                return Some(error(id, -32602, format!("Unknown tool: {name}")));
            };
            match called {
                Ok(answer) => {
                    json!({ "content": [{ "type": "text", "text": answer.to_string() }] })
                }
                Err(why) => {
                    json!({ "content": [{ "type": "text", "text": why }], "isError": true })
                }
            }
        }
        method => return Some(error(id, -32601, format!("Method not found: {method}"))),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// A JSON-RPC error answering the request `id`.
fn error(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Each tool, as `tools/list` lists it.
fn tools() -> Value {
    let tool = |name: &str, description: &str, properties: Value, required: &[&str]| {
        json!({
            "name": name,
            "description": description,
            "inputSchema": { "type": "object", "properties": properties, "required": required },
            "annotations": { "readOnlyHint": true },
        })
    };
    let wiki = json!({ "type": "string", "description": "The Wiki, as `wikis` names it: a Repo's owner/name, or a Library version's owner/name@tag, then :path for its subfolder." });
    let line = |what: &str| json!({ "type": "integer", "minimum": 1, "description": what });
    json!([
        tool(
            "wikis",
            "List the Wikis served: each one's name, the commit it describes, when it was built and how many Gaps (parts of the code it never reached) it has.",
            json!({}),
            &[],
        ),
        tool(
            "find_component",
            "Find the Components of a Wiki whose name or overview hold the query's words, best first: each one's id, name and overview.",
            json!({ "wiki": wiki, "query": { "type": "string", "description": "Words to look for." } }),
            &["wiki", "query"],
        ),
        tool(
            "get_component",
            "Read a Component of a Wiki: its overview, its Interpretations (one-sentence claims, each an invariant, precondition, postcondition, effect or role, citing Anchors: a path and lines, 1-based and inclusive), its Relationships (`to` what it uses, `from` what uses it), its sub-Components and its Gaps; a leaf's files too. `index` is a Wiki's top Component.",
            json!({ "wiki": wiki, "id": { "type": "string", "description": "The Component's id, as find_component or a parent gives it." } }),
            &["wiki", "id"],
        ),
        tool(
            "read_anchor",
            "Read lines of a file at the commit a Wiki describes, as an Anchor cites them, to check a claim against the code.",
            json!({
                "wiki": wiki,
                "path": { "type": "string", "description": "The file's path in the Repo." },
                "start": line("The first line, from 1."),
                "end": line("The last line, inclusive."),
            }),
            &["wiki", "path", "start", "end"],
        ),
        tool(
            "ask",
            "Ask a Wiki a question about its Repo's code: an answer of a few sentences, each citing the Anchors it rests on, made from only the Interpretations and overviews closest to the question, with the Interpretations it cites. Answers \"search unavailable\" when it cannot search: use find_component then.",
            json!({ "wiki": wiki, "question": { "type": "string", "description": "The question, in words." } }),
            &["wiki", "question"],
        ),
    ])
}

/// What the tool `name` answers `arguments` with, or why it cannot; `None`
/// when there is no such tool.
fn called(
    ctx: &Context,
    named: &[&str],
    name: &str,
    arguments: &Value,
) -> Option<Result<Value, String>> {
    let config = config::load(&ctx.config_dir).map_err(|no| no.error);
    Some(match name {
        "wikis" => config.and_then(|config| wikis(ctx, named, &config)),
        "find_component" => config.and_then(|config| {
            let (_, wiki) = served(ctx, named, &config, arguments)?;
            Ok(found(&wiki, text(arguments, "query")?))
        }),
        "get_component" => config.and_then(|config| {
            let (of, wiki) = served(ctx, named, &config, arguments)?;
            component(&of.id(), &wiki, text(arguments, "id")?)
        }),
        "read_anchor" => config.and_then(|config| {
            let (of, wiki) = served(ctx, named, &config, arguments)?;
            let clone = of.clone_dir(&ctx.config_dir);
            anchor(ctx, &of.id(), &clone, &wiki, arguments)
        }),
        "ask" => config.and_then(|config| {
            let (of, wiki) = served(ctx, named, &config, arguments)?;
            let question = text(arguments, "question")?;
            ask::ask(ctx, &config, &of, &wiki, question)
        }),
        _ => return None,
    })
}

/// The Wiki the argument `wiki` names, and what the Bucket holds of it,
/// when it is built and served.
fn served<'a>(
    ctx: &Context,
    named: &[&str],
    config: &'a Config,
    arguments: &Value,
) -> Result<(Of<'a>, Value), String> {
    let wiki = text(arguments, "wiki")?;
    let of = (wiki::of(config, wiki))
        .filter(|of| serves(named, &of.id()))
        .ok_or_else(|| unserved(wiki))?;
    let held = read(ctx, config, &of)?.ok_or_else(|| unserved(&of.id()))?;
    Ok((of, held))
}

/// Whether the Wiki `id` is one of those `named`, or none is: a Repo's
/// slug in any casing.
fn serves(named: &[&str], id: &str) -> bool {
    named.is_empty() || named.iter().any(|n| n.eq_ignore_ascii_case(id))
}

/// Why a tool refuses the Wiki `wiki`: not built, not the config's, or not named.
fn unserved(wiki: &str) -> String {
    format!("no Wiki {wiki} is served here: `wikis` lists those that are")
}

/// The Wiki `of`, as the Bucket holds it; `None` before its first build.
fn read(ctx: &Context, config: &Config, of: &Of) -> Result<Option<Value>, String> {
    let Some(held) = bucket::wiki(ctx.world, config, &of.folder()).map_err(|e| e.0)? else {
        return Ok(None);
    };
    (serde_json::from_slice(&held).map(Some))
        .map_err(|e| format!("the Wiki of {} does not read: {e}", of.id()))
}

/// Each Wiki served that is built, with its commit, build time and Gap count.
fn wikis(ctx: &Context, named: &[&str], config: &Config) -> Result<Value, String> {
    let mut wikis = vec![];
    for of in wiki::every(config) {
        let id = of.id();
        if !serves(named, &id) {
            continue;
        }
        if let Some(wiki) = read(ctx, config, &of)? {
            let gaps: usize = (components(&wiki).iter())
                .map(|c| c["gaps"].as_array().map_or(0, Vec::len))
                .sum();
            let (commit, built_at) = (&wiki["commit"], &wiki["builtAt"]);
            wikis.push(json!({ "wiki": id, "commit": commit, "builtAt": built_at, "gaps": gaps }));
        }
    }
    Ok(json!(wikis))
}

/// The Components of `wiki` whose name or overview hold the words of
/// `query`: a word in the name counts twice, one in the overview once.
fn found(wiki: &Value, query: &str) -> Value {
    let query = query.to_lowercase();
    let words: Vec<&str> = (query.split(|c: char| !c.is_alphanumeric()))
        .filter(|word| !word.is_empty())
        .collect();
    let lower = |c: &Value, key: &str| c[key].as_str().unwrap_or_default().to_lowercase();
    let mut found: Vec<(usize, &Value)> = (components(wiki).iter())
        .filter_map(|c| {
            let (name, overview) = (lower(c, "name"), lower(c, "overview"));
            let score = (words.iter())
                .map(|w| 2 * usize::from(name.contains(w)) + usize::from(overview.contains(w)))
                .sum();
            (score > 0).then_some((score, c))
        })
        .collect();
    // Stable: a tie keeps the Wiki's order, a parent before its parts.
    found.sort_by_key(|(score, _)| Reverse(*score));
    json!(found.into_iter().map(|(_, c)| brief(c)).collect::<Vec<_>>())
}

/// The Component `id` of the Wiki `slug` names, with its sub-Components; its
/// files only when it has none, a parent's being its parts'. Its
/// Relationships go both ways: to what it uses, and `from` what uses it,
/// which the Wiki keeps on the user's side.
fn component(slug: &str, wiki: &Value, id: &str) -> Result<Value, String> {
    let all = components(wiki);
    let mut component = (all.iter())
        .find(|c| c["id"] == id)
        .ok_or_else(|| format!("{slug} has no Component {id}: find_component finds them"))?
        .clone();
    let used_by: Vec<Value> = (all.iter())
        .flat_map(|c| {
            (c["relationships"].as_array().into_iter().flatten())
                .filter(|r| r["to"] == id)
                .map(|r| json!({ "from": c["id"], "kind": r["kind"], "description": r["description"] }))
        })
        .collect();
    if let Some(relationships) = component["relationships"].as_array_mut() {
        relationships.extend(used_by);
    }
    let parts: Vec<Value> = (all.iter())
        .filter(|c| c["parent"] == id)
        .map(brief)
        .collect();
    if !parts.is_empty() {
        component.as_object_mut().map(|c| c.remove("files"));
    }
    component["components"] = json!(parts);
    Ok(component)
}

/// A Component as a list of them shows it.
fn brief(c: &Value) -> Value {
    json!({ "id": c["id"], "name": c["name"], "overview": c["overview"] })
}

/// Every Component of `wiki`, a parent before its parts.
fn components(wiki: &Value) -> &[Value] {
    wiki["components"].as_array().map_or(&[], Vec::as_slice)
}

/// What `read_anchor` answers: the lines `arguments` names, as the clone at
/// `clone` holds them at the commit of `wiki`, the Wiki `id` names.
fn anchor(
    ctx: &Context,
    id: &str,
    clone: &str,
    wiki: &Value,
    arguments: &Value,
) -> Result<Value, String> {
    let (file, start, end) = (
        text(arguments, "path")?,
        number(arguments, "start")?,
        number(arguments, "end")?,
    );
    let commit = wiki["commit"].as_str().unwrap_or_default();
    let held = (ctx.world.git_show(clone, commit, file))
        .map_err(|e| e.0)?
        .ok_or_else(|| format!("{file} is not a file of {id} at {commit}"))?;
    let lines: Vec<&str> = held.lines().collect();
    if start > end || end > lines.len() {
        let n = lines.len();
        return Err(format!(
            "lines {start}-{end} are not inside {file} ({n} lines)"
        ));
    }
    let text = lines[start - 1..end].join("\n");
    Ok(json!({ "path": file, "start": start, "end": end, "commit": commit, "text": text }))
}

/// The argument `name`, a string.
fn text<'a>(arguments: &'a Value, name: &str) -> Result<&'a str, String> {
    (arguments[name].as_str()).ok_or_else(|| format!("`{name}` is required, a string"))
}

/// The argument `name`, a line number: 1 or more.
fn number(arguments: &Value, name: &str) -> Result<usize, String> {
    (arguments[name].as_u64())
        .filter(|n| *n >= 1)
        .map(|n| n as usize)
        .ok_or_else(|| format!("`{name}` is required, a line number from 1"))
}
