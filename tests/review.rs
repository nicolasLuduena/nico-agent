mod common;

use std::time::Duration;

use common::{
    KIT, KIT_TOML, Ran, Setup, edit_dispatch, github_issue, kit_built, pull_request, setup,
};
use nico_agent::world::{Mergeable, PrState, PullRequest, PullRequestActivity};
use serde_json::{Value, json};

const TICK: Duration = Duration::from_secs(600);

/// The review prompt for PR 9 of issue 7 at `sha`, on codex.
fn review_prompt(sha: &str) -> String {
    format!(
        "herdr agent prompt rev-api-7 $verdict https://github.com/acme/api/pull/9 for https://github.com/acme/api/issues/7: re-run the repo's verification skill under .agents/skills/verify-*/ against the PR's head, saving its Evidence under .evidence/7/, and record the result with nico-agent verdict acme/api#7 pass|fail --sha {sha} --findings <file>"
    )
}

/// Repo `acme/api`, as `toml` sets it, with issue 7 Ready.
fn with_issue(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    t
}

/// `with_issue`, dispatched by a tick.
fn dispatched(toml: &str) -> Setup {
    dispatch(with_issue(toml))
}

/// `t` with issue 7 dispatched by a tick.
fn dispatch(t: Setup) -> Setup {
    assert_eq!(t.tick(), ["acme/api#7 dispatched"]);
    t
}

/// `dispatched`, then PR 9 opened on its branch and seen by the next tick.
fn with_pr(toml: &str) -> Setup {
    pr_opened(dispatched(toml))
}

/// `t` with PR 9 opened on issue 7's branch, a tick later.
fn pr_opened(t: Setup) -> Setup {
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t.world.advance(TICK);
    t
}

/// The Implementer pushes: PR 9's head is now `sha`.
fn push(t: &Setup, sha: &str) {
    pr_is(t, sha, PrState::Open);
}

/// GitHub says PR 9 is at `sha`, and `state`.
fn pr_is(t: &Setup, sha: &str, state: PrState) {
    t.world.activity.borrow_mut().insert(
        "acme/api#9".into(),
        PullRequestActivity {
            state,
            draft: true,
            head_sha: sha.into(),
            base_branch: "main".into(),
            mergeable: Mergeable::Mergeable,
            updated_at: "2026-09-30T12:30:00Z".into(),
            merged_at: (state == PrState::Merged).then(|| "2026-09-30T12:30:00Z".into()),
        },
    );
}

fn calls_after<T>(t: &Setup, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    t.world.calls.borrow_mut().clear();
    let out = run();
    (out, t.world.calls())
}

/// What herdr was told to do: its calls but the Asking step's read of every agent.
fn herdr(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| c.starts_with("herdr ") && *c != "herdr agent list")
        .map(String::as_str)
        .collect()
}

/// herdr reports `rev-api-7` in `state`.
fn reviewer_state(t: &Setup, state: &str) {
    (t.world.agents.borrow_mut()).insert("rev-api-7".into(), state.into());
}

/// `rev-api-7`'s pane shows `screen`.
fn reviewer_screen(t: &Setup, screen: &str) {
    (t.world.screens.borrow_mut()).insert("rev-api-7".into(), screen.into());
}

#[test]
fn a_reviewer_starts_on_another_harness_when_the_pr_first_appears_and_only_then() {
    let t = with_pr("");

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        [
            "acme/api#7: PR https://github.com/acme/api/pull/9 found",
            "acme/api#7: Reviewer started on codex for sha9",
        ]
    );
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p3 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#,
            &review_prompt("sha9"),
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(herdr(&later), Vec::<&str>::new());
    let status = t.cli(&["status", "--json"]).json();
    let reviewer = &status["dispatches"][0]["reviewer"];
    assert_eq!(reviewer["agent"], "rev-api-7");
    assert_eq!(reviewer["harness"], "codex");
    assert_eq!(reviewer["tab"], "w1:t3");
    assert_eq!(reviewer["sha"], "sha9");
}

#[test]
fn a_new_head_waits_for_the_last_reviewer_to_stop_working_then_closes_its_tab_and_starts_it_again()
{
    let t = with_pr("");
    t.tick();
    push(&t, "sha10");
    t.world.advance(TICK);

    let (waited, while_working) = calls_after(&t, || t.tick());
    reviewer_state(&t, "done");
    t.world.advance(TICK);
    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(waited, Vec::<String>::new());
    assert_eq!(herdr(&while_working), Vec::<&str>::new());
    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha10"]);
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p4 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#,
            &review_prompt("sha10"),
        ]
    );
}

#[test]
fn a_reviewer_that_fails_to_start_is_said_and_started_again_next_tick_in_a_fresh_tab() {
    let t = with_pr("");
    t.world
        .fail_call("herdr agent start rev-api-7", "agent_name_taken: rev-api-7");

    let said = t.tick();
    t.world.clear_failures();
    t.world.advance(TICK);
    let (again, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said[1..],
        ["could not start the Reviewer of acme/api#7: agent_name_taken: rev-api-7"]
    );
    assert_eq!(again, ["acme/api#7: Reviewer started on codex for sha9"]);
    assert_eq!(
        herdr(&calls)[..2],
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
        ]
    );
}

#[test]
fn a_reviewer_gone_from_herdr_before_its_verdict_is_started_again_for_that_head_and_not_after_it() {
    let t = with_pr("");
    t.tick();
    t.world.agents.borrow_mut().remove("rev-api-7");
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.agents.borrow_mut().remove("rev-api-7");
    t.world.advance(TICK);
    let (after, _) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha9"]);
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p4 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#,
            &review_prompt("sha9"),
        ]
    );
    assert_eq!(
        after,
        ["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"]
    );
}

#[test]
fn a_reviewer_herdr_calls_stalled_but_reports_working_has_started_and_is_not_prompted_again() {
    let t = with_pr("");
    t.world.lagging_prompts.set(1);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said[1], "acme/api#7: Reviewer started on codex for sha9");
    let prompts = calls.iter().filter(|c| c.starts_with("herdr agent prompt"));
    assert_eq!(prompts.count(), 1);
    let reviewer = &t.cli(&["status", "--json"]).json()["dispatches"][0]["reviewer"];
    assert_eq!(reviewer["sha"], "sha9");
    assert_eq!(reviewer.get("failures"), None);
}

