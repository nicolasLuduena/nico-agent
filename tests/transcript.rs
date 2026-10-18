mod common;

use common::{Setup, github_issue, setup};
use serde_json::{Value, json};

const CHAT: &str = "/api/agent/acme%2Fapi%237/implementer/transcript";
const CLAUDE_TAIL: &str = "$(ls -t ~/.claude/projects/-worktrees-api-7/*.jsonl | head -1)";

/// Repo `acme/api` with issue 7 dispatched by hand on `harness` into
/// `/worktrees/api-7`, the calls so far cleared.
fn dispatched(harness: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    t.cli(&["repo", "add", "acme/api", "--path", "/src/api"]);
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    let ran = t.cli(&["dispatch", "acme/api#7", "--harness", harness]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    t.tick();
    t.world.calls.borrow_mut().clear();
    t
}

/// What the Harness `harness` holds of `session`, its newest for `/worktrees/api-7`.
fn keeps(t: &Setup, harness: &str, session: &str, lines: &[Value]) {
    let text: String = lines.iter().map(|l| format!("{l}\n")).collect();
    (t.world.transcripts.borrow_mut()).insert(
        format!("{harness} /worktrees/api-7"),
        (session.into(), text.into_bytes()),
    );
}

/// `session` appended to, as the Harness writes it.
fn append(t: &Setup, harness: &str, text: &str) {
    let mut held = t.world.transcripts.borrow_mut();
    let (_, bytes) = held
        .get_mut(&format!("{harness} /worktrees/api-7"))
        .unwrap();
    bytes.extend(text.as_bytes());
}

fn session(id: &str) -> String {
    format!("event: session\ndata: {}\n\n", json!({ "session": id }))
}

fn entries(id: &str, entries: Value) -> String {
    format!(
        "id: {id}\nevent: entries\ndata: {}\n\n",
        json!({ "entries": entries })
    )
}

fn missing(why: &str) -> String {
    format!("event: missing\ndata: {}\n\n", json!({ "missing": why }))
}

/// A claude session as it writes one: a prompt, then a turn of thinking, a
/// tool call and its result, a subagent's progress and the answer, with the
/// lines the chat leaves out among them.
fn claude_session() -> Vec<Value> {
    let usage = json!({ "input_tokens": 3, "output_tokens": 9 });
    vec![
        json!({ "type": "user", "message": { "role": "user", "content": "Implement #7" } }),
        json!({ "type": "attachment", "attachment": { "type": "skill_listing" } }),
        json!({ "type": "assistant", "message": { "role": "assistant", "usage": usage,
            "content": [{ "type": "thinking", "thinking": "Read the issue first.", "signature": "x" }] } }),
        json!({ "type": "assistant", "message": { "role": "assistant", "usage": usage,
            "content": [{ "type": "tool_use", "id": "t1", "name": "Bash", "input": { "command": "gh issue view 7" } }] } }),
        json!({ "type": "user", "message": { "role": "user",
            "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "Add a login page" }] } }),
        json!({ "type": "progress", "data": { "type": "agent_progress", "agentId": "a1" } }),
        json!({ "type": "assistant", "message": { "role": "assistant", "usage": usage,
            "content": [{ "type": "text", "text": "I'll add the login page." }] } }),
    ]
}

fn claude_chat() -> Value {
    let usage = json!({ "input_tokens": 3, "output_tokens": 9 });
    json!([
        { "role": "user", "text": "Implement #7" },
        { "role": "thinking", "text": "Read the issue first.", "usage": usage },
        { "role": "tool", "text": "Bash {\"command\":\"gh issue view 7\"}", "usage": usage },
        { "role": "result", "text": "Add a login page" },
        { "role": "progress", "data": { "type": "agent_progress", "agentId": "a1" } },
        { "role": "assistant", "text": "I'll add the login page.", "usage": usage },
    ])
}

/// The bytes `lines` take a line each.
fn length(lines: &[Value]) -> usize {
    lines.iter().map(|l| l.to_string().len() + 1).sum()
}

#[test]
fn a_claude_implementer_s_chat_opens_on_its_session_so_far_then_sends_each_line_once_whole() {
    let t = dispatched("claude");
    let lines = claude_session();
    keeps(&t, "claude", "s1", &lines);
    let at = length(&lines);

    let mut chat = t.stream(CHAT);
    let opened = chat.next();
    let quiet = chat.next();
    append(
        &t,
        "claude",
        "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",",
    );
    let partial = chat.next();
    append(&t, "claude", "\"text\":\"Done.\"}]}}\n");
    let whole = chat.next();

    assert_eq!(chat.every, std::time::Duration::from_secs(1));
    assert_eq!(
        opened,
        session("s1") + &entries(&format!("s1 {at}"), claude_chat())
    );
    assert_eq!((quiet.as_str(), partial.as_str()), ("", ""));
    let last = "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Done.\"}]}}\n";
    assert_eq!(
        whole,
        entries(
            &format!("s1 {}", at + last.len()),
            json!([{ "role": "assistant", "text": "Done." }])
        )
    );
    assert_eq!(
        t.world.calls(),
        [
            format!("tail -c +1 {CLAUDE_TAIL}"),
            format!("tail -c +{} {CLAUDE_TAIL}", at + 1),
            format!("tail -c +{} {CLAUDE_TAIL}", at + 1),
            format!("tail -c +{} {CLAUDE_TAIL}", at + 1),
        ]
    );
}

#[test]
fn a_reconnect_resumes_after_the_last_event_it_had_without_repeating_a_line() {
    let t = dispatched("claude");
    let lines = claude_session();
    keeps(&t, "claude", "s1", &lines[..4]);
    let at = length(&lines[..4]);
    keeps(&t, "claude", "s1", &lines);

    let resumed = t
        .stream_with(CHAT, &[("Last-Event-ID", &format!("s1 {at}"))])
        .next();
    let reopened = t.stream(&format!("{CHAT}?after=s1%20{at}")).next();

    let rest = json!(claude_chat().as_array().unwrap()[3..]);
    let expected = session("s1") + &entries(&format!("s1 {}", length(&lines)), rest);
    assert_eq!((resumed, reopened), (expected.clone(), expected));
    assert_eq!(
        t.world.calls(),
        vec![format!("tail -c +{} {CLAUDE_TAIL}", at + 1); 2]
    );
}

#[test]
fn a_restarted_agent_s_fresh_session_replaces_the_dead_one_s_in_the_chat() {
    let t = dispatched("claude");
    keeps(&t, "claude", "s1", &claude_session());
    let mut chat = t.stream(CHAT);
    chat.next();

    let fresh = [json!({ "type": "user", "message": { "role": "user", "content": "Continue" } })];
    keeps(&t, "claude", "s2", &fresh);
    let replaced = chat.next();

    assert_eq!(
        replaced,
        session("s2")
            + &entries(
                &format!("s2 {}", length(&fresh)),
                json!([{ "role": "user", "text": "Continue" }])
            )
    );
    assert_eq!(t.world.calls()[1], format!("tail -c +1 {CLAUDE_TAIL}"));
}

#[test]
fn a_chat_not_kept_yet_or_unread_says_why_once_till_it_can_be_read() {
    let t = dispatched("claude");

    let mut chat = t.stream(CHAT);
    let none = chat.next();
    let again = chat.next();
    t.world.fail_call("tail", "Permission denied");
    let failed = chat.next();
    t.world.clear_failures();
    keeps(&t, "claude", "s1", &claude_session()[..1]);
    let found = chat.next();

    assert_eq!(
        none,
        missing("claude keeps no session for /worktrees/api-7 yet")
    );
    assert_eq!(again, "");
    assert_eq!(failed, missing("Permission denied"));
    assert_eq!(
        found,
        session("s1")
            + &entries(
                &format!("s1 {}", length(&claude_session()[..1])),
                json!([{ "role": "user", "text": "Implement #7" }])
            )
    );
}

#[test]
fn an_opencode_chat_streams_its_finished_messages_and_resumes_after_the_last_one() {
    let t = dispatched("opencode");
    let tokens = json!({ "input": 12, "output": 5 });
    let user = json!({ "id": "msg_1", "type": "user", "text": "Implement #7" });
    let system = json!({ "id": "msg_2", "type": "system", "text": "The Code Mode tool catalog has changed." });
    let done = json!({ "id": "msg_3", "type": "assistant", "time": { "created": 1, "completed": 2 },
        "tokens": tokens, "content": [
            { "type": "reasoning", "text": "Read the issue." },
            { "type": "tool", "name": "bash", "state": { "status": "completed",
                "input": { "command": "gh issue view 7" }, "output": "Add a login page" } },
            { "type": "text", "text": "Adding it." },
        ] });
    let streaming = json!({ "id": "msg_4", "type": "assistant", "time": { "created": 3 },
        "content": [{ "type": "text", "text": "Half" }] });
    let mut messages = vec![user, system, done, streaming];
    keeps(&t, "opencode", "ses_a", &messages);

    let mut chat = t.stream(CHAT);
    let opened = chat.next();
    messages[3] = json!({ "id": "msg_4", "type": "assistant", "time": { "created": 3, "completed": 4 },
        "content": [{ "type": "text", "text": "Half, then whole." }] });
    keeps(&t, "opencode", "ses_a", &messages);
    let landed = chat.next();

    assert_eq!(
        opened,
        session("ses_a")
            + &entries(
                "ses_a msg_3",
                json!([
                    { "role": "user", "text": "Implement #7" },
                    { "role": "thinking", "text": "Read the issue." },
                    { "role": "tool", "text": "bash {\"command\":\"gh issue view 7\"}" },
                    { "role": "result", "text": "Add a login page" },
                    { "role": "assistant", "text": "Adding it.", "usage": tokens },
                ])
            )
    );
    assert_eq!(
        landed,
        entries(
            "ses_a msg_4",
            json!([{ "role": "assistant", "text": "Half, then whole." }])
        )
    );
    let sessions = "opencode2 api GET /api/session?directory=/worktrees/api-7&parentID=null&order=desc&limit=1";
    assert_eq!(
        t.world.calls(),
        [
            sessions,
            "opencode2 api GET /api/session/ses_a/message?order=asc&limit=100",
            sessions,
            "opencode2 api GET /api/session/ses_a/message?cursor=<next after msg_3>&limit=100",
        ]
    );
}

#[test]
fn a_harness_whose_chat_nico_agent_does_not_read_falls_back_to_its_screen() {
    let t = dispatched("codex");

    let said = t.stream(CHAT).next();

    assert_eq!(
        said,
        missing("codex keeps no chat nico-agent reads: see its screen")
    );
    assert_eq!(t.world.calls(), [] as [&str; 0]);
}

#[test]
fn a_chat_of_an_unknown_role_or_an_issue_with_no_live_dispatch_is_refused_unread() {
    let t = dispatched("claude");

    let unknown = t.get("/api/agent/acme%2Fapi%237/faux-nico/transcript");
    let undispatched = t.get("/api/agent/acme%2Fapi%238/implementer/transcript");
    let no_reviewer = t.get("/api/agent/acme%2Fapi%237/reviewer/transcript");

    let see = json!(["See its agents in `nico-agent status --json`"]);
    assert_eq!(
        unknown,
        (
            400,
            json!({
                "error": "faux-nico is not a role: implementer or reviewer",
                "help": ["Ask for /api/agent/<issue>/implementer or /reviewer"],
            })
        )
    );
    assert_eq!(
        undispatched,
        (
            409,
            json!({ "error": "acme/api#8 has no live Dispatch", "help": see })
        )
    );
    assert_eq!(
        no_reviewer,
        (
            409,
            json!({ "error": "acme/api#7 has no reviewer", "help": see })
        )
    );
    assert_eq!(t.world.calls(), [] as [&str; 0]);
}
