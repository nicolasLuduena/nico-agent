//! An agent's chat, as its Harness keeps it: `GET
//! /api/agent/<issue>/<role>/transcript`, a stream of its session so far,
//! then of each entry as it lands. Each format is the Harness's own,
//! undocumented and drifting: a line or part this build does not know is
//! left out, never a failure.

use std::time::Duration;

use serde_json::{Value, json};

use crate::cli::{Context, Refusal};
use crate::map;
use crate::review;
use crate::world::{Answer, Transcript, World};

/// How often an open chat looks for what landed.
const EVERY: Duration = Duration::from_secs(1);

/// A quiet stream's comment every this many looks, so a proxy never sees it idle.
const KEEPALIVE: u32 = 15;

/// The Harnesses whose chat is read.
const READ: [&str; 2] = ["claude", "opencode"];

/// How much of a tool call or its result the chat shows.
const CUT: usize = 2000;

/// The chat of `issue`'s agent in `role`, resumed past `after` (`<session>
/// <place>`, the last event's id the page had): a `session` event naming
/// the session first and whenever a newer one replaces it (a Restart's),
/// then `entries` events, each `id` the place to resume past; `missing`,
/// with why, while there is none to read; and for an opencode Implementer,
/// `asking`, what its session waits on the user for, whenever that changes. Refused for an issue with no live
/// Dispatch or a role with no agent.
pub fn stream(
    ctx: &Context,
    issue: &str,
    role: &str,
    after: Option<&str>,
) -> Result<Answer, Refusal> {
    let (config, d, launch) = map::live_agent(ctx, issue, role)?;
    let Some(launch) = launch else {
        let see = map::SEE.into();
        return Err(Refusal::new(format!("{issue} has no {role}"), vec![see]));
    };
    let cwd = match role {
        "implementer" => d.worktree.clone(),
        _ => review::worktree(&d),
    }
    .unwrap_or_default();
    let harness = launch.harness;
    let command = (config.harnesses.get(&harness))
        .and_then(|h| h.command.clone())
        .unwrap_or_else(|| harness.clone());
    let mut at: Option<(String, String)> = (after.and_then(|a| a.split_once(' ')))
        .map(|(session, place)| (session.into(), place.into()));
    let mut shown: Option<String> = None;
    let mut said: Option<String> = None;
    let mut quiet = 0;
    let reads = READ.contains(&harness.as_str());
    // Only an opencode Implementer's asks are answered through its server: claude's are in its transcript.
    let asks = harness == "opencode" && role == "implementer";
    let mut asked: Option<Vec<Value>> = None;
    let poll = move |world: &dyn World| {
        let after = at.as_ref().map(|(s, p)| (s.as_str(), p.as_str()));
        let read = if reads {
            world.harness_transcript(&harness, &command, &cwd, after)
        } else {
            Ok(None)
        };
        let mut sent = String::new();
        match read {
            Ok(Some(Transcript { session, lines })) => {
                said = None;
                if shown.as_ref() != Some(&session) {
                    sent += &event("session", None, json!({ "session": session }));
                    shown = Some(session.clone());
                }
                let from = (at.as_ref())
                    .filter(|(s, _)| *s == session)
                    .map(|(_, place)| place.as_str());
                if let Some((entries, place)) = read_past(&harness, from, &lines) {
                    let id = format!("{session} {place}");
                    sent += &event("entries", Some(&id), json!({ "entries": entries }));
                    at = Some((session.clone(), place));
                }
                // An ask unread this time is left as last said.
                let now = (asks.then(|| world.opencode_asks(&command, &session).ok()))
                    .flatten()
                    .map(|a| asking(&session, &a));
                if now.is_some() && now != asked {
                    sent += &event("asking", None, json!({ "asking": now }));
                    asked = now;
                }
            }
            unread => {
                let why = match unread {
                    Err(e) => e.0,
                    _ if reads => {
                        format!("{harness} keeps no session for {cwd} yet")
                    }
                    _ => format!("{harness} keeps no chat nico-agent reads: see its screen"),
                };
                if said.as_ref() != Some(&why) {
                    sent += &event("missing", None, json!({ "missing": why }));
                    said = Some(why);
                }
            }
        }
        quiet = if sent.is_empty() { quiet + 1 } else { 0 };
        if quiet == KEEPALIVE {
            quiet = 0;
            sent += ": keepalive\n\n";
        }
        sent
    };
    Ok(Answer::Events {
        every: EVERY,
        poll: Box::new(poll),
    })
}