#[test]
fn a_reviewer_prompt_stalled_in_its_input_box_is_sent_again_and_its_start_fails_after_three() {
    let t = with_pr("");
    t.world.stalled_prompts.set(3);
    let prompt = review_prompt("sha9");
    let typed = prompt.trim_start_matches("herdr agent prompt rev-api-7 ");
    reviewer_screen(
        &t,
        &format!("› {typed}\n\n  gpt-6.1-sol medium · /worktrees/api-7"),
    );

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said[1..],
        [
            "could not start the Reviewer of acme/api#7: rev-api-7 did not start working on its prompt"
        ]
    );
    let tail: Vec<&str> = (calls.iter().map(String::as_str))
        .skip_while(|c| *c != prompt)
        .collect();
    let looked = [
        &*prompt,
        "herdr agent list",
        "herdr agent read rev-api-7 --source visible",
    ];
    assert_eq!(tail, looked.repeat(3));
    let reviewer = &t.cli(&["status", "--json"]).json()["dispatches"][0]["reviewer"];
    assert_eq!(reviewer["sha"], Value::Null);
    assert_eq!(reviewer["failures"], json!(["sha9"]));
}

/// codex's hooks review, as the reproduction of #279 saw it after one prompt.
const HOOKS_REVIEW: &str = "  Hooks\n  Lifecycle hooks from config and enabled plugins.\n\n  ⚠ 6 hooks need review before they can run.\n\n  Event                 Installed   Active      Review      Description\n› PostToolUse           1           0           1           After a tool executes\n\n  t trust all · enter review · esc close";

#[test]
fn a_reviewer_on_codexs_hooks_review_is_asking_a_question_and_is_sent_nothing_more() {
    let t = with_pr("");
    t.world.stalled_prompts.set(3);
    reviewer_screen(&t, HOOKS_REVIEW);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said[1..],
        [
            "could not start the Reviewer of acme/api#7: rev-api-7 is asking a question during startup"
        ]
    );
    let prompt = review_prompt("sha9");
    let tail: Vec<&str> = (calls.iter().map(String::as_str))
        .skip_while(|c| *c != prompt)
        .collect();
    assert_eq!(
        tail,
        [
            &*prompt,
            "herdr agent list",
            "herdr agent read rev-api-7 --source visible",
        ]
    );
    let reviewer = &t.cli(&["status", "--json"]).json()["dispatches"][0]["reviewer"];
    assert_eq!(reviewer["failures"], json!(["sha9"]));
}

#[test]
fn a_reviewer_whose_start_failed_but_works_after_all_is_not_closed_until_it_stops_working() {
    let t = with_pr("");
    t.world.stalled_prompts.set(3);
    t.tick();
    // The user answers its screen and sends the prompt by hand.
    reviewer_state(&t, "working");
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    reviewer_state(&t, "idle");
    t.world.advance(TICK);
    let (after, later) = calls_after(&t, || t.tick());

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(herdr(&calls), Vec::<&str>::new());
    assert_eq!(after, ["acme/api#7: Reviewer started on codex for sha9"]);
    assert_eq!(herdr(&later)[0], "herdr tab close w1:t3");
}

#[test]
fn a_reviewer_of_a_repo_linking_a_built_library_version_starts_with_its_wiki_mcp_and_asks_it_first()
{
    let t = with_issue(&format!("libraries = [{KIT_TOML}]"));
    kit_built(&t);
    let t = pr_opened(dispatch(t));

    let (_, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        herdr(&calls)[1..],
        [
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p3 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review" -c mcp_servers.wiki.command="nico-agent" -c mcp_servers.wiki.args=["mcp","--wiki","acme/kit@v1"] -c mcp_servers.wiki.default_tools_approval_mode="approve""#.to_string(),
            format!(
                "{} Ask the wiki MCP about {KIT} before reading their source.",
                review_prompt("sha9")
            ),
        ]
    );
}

#[test]
fn with_review_off_no_reviewer_starts() {
    let t = with_pr("switches = { review = false }");

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        ["acme/api#7: PR https://github.com/acme/api/pull/9 found"]
    );
    assert_eq!(herdr(&calls), Vec::<&str>::new());
}

/// `with_pr`, its PR found and its Reviewer started.
fn reviewing() -> Setup {
    let t = with_pr("");
    t.tick();
    t
}

/// Record a Verdict, as the Reviewer does last: its turn then ends.
fn verdict(t: &Setup, args: &[&str]) -> Ran {
    let ran = t.cli(&[&["verdict"], args, &["--json"]].concat());
    if let Some(state) = t.world.agents.borrow_mut().get_mut("rev-api-7") {
        *state = "done".into();
    }
    ran
}

fn stage(t: &Setup) -> Value {
    t.cli(&["status", "--json"]).json()["dispatches"][0]["stage"].clone()
}

#[test]
fn a_passing_verdict_on_the_head_makes_the_dispatch_verified_until_the_pr_moves() {
    let t = reviewing();

    let ran = verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let verified = t.cli(&["status", "--json"]).json()["dispatches"][0].clone();
    push(&t, "sha10");
    t.world.advance(TICK);
    let said = t.tick();

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(
        ran.json(),
        json!({ "verdict": "acme/api#7 pass at sha9", "stage": "Verified" })
    );
    assert_eq!(verified["stage"], "Verified");
    assert_eq!(
        verified["verdict"],
        json!({ "result": "pass", "sha": "sha9", "at": "2026-09-30T12:10:00Z", "findings": null })
    );
    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha10"]);
    assert_eq!(stage(&t), "PR draft");
}

/// The calls among `calls` about a PR.
fn pr_calls(calls: &[String]) -> Vec<&str> {
    (calls.iter())
        .filter(|c| c.starts_with("github pr "))
        .map(String::as_str)
        .collect()
}

#[test]
fn a_passing_verdict_flips_the_draft_pr_to_ready_once_and_nothing_else_is_written_to_it() {
    let t = reviewing();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        said,
        ["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"]
    );
    // No merge, approval or comment: the flip is the one write.
    assert_eq!(
        pr_calls(&calls),
        [
            "github pr activity acme/api#9",
            "github pr ready acme/api#9"
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(pr_calls(&later), ["github pr activity acme/api#9"]);
    let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
    assert_eq!(
        (&shown["stage"], &shown["pr"]["draft"]),
        (&json!("Verified"), &json!(false))
    );
}

#[test]
fn an_answer_kept_while_the_pr_is_flipped_survives_the_flip() {
    let t = reviewing();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);
    let answer = json!({
        "since": "2026-09-30T12:05:00Z", "at": "2026-09-30T12:25:00Z",
        "question": "Which database?", "text": "Postgres", "by": "user",
    });
    let (dir, kept) = (t.config_dir.clone(), answer.clone());
    t.world.during_call("github pr ready acme/api#9", move || {
        edit_dispatch(&dir, |d| d["answers"] = json!([kept]))
    });

    t.tick();

    let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
    assert_eq!(
        (&shown["answers"], &shown["flipped"]),
        (&json!([answer]), &json!("sha9"))
    );
}

#[test]
fn a_pr_put_back_to_draft_by_hand_is_not_flipped_again_for_the_same_verdict() {
    let t = reviewing();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);
    let flipped = t.tick();
    // The user converts it back to draft.
    t.world.readied.borrow_mut().clear();
    t.world.advance(TICK);

    let (again, calls) = calls_after(&t, || t.tick());
    push(&t, "sha10");
    t.world.advance(TICK);
    t.tick();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha10"]);
    t.world.advance(TICK);
    let new_verdict = t.tick();

    let ready = ["acme/api#7: PR https://github.com/acme/api/pull/9 flipped to ready"];
    assert_eq!(flipped, ready);
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(pr_calls(&calls), ["github pr activity acme/api#9"]);
    assert_eq!(new_verdict, ready);
}

#[test]
fn with_flip_off_a_verified_pr_stays_draft_and_status_says_so() {
    let t = with_pr("switches = { flip = false }");
    t.tick();
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, Vec::<String>::new());
    assert_eq!(pr_calls(&calls), ["github pr activity acme/api#9"]);
    let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
    assert_eq!(
        (&shown["stage"], &shown["pr"]["draft"]),
        (&json!("Verified"), &json!(true))
    );
    assert_eq!(
        shown["warnings"],
        json!([
            "flip is off for acme/api, so its Verified PR stays draft; mark it ready by hand, or turn on repos.\"acme/api\".switches.flip"
        ])
    );
}

/// A findings file the Reviewer wrote, outside the config directory.
fn findings(t: &Setup, text: &str) -> String {
    let file = t.config_dir.with_file_name("findings.md");
    std::fs::write(&file, text).unwrap();
    file.display().to_string()
}

/// The default `[prompts.restart] rulings` after a failing Verdict at `sha` on issue 7.
fn rulings(sha: &str) -> String {
    format!(
        " Before you push, rule on each Finding, numbered F1, F2 and on as the findings number them, else in the order they list them: fixed, with the commit that fixes it, or dismissed, with why (what the issue, a feature file or PRODUCT.md says that the Finding misreads); a Finding saying an earlier dismissal does not hold is ruled on again. Append the Rulings to .evidence/7/rulings.md as a new section, never rewriting an earlier one, the file headed `# Rulings: acme/api#7`: `## Findings at {sha}`, then a line per Finding, `- **F1** \"<its title>\": fixed in <commit sha>` or `- **F2** \"<its title>\": dismissed. <why>`. Once pushed, add or update a `## Findings` section right after `## Evidence` in the PR body, one line counting every section of rulings.md: `<N> fixed, <M> dismissed over <R> rounds: [Rulings](http://127.0.0.1:42069/bucket/acme/api/7/)`."
    )
}

fn verdict_file(t: &Setup) -> Value {
    let file = t.config_dir.join("verdicts/acme/api#7.json");
    serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
}

#[test]
fn a_failing_verdict_keeps_its_findings_restarts_the_implementer_once_and_no_reviewer_starts_on_that_head()
 {
    let t = reviewing();
    let file = findings(&t, "Signing in shows a 500.\n");

    let ran = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    t.world.advance(TICK);
    let (said, calls) = calls_after(&t, || t.tick());
    t.world.advance(TICK);
    let (again, later) = calls_after(&t, || t.tick());

    assert_eq!(
        ran.json(),
        json!({ "verdict": "acme/api#7 fail at sha9", "stage": "PR draft" })
    );
    assert_eq!(
        verdict_file(&t),
        json!({ "result": "fail", "sha": "sha9", "at": "2026-09-30T12:10:00Z", "findings": "Signing in shows a 500.\n" })
    );
    assert_eq!(said, ["acme/api#7 restarted: verdict"]);
    let findings_path = t.config_dir.join("verdicts/acme/api#7.json");
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t2",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label implementer --no-focus",
            "herdr agent start impl-api-7 --kind claude --pane w1:p4 -- ",
            &format!(
                "herdr agent prompt impl-api-7 You are continuing https://github.com/acme/api/issues/7 on branch agent/api-7 in this worktree. Read git status, git log and the PR https://github.com/acme/api/pull/9 first. The Reviewer failed the PR at sha9. Its findings are in {}. Address each, run the verification, push.{}",
                findings_path.display(),
                rulings("sha9")
            ),
        ]
    );
    assert_eq!(again, Vec::<String>::new());
    assert_eq!(herdr(&later), Vec::<&str>::new());
}

#[test]
fn a_failing_verdict_on_a_head_pushed_over_before_the_tick_restarts_nothing_and_a_reviewer_starts_for_the_new_head()
 {
    let t = reviewing();
    let file = findings(&t, "Signing in shows a 500.\n");
    verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    push(&t, "sha10");
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha10"]);
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t3",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p4 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#,
            &review_prompt("sha10"),
        ]
    );
    assert_eq!(stage(&t), "PR draft");
}

/// Three failing Verdicts on `t`, each on the head the Implementer pushed
/// after the last with its Rulings in its Evidence, a tick after each Verdict
/// and push: what the ticks said. The third marks the Dispatch Failed.
fn failed_by_the_reviewer(t: &Setup) -> Vec<String> {
    let file = findings(t, "Signing in shows a 500.\n");
    let mut said = vec![];
    for (head, next) in [("sha9", "sha10"), ("sha10", "sha11"), ("sha11", "sha12")] {
        verdict(
            t,
            &["acme/api#7", "fail", "--sha", head, "--findings", &file],
        );
        t.world.advance(TICK);
        said.extend(t.tick());
        // The Implementer rules on the Findings and pushes, and the next tick sees it.
        let ruled =
            format!("## Findings at {head}\n\n- **F1** \"Signing in shows a 500\": dismissed.\n");
        t.world
            .add_file("/worktrees/api-7/.evidence/7/rulings.md", ruled.as_bytes());
        push(t, next);
        t.world.advance(TICK);
        said.extend(t.tick());
    }
    said
}