/// One server-sent event.
fn event(name: &str, id: Option<&str>, data: Value) -> String {
    let id = id.map(|id| format!("id: {id}\n")).unwrap_or_default();
    format!("{id}event: {name}\ndata: {data}\n\n")
}

/// The chat entries in `lines`, read past `from` (where the last read
/// ended, none for the session's start), and where this read ends; `None`
/// when it reads nothing whole yet. claude's place is a byte offset, a line
/// not yet ended left for the next read; opencode's is the last message
/// read, a reply still being written left for the next.
fn read_past(harness: &str, from: Option<&str>, lines: &[u8]) -> Option<(Vec<Value>, String)> {
    let parsed = |line: &[u8]| serde_json::from_slice::<Value>(line).unwrap_or_default();
    if harness == "claude" {
        let whole = lines.iter().rposition(|b| *b == b'\n')? + 1;
        let from: usize = from.and_then(|f| f.parse().ok()).unwrap_or(0);
        let entries = (lines[..whole].split(|b| *b == b'\n'))
            .flat_map(|line| claude(&parsed(line)))
            .collect();
        return Some((entries, (from + whole).to_string()));
    }
    let messages: Vec<Value> = (lines.split(|b| *b == b'\n'))
        .filter(|line| !line.is_empty())
        .map(parsed)
        .take_while(|m| m["type"] != "assistant" || !m["time"]["completed"].is_null())
        .collect();
    let last = messages.last()?["id"].as_str()?.to_string();
    Some((messages.iter().flat_map(opencode).collect(), last))
}

/// The entries of one of claude's lines: a turn's text, thinking, tool call
/// or tool result, or a subagent's progress; its token usage on an
/// assistant's.
fn claude(line: &Value) -> Vec<Value> {
    let role = line["type"].as_str().unwrap_or_default();
    if role == "progress" {
        return vec![json!({ "role": "progress", "data": line["data"] })];
    }
    if role != "user" && role != "assistant" {
        return vec![];
    }
    let content = &line["message"]["content"];
    let blocks = match content.as_str() {
        Some(text) => vec![json!({ "type": "text", "text": text })],
        None => content.as_array().cloned().unwrap_or_default(),
    };
    let usage = &line["message"]["usage"];
    (blocks.iter())
        .filter_map(|block| {
            let entry = match block["type"].as_str()? {
                "text" => entry(role, block["text"].as_str()?, usage),
                "thinking" => entry("thinking", block["thinking"].as_str()?, usage),
                "tool_use" => tool(&block["id"], &block["name"], &block["input"], usage),
                "tool_result" => (entry("result", &result(&block["content"]), usage))
                    .map(|e| outcome(e, &block["tool_use_id"], block["is_error"] == true)),
                _ => return None,
            };
            Some(entry)
        })
        .flatten()
        .collect()
}

/// The entries of one of opencode's messages: a user's text, or a reply's
/// reasoning, text and tool calls with their output; its tokens on its last.
fn opencode(message: &Value) -> Vec<Value> {
    let mut entries: Vec<Value> = match message["type"].as_str() {
        Some("user") => entry(
            "user",
            message["text"].as_str().unwrap_or_default(),
            &Value::Null,
        )
        .into_iter()
        .collect(),
        Some("assistant") => (message["content"].as_array().into_iter().flatten())
            .flat_map(|part| match part["type"].as_str() {
                Some("text") => entry(
                    "assistant",
                    part["text"].as_str().unwrap_or_default(),
                    &Value::Null,
                )
                .into_iter()
                .collect(),
                Some("reasoning") => entry(
                    "thinking",
                    part["text"].as_str().unwrap_or_default(),
                    &Value::Null,
                )
                .into_iter()
                .collect(),
                Some("tool") => {
                    let state = &part["state"];
                    let called = tool(&part["id"], &part["name"], &state["input"], &Value::Null);
                    let failed = state["status"] == "error";
                    // opencode 2's result is its text blocks; an older one's, `output`.
                    let done = match state.get("content") {
                        _ if failed => &state["error"]["message"],
                        Some(content) => content,
                        None => &state["output"],
                    };
                    let output = (entry("result", &result(done), &Value::Null))
                        .map(|e| outcome(e, &part["id"], failed));
                    called.into_iter().chain(output).collect()
                }
                _ => vec![],
            })
            .collect(),
        _ => vec![],
    };
    if let Some(last) = entries.last_mut().filter(|_| !message["tokens"].is_null()) {
        last["usage"] = message["tokens"].clone();
    }
    entries
}