#[test]
fn a_third_failing_verdict_marks_the_dispatch_failed_notifies_once_and_starts_no_reviewer_after() {
    let t = reviewing();

    let said = failed_by_the_reviewer(&t);

    assert_eq!(
        said,
        [
            "acme/api#7 restarted: verdict",
            "acme/api#7: Evidence at sha10 kept in the Bucket",
            "acme/api#7: Reviewer started on codex for sha10",
            "acme/api#7 restarted: verdict",
            "acme/api#7: Evidence at sha11 kept in the Bucket",
            "acme/api#7: Reviewer started on codex for sha11",
            "acme/api#7 Failed: verdict again after 2 restarts for it",
            "acme/api#7: Evidence at sha12 kept in the Bucket",
        ]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#7 Failed".to_string(),
            "restart: verdict again after 2 restarts for it".to_string()
        )]
    );
    assert_eq!(stage(&t), "Failed");
}

#[test]
fn a_dispatch_the_reviewer_kept_failing_says_so_in_api_status_with_its_findings_and_rulings_in_its_evidence()
 {
    let t = reviewing();
    failed_by_the_reviewer(&t);

    let (_, status) = t.get("/api/status");
    let (_, node) = t.get("/api/node/acme%2Fapi%237");

    let failed = &status["dispatches"][0];
    assert_eq!(
        failed["failure"],
        json!({ "step": "restart", "error": "verdict again after 2 restarts for it", "reason": "verdict" })
    );
    let reasons = (failed["restarts"].as_array().unwrap().iter()).map(|r| &r["reason"]);
    assert_eq!(reasons.collect::<Vec<_>>(), ["verdict", "verdict"]);
    let kept = (node["evidence"].as_array().unwrap().iter())
        .filter_map(|e| e["path"].as_str()?.strip_prefix("sha11/"));
    assert_eq!(kept.collect::<Vec<_>>(), ["findings.md", "rulings.md"]);
}

#[test]
fn a_dispatch_the_reviewer_kept_failing_closes_once_its_pr_is_merged_or_closed_on_github() {
    for (state, said) in [(PrState::Merged, "merged"), (PrState::Closed, "closed")] {
        let t = reviewing();
        failed_by_the_reviewer(&t);
        pr_is(&t, "sha12", state);
        t.world.advance(TICK);

        let ticked = t.tick();

        assert!(
            ticked.contains(&format!(
                "acme/api#7 Closed: its PR https://github.com/acme/api/pull/9 {said}"
            )),
            "{ticked:?}"
        );
        let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
        assert!(shown["closed_at"].is_string(), "{shown}");
    }
}

#[test]
fn a_failing_verdict_whose_findings_are_all_dismissed_gets_a_reviewer_on_the_same_head_and_a_second_fail_marks_it_failed()
 {
    let t = reviewing();
    let file = findings(&t, "Signing in shows a 500.\n");
    verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    // Idle since its last push: as listed before its restart, it has ruled on nothing yet.
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "idle".into());
    t.world.advance(TICK);
    assert_eq!(t.tick(), ["acme/api#7 restarted: verdict"]);
    // Every Finding dismissed: the Rulings are in .evidence/, which git ignores, so nothing is pushed.
    (t.world.agents.borrow_mut()).insert("impl-api-7".into(), "idle".into());
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());
    let shown = review(&t);
    t.world.advance(TICK);
    let still = t.tick();
    let again = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    t.world.advance(TICK);
    let failed = t.tick();

    assert_eq!(said, ["acme/api#7: Reviewer started on codex for sha9"]);
    assert_eq!(herdr(&calls).last().unwrap(), &review_prompt("sha9"));
    assert_eq!(shown["state"], "reviewing");
    assert_eq!(still, Vec::<String>::new());
    assert_eq!(again.json()["verdict"], "acme/api#7 fail at sha9");
    assert_eq!(
        failed,
        ["acme/api#7 Failed: verdict again at sha9 after its Rulings"]
    );
    assert_eq!(
        *t.world.notifications.borrow(),
        [(
            "acme/api#7 Failed".to_string(),
            "restart: verdict again at sha9 after its Rulings".to_string()
        )]
    );
    assert_eq!(stage(&t), "Failed");
}

#[test]
fn a_config_holding_its_own_restart_prompts_without_rulings_still_sends_the_default_rulings() {
    // As this install's config.toml holds them: every key [prompts.restart] had before rulings.
    let own = r#"
[prompts.restart]
prefix = "You are continuing {issueUrl} on branch {branch} in this worktree. Read git status, git log and the PR {prUrl} first."
rebooted = "The machine restarted. Continue where the branch left off."
stalled = "You stopped with no PR open. Continue to a draft PR."
conflict = "The PR conflicts with {baseBranch}. Rebase onto it, resolve, run the tests and the verification, push."
retarget = "The PR below yours merged. Retarget the PR onto {baseBranch}, rebase, push."
verdict = "The Reviewer failed {prUrl} at {sha}: read {findingsPath}."
"#;
    let t = with_pr(own);
    t.tick();
    let file = findings(&t, "Signing in shows a 500.\n");
    verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    t.world.advance(TICK);

    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(said, ["acme/api#7 restarted: verdict"]);
    let findings_path = t.config_dir.join("verdicts/acme/api#7.json");
    assert_eq!(
        herdr(&calls).last().unwrap(),
        &format!(
            "herdr agent prompt impl-api-7 You are continuing https://github.com/acme/api/issues/7 on branch agent/api-7 in this worktree. Read git status, git log and the PR https://github.com/acme/api/pull/9 first. The Reviewer failed https://github.com/acme/api/pull/9 at sha9: read {}.{}",
            findings_path.display(),
            rulings("sha9")
        )
    );
}

#[test]
fn the_same_verdict_again_is_a_no_op_and_a_changed_one_replaces_it() {
    let t = reviewing();
    let file = findings(&t, "The search box is gone.\n");
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    t.world.advance(Duration::from_secs(60));

    let again = verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let kept = verdict_file(&t);
    let changed = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );

    assert_eq!(again.exit_code, 0, "{}", again.stdout);
    assert_eq!(
        again.json(),
        json!({ "verdict": "acme/api#7 pass at sha9 already recorded (no-op)", "stage": "Verified" })
    );
    assert_eq!(kept["at"], "2026-09-30T12:10:00Z");
    assert_eq!(changed.json()["stage"], "PR draft");
    assert_eq!(verdict_file(&t)["result"], "fail");
    assert_eq!(verdict_file(&t)["at"], "2026-09-30T12:11:00Z");
}

#[test]
fn with_review_off_a_verdict_still_records_and_once_on_its_head_gets_no_reviewer() {
    let t = with_pr("switches = { review = false }");
    t.tick();
    let file = findings(&t, "The search box is gone.\n");

    let ran = verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    // Restart off: the failing Verdict's own restart is not what this is about.
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\nswitches = { restart = false }\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.advance(TICK);
    let (said, calls) = calls_after(&t, || t.tick());

    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    assert_eq!(verdict_file(&t)["result"], "fail");
    assert_eq!(said, Vec::<String>::new());
    assert_eq!(herdr(&calls), Vec::<&str>::new());
}

#[test]
fn a_reviewer_that_keeps_leaving_herdr_is_started_again_up_to_the_cap_per_head_then_told_once() {
    let t = reviewing();
    let gone = |t: &Setup| {
        t.world.agents.borrow_mut().remove("rev-api-7");
        t.world.advance(TICK);
        t.tick()
    };

    let said: Vec<Vec<String>> = (0..4).map(|_| gone(&t)).collect();
    push(&t, "sha10");
    let new_head = gone(&t);

    let started = vec!["acme/api#7: Reviewer started on codex for sha9"];
    assert_eq!(said, [started.clone(), started, vec![STOPPED], vec![],]);
    assert_eq!(*t.world.notifications.borrow(), [told()]);
    assert_eq!(
        new_head,
        ["acme/api#7: Reviewer started on codex for sha10"]
    );
}

const STOPPED: &str = "acme/api#7: its Reviewer for sha9 failed to start or left herdr before a Verdict 3 times; not started again for it";

/// The one notification that acme/api#7's Reviewer is not started again for sha9.
fn told() -> (String, String) {
    (
        "acme/api#7 Reviewer stopped".into(),
        "Its Reviewer for sha9 failed to start or left herdr before a Verdict 3 times. Review the PR by hand and record it with `nico-agent verdict acme/api#7 pass|fail --sha sha9`.".into(),
    )
}

#[test]
fn a_reviewer_that_cannot_start_is_tried_up_to_the_cap_per_head_then_told_once() {
    let t = with_pr("");
    let broken = "agent_start_failed: codex is not installed";
    t.world.fail_call("herdr agent start rev-api-7", broken);

    let said: Vec<Vec<String>> = (0..5)
        .map(|_| {
            let said = t.tick();
            t.world.advance(TICK);
            said
        })
        .collect();

    let failed = format!("could not start the Reviewer of acme/api#7: {broken}");
    assert_eq!(
        said,
        [
            vec![
                "acme/api#7: PR https://github.com/acme/api/pull/9 found".to_string(),
                failed.clone(),
            ],
            vec![failed.clone()],
            vec![failed, STOPPED.into()],
            vec![],
            vec![],
        ]
    );
    assert_eq!(*t.world.notifications.borrow(), [told()]);
}

#[test]
fn a_reviewer_on_the_implementers_harness_starts_there_with_a_warning_in_status() {
    let t = with_pr("reviewer = { harness = \"claude\", model = \"opus\" }");
    let other = with_pr("");

    let said = t.tick();

    assert_eq!(said[1], "acme/api#7: Reviewer started on claude for sha9");
    assert!(
        (t.world.calls().iter())
            .any(|c| c == "herdr agent start rev-api-7 --kind claude --pane w1:p3 -- --model opus"),
        "{:?}",
        t.world.calls()
    );
    let repo = t.cli(&["status", "--json"]).json()["repos"][0].clone();
    assert_eq!(
        repo["warnings"],
        json!([
            "acme/api's Reviewer runs on claude, as its Implementer does, so it may share its blind spots; set another Harness in repos.\"acme/api\".reviewer"
        ])
    );
    let repo = other.cli(&["status", "--json"]).json()["repos"][0].clone();
    assert_eq!(repo.get("warnings"), None);
}