/// An entry of the chat, `usage` the tokens of the turn it is in; none for no text.
fn entry(role: &str, text: &str, usage: &Value) -> Option<Value> {
    if text.trim().is_empty() {
        return None;
    }
    let mut entry = json!({ "role": role, "text": text });
    if !usage.is_null() {
        entry["usage"] = usage.clone();
    }
    Some(entry)
}

/// A tool call: as text, its name and its input; its `id` and `name`, and
/// what the chat draws of the tools it knows: a question's `ask` (claude's
/// AskUserQuestion), a to-do list's `todos` (claude's TodoWrite, opencode's
/// todowrite).
fn tool(id: &Value, name: &Value, input: &Value, usage: &Value) -> Option<Value> {
    let mut e = entry("tool", &call(name, input), usage)?;
    e["id"] = id.clone();
    e["name"] = name.clone();
    match name.as_str().unwrap_or_default() {
        "AskUserQuestion" => e["ask"] = ask(id, &input["questions"]),
        "TodoWrite" | "todowrite" => {
            let todos = (input["todos"].as_array().into_iter().flatten())
                .map(|t| json!({ "text": t["content"], "status": t["status"] }))
                .collect::<Vec<_>>();
            e["todos"] = todos.into();
        }
        _ => {}
    }
    Some(e)
}

/// A question as the page asks it: its `id`, its words, and its options,
/// each with the `value` that answers it; none to pick but its first of
/// several questions, or one taking several picks, which the screen answers.
fn ask(id: &Value, questions: &Value) -> Value {
    // shortcut: several questions (or form fields) are answered in the pane; offer each in turn if that proves common.
    let first = &questions[0];
    let one = questions.as_array().map_or(0, Vec::len) == 1
        && first["multiSelect"] != true
        && first["multiple"] != true
        && first["type"] != "multiselect";
    let options = (first["options"].as_array().into_iter().flatten())
        .filter(|_| one)
        .map(|o| {
            let value = o.get("value").unwrap_or(&o["label"]);
            json!({ "label": o["label"], "description": o["description"], "value": value })
        })
        .collect::<Vec<_>>();
    json!({
        "id": id,
        "header": first.get("header").or(first.get("title")),
        "question": first.get("question").or(first.get("description")),
        "options": options,
    })
}

/// A tool's result entry, with the `id` of the call it answers, and `error` when it failed.
fn outcome(mut e: Value, id: &Value, failed: bool) -> Value {
    e["id"] = id.clone();
    if failed {
        e["error"] = true.into();
    }
    e
}

/// What an opencode session waits on the user for, as the page asks it
/// ([`ask`]'s shape): a form's first field, its `field` to reply to, or a
/// permission request with opencode's three replies; each with its `session`.
fn asking(session: &str, asks: &[Value]) -> Vec<Value> {
    (asks.iter())
        .map(|a| {
            let mut asked = if a["id"].as_str().is_some_and(|id| id.starts_with("per")) {
                let resources = (a["resources"].as_array().into_iter().flatten())
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ");
                let said = (a["message"].as_str().map(String::from))
                    .unwrap_or_else(|| format!("{} {resources}", a["action"].as_str().unwrap_or("Allow")));
                let options = [("Allow once", "once"), ("Always allow", "always"), ("Reject", "reject")]
                    .map(|(label, value)| json!({ "label": label, "value": value }));
                json!({ "id": a["id"], "header": "Permission", "question": said.trim(), "options": options })
            } else {
                let fields = a["fields"].as_array().cloned().unwrap_or_default();
                let mut asked = ask(&a["id"], &fields.into());
                asked["field"] = a["fields"][0]["key"].clone();
                asked
            };
            asked["session"] = session.into();
            asked
        })
        .collect()
}

/// A tool call as the chat shows it: the tool's name, then its input as JSON.
fn call(name: &Value, input: &Value) -> String {
    let input = if input.is_null() {
        String::new()
    } else {
        input.to_string()
    };
    cut(format!("{} {input}", name.as_str().unwrap_or("tool")).trim_end())
}

/// A tool's result as text: as is, or its text blocks one after another.
fn result(content: &Value) -> String {
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => (blocks.iter())
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    cut(&text)
}

/// `text` up to [`CUT`] characters, an ellipsis after what is cut.
fn cut(text: impl AsRef<str>) -> String {
    // shortcut: a long result shows its start alone, in its Tool fold too; serve the whole of it when the fold opens, if that falls short.
    let text = text.as_ref();
    match text.char_indices().nth(CUT) {
        Some((i, _)) => format!("{}…", &text[..i]),
        None => text.to_string(),
    }
}