/// Repo `acme/api`, as `toml` sets it, with issue 7 dispatched by hand on
/// codex and its PR 9 opened since.
fn dispatched_on_codex(toml: &str) -> Setup {
    let t = setup();
    t.world
        .add_clone("/src/api", &["git@github.com:acme/api.git"]);
    std::fs::create_dir_all(&t.config_dir).unwrap();
    let config = format!("[repos.\"acme/api\"]\npath = \"/src/api\"\n{toml}\n");
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();
    t.world.add_issue("acme/api", github_issue("acme/api", 7));
    let ran = t.cli(&["dispatch", "acme/api#7", "--harness", "codex"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
    t.world.add_pr(PullRequest {
        head_branch: Some("agent/api-7".into()),
        ..pull_request("acme/api", 9)
    });
    t
}

#[test]
fn the_reviewer_runs_on_a_harness_other_than_the_one_its_dispatchs_implementer_runs_on() {
    let t = dispatched_on_codex("");

    let said = t.tick();

    assert_eq!(
        said,
        [
            "acme/api#7: PR https://github.com/acme/api/pull/9 found",
            "acme/api#7: Reviewer started on claude for sha9",
        ]
    );
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["dispatches"][0]["warnings"], json!([]));
}

#[test]
fn a_dispatch_whose_reviewer_runs_on_its_own_implementers_harness_is_warned_of_in_status() {
    let t = dispatched_on_codex("reviewer = { harness = \"codex\" }");

    let said = t.tick();

    assert_eq!(said[1], "acme/api#7: Reviewer started on codex for sha9");
    let status = t.cli(&["status", "--json"]).json();
    assert_eq!(status["repos"][0].get("warnings"), None);
    assert_eq!(
        status["dispatches"][0]["warnings"],
        json!([
            "acme/api#7's Reviewer runs on codex, as its Implementer does, so it may share its blind spots; set another Harness in repos.\"acme/api\".reviewer"
        ])
    );
}

const USAGE: &str = "Run `nico-agent verdict <issue> pass|fail --sha <sha> [--findings <file>]` to record the Reviewer's Verdict on the head of the issue's PR";

#[test]
fn a_verdict_on_no_live_dispatch_no_open_pr_or_a_head_the_pr_moved_from_is_refused() {
    let t = dispatched("");
    t.world.add_issue("acme/api", github_issue("acme/api", 8));
    let see = "Run `nico-agent status` to see the Dispatch";
    let no_pr = verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let t = reviewing();
    let gone = findings(&t, "x").replace("findings.md", "nowhere.md");
    let cases = [
        (
            vec!["acme/api#8", "pass", "--sha", "sha9"],
            json!({
                "error": "acme/api#8 has no live Dispatch",
                "help": ["A Verdict is on the PR of an issue In flight", see],
            }),
        ),
        (
            vec!["acme/api#7", "pass", "--sha", "sha8"],
            json!({
                "error": "sha8 is not the head of https://github.com/acme/api/pull/9",
                "help": ["The PR moved to sha9: verify that head and run `nico-agent verdict acme/api#7 pass|fail --sha sha9`"],
            }),
        ),
        (
            vec!["acme/api#7", "fail", "--sha", "sha9", "--findings", &gone],
            json!({
                "error": format!("could not read the findings in {gone}: No such file or directory (os error 2)"),
                "help": ["Pass --findings the file the findings are written in"],
            }),
        ),
    ];

    assert_eq!(no_pr.exit_code, 1);
    assert_eq!(
        no_pr.json(),
        json!({
            "error": "acme/api#7 has no open PR",
            "help": ["A Verdict is on the head of an open PR", see],
        })
    );
    for (args, refused) in cases {
        let ran = verdict(&t, &args);
        assert_eq!((ran.exit_code, ran.json()), (1, refused), "{args:?}");
    }
    assert!(!t.config_dir.join("verdicts").exists());
}

#[test]
fn a_fail_without_findings_or_a_verdict_not_pass_or_fail_or_without_sha_is_a_bad_invocation() {
    let t = reviewing();
    let cases = [
        (
            vec!["acme/api#7", "fail", "--sha", "sha9"],
            "a failing Verdict needs --findings <file>",
        ),
        (
            vec!["acme/api#7", "maybe", "--sha", "sha9"],
            "`maybe` is not a Verdict: pass or fail",
        ),
        (vec!["acme/api#7", "pass"], "--sha is required"),
        (vec!["acme/api#7", "--sha", "sha9"], "pass|fail is required"),
    ];

    for (args, error) in cases {
        let ran = verdict(&t, &args);
        assert_eq!(
            (ran.exit_code, ran.json()),
            (2, json!({ "error": error, "help": [USAGE] })),
            "{args:?}"
        );
    }
}

/// Where the review of the first Dispatch's PR stands, as `status --json` shows it.
fn review(t: &Setup) -> Value {
    t.cli(&["status", "--json"]).json()["dispatches"][0]["review"].clone()
}

#[test]
fn a_reviewer_working_on_the_head_shows_the_review_as_reviewing_on_its_harness() {
    let t = reviewing();

    assert_eq!(
        review(&t),
        json!({ "state": "reviewing", "sha": "sha9", "harness": "codex", "attempts": 0, "cap": 2 })
    );
}

#[test]
fn a_reviewer_that_went_idle_on_the_head_without_a_verdict_shows_as_stopped_on_the_page() {
    let t = reviewing();
    t.world
        .agents
        .borrow_mut()
        .insert("rev-api-7".into(), "idle".into());

    let (status, page) = t.get("/api/status");

    let stopped =
        json!({ "state": "stopped", "sha": "sha9", "harness": "codex", "attempts": 0, "cap": 2 });
    assert_eq!(review(&t), stopped);
    assert_eq!((status, &page["dispatches"][0]["review"]), (200, &stopped));
}

#[test]
fn a_passing_verdict_on_the_head_shows_the_review_as_passed() {
    let t = reviewing();

    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);

    assert_eq!(
        review(&t),
        json!({ "state": "passed", "sha": "sha9", "harness": "codex", "attempts": 0, "cap": 2 })
    );
}

#[test]
fn a_failing_verdict_on_the_head_shows_the_review_as_failed_while_its_reviewer_still_works() {
    let t = reviewing();
    let file = findings(&t, "Signing in shows a 500.\n");

    verdict(
        &t,
        &["acme/api#7", "fail", "--sha", "sha9", "--findings", &file],
    );
    reviewer_state(&t, "working");

    let shown = &t.cli(&["status", "--json"]).json()["dispatches"][0];
    assert_eq!(shown["agent_state"]["reviewer"], "working");
    assert_eq!(shown["review"]["state"], "failed");
}

#[test]
fn a_reviewer_that_failed_to_start_within_the_cap_shows_the_review_as_retrying_with_its_attempts() {
    let t = with_pr("");
    t.world
        .fail_call("herdr agent start rev-api-7", "agent_name_taken: rev-api-7");

    t.tick();
    let once = review(&t);
    t.world.advance(TICK);
    t.tick();

    assert_eq!(
        once,
        json!({ "state": "retrying", "sha": "sha9", "harness": "codex", "attempts": 1, "cap": 2 })
    );
    assert_eq!(review(&t)["attempts"], 2);
    assert_eq!(review(&t)["state"], "retrying");
}

#[test]
fn a_reviewer_that_failed_to_start_past_the_cap_shows_the_review_as_given_up_on_the_page() {
    let t = with_pr("");
    t.world
        .fail_call("herdr agent start rev-api-7", "agent_name_taken: rev-api-7");

    for _ in 0..3 {
        t.tick();
        t.world.advance(TICK);
    }

    let gave_up =
        json!({ "state": "gave_up", "sha": "sha9", "harness": "codex", "attempts": 3, "cap": 2 });
    assert_eq!(review(&t), gave_up);
    assert_eq!(t.get("/api/status").1["dispatches"][0]["review"], gave_up);
    assert_eq!(t.get("/api/node/acme%2Fapi%237").1["review"], gave_up);
    assert_eq!(t.get("/api/map/acme/api").1["nodes"][0]["review"], gave_up);
}

#[test]
fn with_review_off_the_review_shows_as_off_even_with_a_verdict_on_the_head() {
    let t = with_pr("switches = { review = false }");
    t.tick();

    let before = review(&t);
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);

    assert_eq!(
        before,
        json!({ "state": "off", "sha": "sha9", "harness": null, "attempts": 0, "cap": 2 })
    );
    assert_eq!(review(&t)["state"], "off");
}

#[test]
fn a_review_switched_on_after_the_pr_appeared_shows_as_waiting_for_the_next_tick() {
    let t = with_pr("switches = { review = false }");
    t.tick();
    let config = "[repos.\"acme/api\"]\npath = \"/src/api\"\n";
    std::fs::write(t.config_dir.join("config.toml"), config).unwrap();

    let waiting = review(&t);
    t.world.advance(TICK);
    t.tick();

    assert_eq!(
        waiting,
        json!({ "state": "waiting", "sha": "sha9", "harness": null, "attempts": 0, "cap": 2 })
    );
    assert_eq!(review(&t)["state"], "reviewing");
}

#[test]
fn a_reviewer_gone_from_herdr_before_its_verdict_counts_as_an_attempt_before_the_tick_starts_another()
 {
    let t = reviewing();
    t.world.agents.borrow_mut().remove("rev-api-7");

    let gone = review(&t);
    t.world.advance(TICK);
    t.tick();

    assert_eq!(
        gone,
        json!({ "state": "retrying", "sha": "sha9", "harness": "codex", "attempts": 1, "cap": 2 })
    );
    assert_eq!(
        review(&t),
        json!({ "state": "reviewing", "sha": "sha9", "harness": "codex", "attempts": 1, "cap": 2 })
    );
}

#[test]
fn a_reviewer_gone_from_herdr_at_the_cap_shows_as_given_up_before_and_after_the_tick_and_with_herdr_down()
 {
    let t = reviewing();
    for _ in 0..2 {
        t.world.agents.borrow_mut().remove("rev-api-7");
        t.world.advance(TICK);
        t.tick();
    }
    t.world.agents.borrow_mut().remove("rev-api-7");

    let before = review(&t);
    t.world.advance(TICK);
    let said = t.tick();
    let after = review(&t);
    t.world
        .fail_call("herdr agent list", "herdr_unreachable: herdr is down");
    let herdr_down = review(&t);

    let gave_up =
        json!({ "state": "gave_up", "sha": "sha9", "harness": "codex", "attempts": 3, "cap": 2 });
    assert_eq!(said, [STOPPED]);
    assert_eq!(
        (before, after, herdr_down),
        (gave_up.clone(), gave_up.clone(), gave_up)
    );
}

/// `POST /api/review` of acme/api#7, as the panel's "Review now" sends it.
fn review_now(t: &Setup) -> (u16, Value) {
    t.send("POST", "/api/review", r#"{"issue": "acme/api#7"}"#)
}

/// `with_pr`, its Reviewer failing to start until the tick gave up on sha9.
fn gave_up() -> Setup {
    let t = with_pr("");
    let broken = "agent_start_failed: codex is not installed";
    t.world.fail_call("herdr agent start rev-api-7", broken);
    for _ in 0..3 {
        t.tick();
        t.world.advance(TICK);
    }
    t.world.clear_failures();
    t
}

#[test]
fn review_now_starts_a_reviewer_on_a_head_given_up_on_and_the_tick_may_try_the_whole_cap_again() {
    let t = gave_up();

    let (now, calls) = calls_after(&t, || review_now(&t));
    let shown = review(&t);
    let reviewer = t.cli(&["status", "--json"]).json()["dispatches"][0]["reviewer"].clone();
    let gone = |t: &Setup| {
        t.world.agents.borrow_mut().remove("rev-api-7");
        t.world.advance(TICK);
        t.tick()
    };
    let said: Vec<Vec<String>> = (0..3).map(|_| gone(&t)).collect();

    assert_eq!(
        now,
        (
            200,
            json!({ "review": "acme/api#7: Reviewer started on codex for sha9" })
        )
    );
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab close w1:t5",
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p6 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#,
            &review_prompt("sha9"),
        ]
    );
    assert_eq!(
        shown,
        json!({ "state": "reviewing", "sha": "sha9", "harness": "codex", "attempts": 0, "cap": 2 })
    );
    assert_eq!(
        (&reviewer["tab"], &reviewer["sha"], reviewer.get("failures")),
        (&json!("w1:t6"), &json!("sha9"), None)
    );
    let started = vec!["acme/api#7: Reviewer started on codex for sha9".to_string()];
    assert_eq!(said, [started.clone(), started, vec![STOPPED.into()]]);
}

#[test]
fn review_now_is_said_in_serve_s_log_as_the_tick_s_starts_are() {
    let t = gave_up();

    review_now(&t);

    let logged = t.world.logged();
    let last = logged.last().map(|line| &line[21..]);
    assert_eq!(last, Some("acme/api#7: Reviewer started on codex for sha9"));
}

#[test]
fn review_now_is_refused_while_a_tick_runs_and_starts_nothing() {
    let t = gave_up();
    let tick = std::fs::OpenOptions::new()
        .write(true)
        .open(t.config_dir.join("tick.lock"))
        .unwrap();
    tick.lock().unwrap();
    std::fs::write(t.config_dir.join("tick.lock"), "4242").unwrap();
    let before = dispatches(&t);

    let (refused, calls) = calls_after(&t, || review_now(&t));

    assert_eq!(
        refused,
        (
            409,
            json!({
                "error": "a tick is running (pid 4242)",
                "help": ["Try again once it ends: it may start the Reviewer itself"],
            })
        )
    );
    assert_eq!(herdr(&calls), Vec::<&str>::new());
    assert_eq!(dispatches(&t), before);
}

#[test]
fn with_review_off_review_now_starts_a_reviewer_that_shows_as_with_review_on_and_the_tick_starts_none()
 {
    let t = with_pr("switches = { review = false }");
    t.tick();
    let off = review(&t);

    let (now, calls) = calls_after(&t, || review_now(&t));
    let reviewing = review(&t);
    verdict(&t, &["acme/api#7", "pass", "--sha", "sha9"]);
    let passed = review(&t);
    push(&t, "sha10");
    t.world.advance(TICK);
    let (said, later) = calls_after(&t, || t.tick());

    assert_eq!(off["state"], "off");
    assert_eq!(now.0, 200, "{}", now.1);
    assert_eq!(
        herdr(&calls),
        [
            "herdr tab create --workspace w1 --cwd /worktrees/api-7 --label reviewer --no-focus",
            r#"herdr agent start rev-api-7 --kind codex --pane w1:p3 -- -c projects={"/src/api"={trust_level="trusted"}} -c approvals_reviewer="auto_review""#,
            &review_prompt("sha9"),
        ]
    );
    assert_eq!(
        reviewing,
        json!({ "state": "reviewing", "sha": "sha9", "harness": "codex", "attempts": 0, "cap": 2 })
    );
    assert_eq!(passed["state"], "passed");
    assert_eq!(said, Vec::<String>::new());
    assert_eq!(herdr(&later), Vec::<&str>::new());
    assert_eq!(review(&t)["state"], "off");
}

/// The live Dispatches, as written.
fn dispatches(t: &Setup) -> String {
    std::fs::read_to_string(t.config_dir.join("dispatches.json")).unwrap()
}

#[test]
fn review_now_is_refused_changing_nothing_off_a_live_dispatch_s_open_pr_draft_on_a_head_with_a_verdict_or_a_working_reviewer()
 {
    let see = "Run `nico-agent status` to see the Dispatch";
    let no_pr = dispatched("");
    no_pr.tick();
    let failed = with_pr("");
    failed.tick();
    edit_dispatch(
        &failed.config_dir,
        |d| {
            d["failure"] =
                json!({ "step": "restart", "error": "verdict again after 2 restarts for it" })
        },
    );
    let passed = reviewing();
    verdict(&passed, &["acme/api#7", "pass", "--sha", "sha9"]);
    let working = reviewing();
    let stopped = reviewing();
    reviewer_state(&stopped, "idle");
    stopped
        .world
        .fail_call("herdr tab close", "tab_close_failed: herdr is busy");
    let merged = reviewing();
    merged
        .world
        .fail_call("herdr worktree remove", "worktree_busy: in use");
    merged.world.activity.borrow_mut().insert(
        "acme/api#9".into(),
        PullRequestActivity {
            state: PrState::Merged,
            draft: false,
            head_sha: "sha9".into(),
            base_branch: "main".into(),
            mergeable: Mergeable::Mergeable,
            updated_at: "2026-09-30T12:30:00Z".into(),
            merged_at: Some("2026-09-30T12:30:00Z".into()),
        },
    );
    merged.world.advance(TICK);
    merged.tick();
    let herdr_down = reviewing();
    herdr_down
        .world
        .fail_call("herdr agent list", "herdr_unreachable: herdr is down");
    let cases = [
        (
            &no_pr,
            r#"{"issue": "acme/api#8"}"#,
            409,
            json!({
                "error": "acme/api#8 has no live Dispatch",
                "help": ["A Reviewer reviews the PR of an issue In flight", see],
            }),
        ),
        (
            &no_pr,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "acme/api#7 has no open PR",
                "help": ["A Reviewer reviews the head of an open PR", see],
            }),
        ),
        (
            &merged,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "acme/api#7 has no open PR",
                "help": ["A Reviewer reviews the head of an open PR", see],
            }),
        ),
        (
            &failed,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "acme/api#7 is Failed, not PR draft",
                "help": ["A Reviewer starts on the PR of a Dispatch at PR draft", see],
            }),
        ),
        (
            &passed,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "sha9 of https://github.com/acme/api/pull/9 already has a Verdict: pass",
                "help": ["A push is what asks for a new review: a Reviewer starts on the new head"],
            }),
        ),
        (
            &working,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "acme/api#7's Reviewer rev-api-7 is working",
                "help": ["Wait for its Verdict, or stop it in herdr first"],
            }),
        ),
        (
            &stopped,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "could not close the last Reviewer of acme/api#7: tab_close_failed: herdr is busy",
                "help": [],
            }),
        ),
        (
            &herdr_down,
            r#"{"issue": "acme/api#7"}"#,
            409,
            json!({
                "error": "could not list herdr's agents: herdr_unreachable: herdr is down",
                "help": ["Try again once herdr answers"],
            }),
        ),
        (
            &working,
            r#"{"issue": 7}"#,
            400,
            json!({ "error": "issue is a string, not 7", "help": [] }),
        ),
    ];

    for (t, body, status, refused) in cases {
        let before = dispatches(t);
        let (answer, calls) = calls_after(t, || t.send("POST", "/api/review", body));
        assert_eq!(answer, (status, refused), "{body}");
        let wrote = (herdr(&calls).into_iter()).filter(|c| !c.starts_with("herdr tab close"));
        assert_eq!(wrote.collect::<Vec<_>>(), Vec::<&str>::new(), "{body}");
        assert_eq!(dispatches(t), before, "{body}");
    }
}

#[test]
fn review_now_that_fails_to_start_is_counted_as_the_tick_s_are_and_refused_with_its_error() {
    let t = gave_up();
    t.world
        .fail_call("herdr agent start rev-api-7", "agent_name_taken: rev-api-7");

    let failed = review_now(&t);

    assert_eq!(
        failed,
        (
            409,
            json!({
                "error": "could not start the Reviewer of acme/api#7: agent_name_taken: rev-api-7",
                "help": [],
            })
        )
    );
    let reviewer = &t.cli(&["status", "--json"]).json()["dispatches"][0]["reviewer"];
    assert_eq!(
        (&reviewer["sha"], &reviewer["failures"]),
        (&Value::Null, &json!(["sha9"]))
    );
    assert_eq!(
        review(&t),
        json!({ "state": "retrying", "sha": "sha9", "harness": "codex", "attempts": 1, "cap": 2 })
    );
}

#[test]
fn a_verdict_on_a_malformed_issue_key_is_refused_and_records_nothing() {
    let t = with_issue("");

    for key in ["acme/api#abc", "acme/api#"] {
        let ran = t.cli(&["verdict", key, "pass", "--sha", "sha9", "--json"]);

        assert_eq!(ran.exit_code, 2);
        assert_eq!(
            ran.json(),
            json!({
                "error": format!("`{key}` is not an issue reference"),
                "help": ["Pass `owner/repo#N`, or a Linear identifier such as `BLE-12`"],
            })
        );
    }
    assert!(!t.config_dir.join("verdicts").exists());
}

#[test]
fn a_malformed_issue_key_kept_in_state_neither_panics_the_tick_nor_status() {
    let t = with_pr("");
    let file = t.config_dir.join("dispatches.json");
    let kept = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, kept.replace("acme/api#7", "acme/api#abc")).unwrap();

    t.world.advance(TICK);
    t.tick();

    let status = t.cli(&["status", "--json"]);
    assert_eq!(status.exit_code, 0);
    assert_eq!(status.json()["dispatches"][0]["issue"], "acme/api#abc");
}
