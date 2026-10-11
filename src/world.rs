//! The one boundary: every effect outside the process (herdr, git, `gh`,
//! Linear, notifications, the clock, timers, HTTP) goes through [`World`].
//! [`RealWorld`] reaches the outside; tests swap in a fake that records each
//! call. Call shapes are ported from the TypeScript build on `main`.

mod linear;

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The label that offers an issue to the loop.
pub const READY_LABEL: &str = "ready-for-agent";

/// A failure reported by the outside world, already stripped of tool noise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldError(pub String);

impl fmt::Display for WorldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for WorldError {}

const RATE_LIMITED: &str = " rate limit exceeded; nico-agent asks it again at ";

impl WorldError {
    /// `source` (GitHub or Linear) refused a call for its rate limit, until
    /// `until` (ISO 8601).
    pub fn rate_limited(source: &str, until: &str) -> Self {
        WorldError(format!("{source}{RATE_LIMITED}{until}"))
    }

    /// The Source and the time (ISO 8601) of a rate limit, if this is one.
    pub fn rate_limit(&self) -> Option<(&str, &str)> {
        self.0.split_once(RATE_LIMITED)
    }
}

pub type WorldResult<T> = Result<T, WorldError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrState {
    Open,
    Closed,
    Merged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mergeable {
    Mergeable,
    Conflicting,
    /// GitHub is still working it out.
    Unknown,
}

/// An issue of a GitHub repo, by `owner/name` and number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueRef {
    pub slug: String,
    pub number: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubBlocker {
    pub slug: String,
    pub number: u64,
    pub state: IssueState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// ISO 8601, as GitHub gives it.
    pub created_at: String,
    pub state: IssueState,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub blockers: Vec<GitHubBlocker>,
    /// The Spec this issue belongs to, if any.
    pub parent: Option<IssueRef>,
    /// Whether the issue has sub-issues, which makes it a parent, never dispatched.
    pub has_sub_issues: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LinearTeam {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LinearProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearBlocker {
    pub identifier: String,
    /// Linear's state type (`unstarted`, `completed`, ...).
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearIssue {
    pub identifier: String,
    pub title: String,
    pub url: String,
    /// The branch Linear suggests, which its GitHub integration links PRs by.
    pub branch_name: String,
    /// ISO 8601, as Linear gives it.
    pub created_at: String,
    pub team: LinearTeam,
    pub project: Option<LinearProject>,
    pub labels: Vec<String>,
    pub state: String,
    pub assignee: Option<String>,
    pub blockers: Vec<LinearBlocker>,
    pub parent: Option<String>,
    pub has_sub_issues: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequest {
    /// `owner/name` of the repo the PR is in.
    pub repo: String,
    pub number: u64,
    pub url: String,
    pub state: PrState,
    pub base_branch: String,
    pub head_branch: Option<String>,
}

/// What is happening on a PR now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestActivity {
    pub state: PrState,
    pub draft: bool,
    pub head_sha: String,
    pub base_branch: String,
    pub mergeable: Mergeable,
    /// When anything last happened on it, ISO 8601 as GitHub gives it.
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worktree {
    pub workspace: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tab {
    pub tab: String,
    pub pane: String,
}

/// A named herdr agent with its raw Agent state (idle, working, blocked, done, unknown).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agent {
    pub name: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    /// As received: look a name up ignoring case.
    pub headers: Vec<(String, String)>,
    pub body: String,
}

pub trait World {
    // git
    /// Remote URLs of the git clone at `path`, or `None` if it isn't one.
    fn git_remotes(&self, path: &str) -> WorldResult<Option<Vec<String>>>;
    /// Fetch origin, or a head branch into its origin tracking ref.
    fn git_fetch(&self, path: &str, branch: Option<&str>) -> WorldResult<()>;
    /// The branches on the clone's origin, without `refs/heads/`.
    fn git_remote_branches(&self, path: &str) -> WorldResult<Vec<String>>;
    /// The default branch of the clone's origin, without the remote prefix.
    fn git_default_branch(&self, path: &str) -> WorldResult<String>;
    /// `git diff <base>...HEAD` in the checkout at `path`.
    fn git_diff(&self, path: &str, base: &str) -> WorldResult<String>;

    // gh
    /// Login of the user's own GitHub session.
    fn github_viewer(&self) -> WorldResult<String>;
    /// Open `ready-for-agent` issues of a repo; the core still applies the Ready rule.
    fn github_issues(&self, slug: &str) -> WorldResult<Vec<GitHubIssue>>;
    fn github_issue(&self, slug: &str, number: u64) -> WorldResult<Option<GitHubIssue>>;
    /// Open or merged PRs that close an issue when merged.
    fn github_linked_pull_requests(&self, slug: &str, number: u64)
    -> WorldResult<Vec<PullRequest>>;
    fn github_pull_request(&self, slug: &str, number: u64) -> WorldResult<Option<PullRequest>>;
    /// Every PR whose head is `branch`, closed unmerged ones included.
    fn github_branch_pull_requests(
        &self,
        slug: &str,
        branch: &str,
    ) -> WorldResult<Vec<PullRequest>>;
    fn github_pull_request_activity(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<PullRequestActivity>;
    /// The repos (`owner/name`) the bot's GitHub App is installed on.
    fn github_app_repos(&self) -> WorldResult<Vec<String>>;
    /// Assign an issue to the user (the Claim).
    fn github_assign_self(&self, slug: &str, number: u64) -> WorldResult<()>;

    // Linear
    fn linear_viewer(&self) -> WorldResult<String>;
    fn linear_issues(&self, team: &str) -> WorldResult<Vec<LinearIssue>>;
    fn linear_issue(&self, identifier: &str) -> WorldResult<Option<LinearIssue>>;
    /// URLs of a Linear issue's attachments, GitHub PRs among them.
    fn linear_attachment_urls(&self, identifier: &str) -> WorldResult<Vec<String>>;
    /// Assign a Linear issue to the API key's owner (the Claim).
    fn linear_assign_self(&self, identifier: &str) -> WorldResult<()>;

    // herdr
    /// Create a git worktree and open it as a workspace, without focusing it.
    fn herdr_worktree_create(
        &self,
        cwd: &str,
        branch: &str,
        base: &str,
        label: &str,
    ) -> WorldResult<Worktree>;
    /// Remove the workspace's worktree, keeping its branch; no-op if it is gone.
    fn herdr_worktree_remove(&self, workspace: &str) -> WorldResult<()>;
    /// Open a plain workspace (no worktree) in `cwd`, without focusing it.
    fn herdr_workspace_create(&self, cwd: &str, label: &str) -> WorldResult<String>;
    /// Close a workspace and the agents in it; no-op if it is gone.
    fn herdr_workspace_close(&self, workspace: &str) -> WorldResult<()>;
    fn herdr_tab_create(&self, workspace: &str, cwd: &str, label: &str) -> WorldResult<Tab>;
    /// Close a tab and the agents in it; no-op if it is gone.
    fn herdr_tab_close(&self, tab: &str) -> WorldResult<()>;
    /// Start an agent of a herdr kind in a pane: `true` once ready for input,
    /// `false` when it is blocked on a startup question.
    fn herdr_agent_start(
        &self,
        name: &str,
        kind: &str,
        pane: &str,
        args: &[String],
    ) -> WorldResult<bool>;
    /// Run a shell command line in a pane, as if typed and entered.
    fn herdr_pane_run(&self, pane: &str, command: &str) -> WorldResult<()>;
    /// Wait until herdr detects an agent in a pane, failing after `timeout`.
    fn herdr_agent_detect(&self, pane: &str, timeout: Duration) -> WorldResult<()>;
    /// Name the agent in a pane, so later agent commands can address it.
    fn herdr_agent_rename(&self, pane: &str, name: &str) -> WorldResult<()>;
    fn herdr_agents(&self) -> WorldResult<Vec<Agent>>;
    /// The text visible in a named agent's pane.
    fn herdr_agent_read(&self, name: &str) -> WorldResult<String>;
    fn herdr_agent_send_keys(&self, name: &str, keys: &[String]) -> WorldResult<()>;
    /// Wait until a named agent reaches one of `states`, failing after `timeout`.
    fn herdr_agent_wait(&self, name: &str, states: &[String], timeout: Duration)
    -> WorldResult<()>;
    /// Submit a prompt and wait until the agent starts working: `false` when it never reacted.
    fn herdr_agent_prompt(&self, name: &str, text: &str) -> WorldResult<bool>;

    // opencode
    /// Save `effort` as opencode's variant for `model` in its variant `file`
    /// (`~/` is the home directory), keeping the rest; `None` clears it. A
    /// saved variant overrides the one opencode is started with.
    fn opencode_save_variant(
        &self,
        file: &str,
        model: &str,
        effort: Option<&str>,
    ) -> WorldResult<()>;

    // notify
    /// Show the user a desktop notification.
    fn notify(&self, title: &str, body: &str) -> WorldResult<()>;

    // http
    /// Send a request to a service nico-agent doesn't run; any status is a response.
    fn http(&self, request: &HttpRequest) -> WorldResult<HttpResponse>;

    // log
    /// Write a line to `serve`'s log: stderr, which journald keeps for a service.
    fn log(&self, line: &str);

    // clock, timers, process
    fn now(&self) -> SystemTime;
    fn sleep(&self, duration: Duration);
    /// Run `task` every `interval`, each run `interval` after the last one
    /// ended; the real World never returns.
    fn every(&self, interval: Duration, task: &mut dyn FnMut());
    fn process_id(&self) -> u32;
    fn process_alive(&self, pid: u32) -> bool;
}

/// The World of the running binary.
pub struct RealWorld {
    /// Where `secrets.env` may hold the Linear API key.
    pub config_dir: PathBuf,
}

/// What every real call answers until the ticket that needs it fills it in.
fn unbuilt<T>(name: &str) -> WorldResult<T> {
    Err(WorldError(format!("World::{name} is not built yet")))
}

/// Run `gh` (or `ghbot`, its bot twin) with prompts and colors off: whether
/// it succeeded, its stdout and stderr.
fn gh_run(bin: &str, args: &[String]) -> WorldResult<(bool, String, String)> {
    let ran = Command::new(bin)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| WorldError(format!("`{bin}` is not installed or not on PATH")))?;
    let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).into_owned();
    Ok((ran.status.success(), text(&ran.stdout), text(&ran.stderr)))
}

/// Run `gh`: what it printed, or its failure in words the user can act on.
fn gh(args: &[String]) -> WorldResult<String> {
    match gh_run("gh", args)? {
        (true, stdout, _) => Ok(stdout),
        (false, _, stderr) => Err(gh_failure(&stderr)),
    }
}

fn gh_failure(stderr: &str) -> WorldError {
    let stderr = stderr.to_lowercase();
    let says = |words: &[&str]| words.iter().any(|w| stderr.contains(w));
    let message = if says(&["auth login", "authentication", "http 401"]) {
        "not authenticated with GitHub; run `gh auth login`"
    } else if says(&["could not resolve to a repository", "http 404"]) {
        return repo_not_found();
    } else if says(&["rate limit", "http 429"]) {
        return WorldError::rate_limited("GitHub", &crate::state::iso(github_reset()));
    } else {
        "GitHub request failed; check your network and `gh auth status`"
    };
    WorldError(message.into())
}

/// When GitHub may be asked again: the latest reset of its spent limits, as
/// `gh api rate_limit` (which costs none) says; else in a minute, as GitHub
/// asks of a secondary limit.
fn github_reset() -> SystemTime {
    let args = ["api", "rate_limit"].map(String::from);
    let limits = gh_run("gh", &args).ok().filter(|(ok, ..)| *ok);
    let limits: Option<Value> =
        limits.and_then(|(_, stdout, _)| serde_json::from_str(&stdout).ok());
    let spent = (limits.as_ref())
        .and_then(|limits| limits["resources"].as_object())
        .and_then(|resources| {
            (resources.values())
                .filter(|limit| limit["remaining"] == 0)
                .filter_map(|limit| limit["reset"].as_u64())
                .max()
        });
    spent.map_or_else(
        || SystemTime::now() + Duration::from_secs(60),
        |reset| SystemTime::UNIX_EPOCH + Duration::from_secs(reset),
    )
}

/// `gh api graphql` with `query`, `-f` string and `-F` typed variables, as JSON.
fn gh_graphql(query: &str, strings: &[(&str, &str)], typed: &[(&str, &str)]) -> WorldResult<Value> {
    let mut args: Vec<String> = ["api", "graphql", "-f"].map(String::from).into();
    args.push(format!("query={query}"));
    for (flag, vars) in [("-f", strings), ("-F", typed)] {
        for (name, value) in vars {
            args.extend([flag.to_string(), format!("{name}={value}")]);
        }
    }
    serde_json::from_str(&gh(&args)?).map_err(|_| invalid("GitHub"))
}

fn invalid(source: &str) -> WorldError {
    WorldError(format!("{source} returned an invalid response"))
}

fn repo_not_found() -> WorldError {
    WorldError("repository not found on GitHub, or not visible to your account".into())
}

/// A page of a GraphQL connection.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    nodes: Vec<T>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
}

const ISSUES_QUERY: &str = "query($owner: String!, $name: String!, $label: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor, states: OPEN, labels: [$label], orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state createdAt
        labels(first: 50) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        blockedBy(first: 50) { nodes { number state repository { nameWithOwner } } }
        parent { number repository { nameWithOwner } }
        subIssuesSummary { total }
      }
    }
  }
}";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    number: u64,
    title: String,
    url: String,
    state: String,
    created_at: String,
    labels: Nodes<Named>,
    assignees: Nodes<Login>,
    blocked_by: Nodes<NumberedNode>,
    parent: Option<NumberedNode>,
    sub_issues_summary: Total,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
struct NumberedNode {
    number: u64,
    #[serde(default)]
    state: String,
    repository: Repository,
}

#[derive(Deserialize)]
struct Total {
    total: u64,
}

fn issue_state(state: &str) -> IssueState {
    if state == "OPEN" {
        IssueState::Open
    } else {
        IssueState::Closed
    }
}

impl From<IssueNode> for GitHubIssue {
    fn from(node: IssueNode) -> Self {
        GitHubIssue {
            number: node.number,
            title: node.title,
            url: node.url,
            created_at: node.created_at,
            state: issue_state(&node.state),
            labels: node.labels.nodes.into_iter().map(|l| l.name).collect(),
            assignees: node.assignees.nodes.into_iter().map(|a| a.login).collect(),
            blockers: (node.blocked_by.nodes.into_iter())
                .map(|b| GitHubBlocker {
                    slug: b.repository.name_with_owner,
                    number: b.number,
                    state: issue_state(&b.state),
                })
                .collect(),
            parent: node.parent.map(|p| IssueRef {
                slug: p.repository.name_with_owner,
                number: p.number,
            }),
            has_sub_issues: node.sub_issues_summary.total > 0,
        }
    }
}

const LINKED_PRS_QUERY: &str = "query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 20) {
        nodes { number url state baseRefName headRefName headRepository { nameWithOwner } repository { nameWithOwner } }
      }
    }
  }
}";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkedPrNode {
    number: u64,
    url: String,
    state: String,
    base_ref_name: String,
    head_ref_name: String,
    head_repository: Option<Repository>,
    repository: Repository,
}

/// The fields `gh pr view` and `gh pr list` give a PR by.
const LISTED_PR_FIELDS: &str = "number,url,state,baseRefName,headRefName,isCrossRepository";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListedPr {
    number: u64,
    url: String,
    state: String,
    base_ref_name: String,
    head_ref_name: String,
    is_cross_repository: bool,
}

fn pr_state(state: &str) -> PrState {
    match state {
        "OPEN" => PrState::Open,
        "MERGED" => PrState::Merged,
        _ => PrState::Closed,
    }
}

impl ListedPr {
    fn into_pr(self, repo: &str) -> PullRequest {
        PullRequest {
            repo: repo.into(),
            number: self.number,
            url: self.url,
            state: pr_state(&self.state),
            base_branch: self.base_ref_name,
            // A fork's head is not fetchable as origin/<head branch> in this clone.
            head_branch: (!self.is_cross_repository).then_some(self.head_ref_name),
        }
    }
}

/// Run `git -C <dir> <args>`: whether it succeeded, and what it printed.
fn git(dir: &Path, args: &[&str]) -> WorldResult<(bool, String)> {
    let ran = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| WorldError(format!("could not run git: {e}")))?;
    Ok((
        ran.status.success(),
        String::from_utf8_lossy(&ran.stdout).into_owned(),
    ))
}

/// Run `git -C <path> <args>`, never prompting: what it printed, trimmed, or
/// its failure with git's first line about it.
fn git_ok(path: &str, args: &[&str]) -> WorldResult<String> {
    let ran = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| WorldError(format!("could not run git: {e}")))?;
    if ran.status.success() {
        return Ok(String::from_utf8_lossy(&ran.stdout).trim().into());
    }
    let reason = first_line(&ran.stderr, &ran.status);
    Err(WorldError(format!(
        "`git {}` failed in {path}: {reason}",
        args.join(" ")
    )))
}

/// A failed command's first line on stderr, else its exit status.
fn first_line(stderr: &[u8], status: &std::process::ExitStatus) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    (stderr.lines().map(str::trim).find(|l| !l.is_empty()))
        .map_or_else(|| status.to_string(), String::from)
}

/// A failed herdr command, with herdr's error code when it reported one.
struct HerdrFailure {
    code: Option<String>,
    error: WorldError,
}

impl From<HerdrFailure> for WorldError {
    fn from(failure: HerdrFailure) -> Self {
        failure.error
    }
}

impl HerdrFailure {
    fn is(&self, codes: &[&str]) -> bool {
        self.code.as_deref().is_some_and(|c| codes.contains(&c))
    }
}

/// Run herdr: what it printed, or its failure, which herdr reports as
/// `{"error": {"code", "message"}}` on stderr.
fn herdr_text(args: &[&str]) -> Result<String, HerdrFailure> {
    let ran = Command::new("herdr")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|_| HerdrFailure {
            code: None,
            error: WorldError("`herdr` is not installed or not on PATH".into()),
        })?;
    if ran.status.success() {
        return Ok(String::from_utf8_lossy(&ran.stdout).into_owned());
    }
    let reported: Option<Value> = serde_json::from_slice::<Value>(&ran.stderr)
        .ok()
        .map(|v| v["error"].clone());
    let code = reported
        .as_ref()
        .and_then(|e| e["code"].as_str())
        .map(String::from);
    let message = match &code {
        Some(code) => format!(
            "{code}: {}",
            reported
                .as_ref()
                .and_then(|e| e["message"].as_str())
                .unwrap_or_default()
        ),
        None => first_line(&ran.stderr, &ran.status),
    };
    let command = args[..args.len().min(2)].join(" ");
    Err(HerdrFailure {
        code,
        error: WorldError(format!("`herdr {command}` failed: {message}")),
    })
}

/// Run a herdr control command: the `result` of the JSON it prints.
fn herdr(args: &[&str]) -> Result<Value, HerdrFailure> {
    let text = herdr_text(args)?;
    let printed: Value = serde_json::from_str(&text).map_err(|_| HerdrFailure {
        code: None,
        error: invalid("herdr"),
    })?;
    Ok(printed["result"].clone())
}

/// The text at `value`, or herdr answered something else.
fn herdr_str(value: &Value) -> WorldResult<String> {
    value
        .as_str()
        .map(String::from)
        .ok_or_else(|| invalid("herdr"))
}

impl World for RealWorld {
    /// Only a clone's top directory is a clone: not a directory inside one.
    fn git_remotes(&self, path: &str) -> WorldResult<Option<Vec<String>>> {
        let Ok(real) = fs::canonicalize(path) else {
            return Ok(None);
        };
        let (ok, top) = git(&real, &["rev-parse", "--show-toplevel"])?;
        if !ok || fs::canonicalize(top.trim()).ok() != Some(real.clone()) {
            return Ok(None);
        }
        // Exits 1 when there is no remote: none.
        let (_, remotes) = git(&real, &["config", "--get-regexp", r"^remote\..*\.url$"])?;
        Ok(Some(
            remotes
                .lines()
                .filter_map(|line| line.split_once(' ').map(|(_, url)| url.to_string()))
                .collect(),
        ))
    }
    /// A head branch by its explicit refspec: a narrow clone would not make `origin/<branch>`.
    fn git_fetch(&self, path: &str, branch: Option<&str>) -> WorldResult<()> {
        let refspec = branch.map(|b| format!("+refs/heads/{b}:refs/remotes/origin/{b}"));
        let mut args = vec!["fetch", "origin"];
        args.extend(refspec.as_deref());
        git_ok(path, &args).map(drop)
    }
    fn git_remote_branches(&self, _: &str) -> WorldResult<Vec<String>> {
        unbuilt("git_remote_branches")
    }
    fn git_default_branch(&self, path: &str) -> WorldResult<String> {
        if let Ok(head) = git_ok(
            path,
            &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        ) {
            return Ok(head.strip_prefix("origin/").unwrap_or(&head).into());
        }
        // Some clones lack origin/HEAD; ask the remote rather than write it into the clone.
        let listing = git_ok(path, &["ls-remote", "--symref", "origin", "HEAD"])?;
        (listing.lines())
            .find_map(|line| {
                let branch = line
                    .strip_prefix("ref: refs/heads/")?
                    .strip_suffix("HEAD")?;
                Some(branch.trim().to_string())
            })
            .ok_or_else(|| {
                WorldError(format!(
                    "could not find the default branch of origin in {path}"
                ))
            })
    }
    fn git_diff(&self, _: &str, _: &str) -> WorldResult<String> {
        unbuilt("git_diff")
    }
    fn github_viewer(&self) -> WorldResult<String> {
        let args = ["api", "user", "--jq", ".login"].map(String::from);
        Ok(gh(&args)?.trim().to_string())
    }
    fn github_issues(&self, slug: &str) -> WorldResult<Vec<GitHubIssue>> {
        let (owner, name) = slug.split_once('/').ok_or_else(repo_not_found)?;
        let mut issues = vec![];
        let mut cursor = None;
        loop {
            let mut vars = vec![("owner", owner), ("name", name), ("label", READY_LABEL)];
            vars.extend(cursor.as_deref().map(|c| ("cursor", c)));
            let response = gh_graphql(ISSUES_QUERY, &vars, &[])?;
            let page = &response["data"]["repository"]["issues"];
            if page.is_null() {
                return Err(repo_not_found());
            }
            let page: Page<IssueNode> =
                serde_json::from_value(page.clone()).map_err(|_| invalid("GitHub"))?;
            issues.extend(page.nodes.into_iter().map(GitHubIssue::from));
            match page.page_info {
                PageInfo {
                    has_next_page: true,
                    end_cursor: Some(next),
                } => cursor = Some(next),
                _ => return Ok(issues),
            }
        }
    }
    fn github_issue(&self, _: &str, _: u64) -> WorldResult<Option<GitHubIssue>> {
        unbuilt("github_issue")
    }
    fn github_linked_pull_requests(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<Vec<PullRequest>> {
        let (owner, name) = slug.split_once('/').ok_or_else(repo_not_found)?;
        let number = number.to_string();
        let vars = [("owner", owner), ("name", name)];
        let response = gh_graphql(LINKED_PRS_QUERY, &vars, &[("number", &number)])?;
        let linked = &response["data"]["repository"]["issue"]["closedByPullRequestsReferences"];
        if linked.is_null() {
            return Err(WorldError(format!(
                "{slug}#{number} was not found on GitHub"
            )));
        }
        let linked: Nodes<LinkedPrNode> =
            serde_json::from_value(linked.clone()).map_err(|_| invalid("GitHub"))?;
        Ok(linked
            .nodes
            .into_iter()
            .map(|pr| {
                let repo = pr.repository.name_with_owner;
                // A fork's head is not fetchable as origin/<head branch> in this clone.
                let own_head = pr
                    .head_repository
                    .is_some_and(|head| head.name_with_owner.eq_ignore_ascii_case(&repo));
                PullRequest {
                    number: pr.number,
                    url: pr.url,
                    state: pr_state(&pr.state),
                    base_branch: pr.base_ref_name,
                    head_branch: own_head.then_some(pr.head_ref_name),
                    repo,
                }
            })
            .collect())
    }
    fn github_pull_request(&self, slug: &str, number: u64) -> WorldResult<Option<PullRequest>> {
        let args = ["pr", "view", &number.to_string(), "--repo", slug, "--json"];
        let mut args: Vec<String> = args.map(String::from).into();
        args.push(LISTED_PR_FIELDS.into());
        match gh_run("gh", &args)? {
            (true, stdout, _) => serde_json::from_str::<ListedPr>(&stdout)
                .map(|pr| Some(pr.into_pr(slug)))
                .map_err(|_| invalid("GitHub")),
            (false, _, stderr) => {
                let lower = stderr.to_lowercase();
                let gone = [
                    "could not resolve to a pullrequest",
                    "no pull requests found",
                ];
                if gone.iter().any(|g| lower.contains(g)) {
                    Ok(None)
                } else {
                    Err(gh_failure(&stderr))
                }
            }
        }
    }
    fn github_branch_pull_requests(
        &self,
        slug: &str,
        branch: &str,
    ) -> WorldResult<Vec<PullRequest>> {
        let args = [
            "pr", "list", "--repo", slug, "--head", branch, "--state", "all",
        ];
        let mut args: Vec<String> = args.map(String::from).into();
        args.extend(["--limit", "100", "--json", LISTED_PR_FIELDS].map(String::from));
        let listed: Vec<ListedPr> =
            serde_json::from_str(&gh(&args)?).map_err(|_| invalid("GitHub"))?;
        // gh lists newest first, and `--head` matches forks' branches of the same name too.
        Ok(listed
            .into_iter()
            .rev()
            .filter(|pr| pr.head_ref_name == branch)
            .map(|pr| pr.into_pr(slug))
            .collect())
    }
    fn github_pull_request_activity(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<PullRequestActivity> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Viewed {
            state: String,
            is_draft: bool,
            head_ref_oid: String,
            base_ref_name: String,
            mergeable: String,
            updated_at: String,
        }
        let number = number.to_string();
        let fields = "state,isDraft,headRefOid,baseRefName,mergeable,updatedAt";
        let args = ["pr", "view", &number, "--repo", slug, "--json", fields];
        let viewed: Viewed =
            serde_json::from_str(&gh(&args.map(String::from))?).map_err(|_| invalid("GitHub"))?;
        Ok(PullRequestActivity {
            state: pr_state(&viewed.state),
            draft: viewed.is_draft,
            head_sha: viewed.head_ref_oid,
            base_branch: viewed.base_ref_name,
            mergeable: match viewed.mergeable.as_str() {
                "MERGEABLE" => Mergeable::Mergeable,
                "CONFLICTING" => Mergeable::Conflicting,
                _ => Mergeable::Unknown,
            },
            updated_at: viewed.updated_at,
        })
    }
    /// Through `ghbot`: only the App's installation token can list its repositories.
    fn github_app_repos(&self) -> WorldResult<Vec<String>> {
        let args = [
            "api",
            "/installation/repositories",
            "--paginate",
            "--jq",
            ".repositories[].full_name",
        ];
        match gh_run("ghbot", &args.map(String::from))? {
            (true, stdout, _) => Ok(stdout
                .lines()
                .filter(|l| !l.is_empty())
                .map(String::from)
                .collect()),
            (false, _, stderr) => {
                let reason = stderr
                    .lines()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("it failed");
                Err(WorldError(format!(
                    "`ghbot api /installation/repositories` failed: {}",
                    reason.trim()
                )))
            }
        }
    }
    fn github_assign_self(&self, slug: &str, number: u64) -> WorldResult<()> {
        let number = number.to_string();
        let args = [
            "issue",
            "edit",
            &number,
            "--repo",
            slug,
            "--add-assignee",
            "@me",
        ];
        gh(&args.map(String::from)).map(drop)
    }
    fn linear_viewer(&self) -> WorldResult<String> {
        linear::viewer(self)
    }
    fn linear_issues(&self, team: &str) -> WorldResult<Vec<LinearIssue>> {
        linear::issues(self, team)
    }
    fn linear_issue(&self, _: &str) -> WorldResult<Option<LinearIssue>> {
        unbuilt("linear_issue")
    }
    fn linear_attachment_urls(&self, identifier: &str) -> WorldResult<Vec<String>> {
        linear::attachment_urls(self, identifier)
    }
    fn linear_assign_self(&self, identifier: &str) -> WorldResult<()> {
        linear::assign_self(self, identifier)
    }
    fn herdr_worktree_create(
        &self,
        cwd: &str,
        branch: &str,
        base: &str,
        label: &str,
    ) -> WorldResult<Worktree> {
        let result = herdr(&[
            "worktree",
            "create",
            "--cwd",
            cwd,
            "--branch",
            branch,
            "--base",
            base,
            "--label",
            label,
            "--no-focus",
        ])?;
        Ok(Worktree {
            workspace: herdr_str(&result["workspace"]["workspace_id"])?,
            path: herdr_str(&result["worktree"]["path"])?,
        })
    }
    fn herdr_worktree_remove(&self, workspace: &str) -> WorldResult<()> {
        match herdr(&["worktree", "remove", "--workspace", workspace]) {
            Err(failure) if !failure.is(&["workspace_not_found"]) => Err(failure.into()),
            _ => Ok(()),
        }
    }
    fn herdr_workspace_create(&self, _: &str, _: &str) -> WorldResult<String> {
        unbuilt("herdr_workspace_create")
    }
    fn herdr_workspace_close(&self, workspace: &str) -> WorldResult<()> {
        match herdr(&["workspace", "close", workspace]) {
            Err(failure) if !failure.is(&["workspace_not_found"]) => Err(failure.into()),
            _ => Ok(()),
        }
    }
    fn herdr_tab_create(&self, workspace: &str, cwd: &str, label: &str) -> WorldResult<Tab> {
        let result = herdr(&[
            "tab",
            "create",
            "--workspace",
            workspace,
            "--cwd",
            cwd,
            "--label",
            label,
            "--no-focus",
        ])?;
        Ok(Tab {
            tab: herdr_str(&result["tab"]["tab_id"])?,
            pane: herdr_str(&result["root_pane"]["pane_id"])?,
        })
    }
    fn herdr_tab_close(&self, tab: &str) -> WorldResult<()> {
        match herdr_text(&["tab", "close", tab]) {
            Err(failure) if !failure.is(&["tab_not_found"]) => Err(failure.into()),
            _ => Ok(()),
        }
    }
    fn herdr_agent_start(
        &self,
        name: &str,
        kind: &str,
        pane: &str,
        args: &[String],
    ) -> WorldResult<bool> {
        let mut all = vec!["agent", "start", name, "--kind", kind, "--pane", pane, "--"];
        all.extend(args.iter().map(String::as_str));
        match herdr(&all) {
            Ok(_) => Ok(true),
            // Both leave the agent running, waiting on a startup question.
            Err(failure) if failure.is(&["agent_not_ready", "agent_blocked"]) => Ok(false),
            Err(failure) => Err(failure.into()),
        }
    }
    fn herdr_pane_run(&self, pane: &str, command: &str) -> WorldResult<()> {
        // Prints nothing on success.
        herdr_text(&["pane", "run", pane, command])?;
        Ok(())
    }
    /// `agent wait` fails at once on a pane with no agent yet, so herdr is asked until it sees one.
    fn herdr_agent_detect(&self, pane: &str, timeout: Duration) -> WorldResult<()> {
        let deadline = self.now() + timeout;
        loop {
            match herdr(&["agent", "get", pane]) {
                Ok(got) => {
                    let agent = &got["agent"];
                    let named = agent["agent"].as_str().is_some_and(|a| !a.is_empty());
                    if named && agent["interactive_ready"] != Value::Bool(false) {
                        return Ok(());
                    }
                }
                Err(failure) if failure.is(&["agent_not_found"]) => {}
                Err(failure) => return Err(failure.into()),
            }
            if self.now() >= deadline {
                return Err(WorldError(format!(
                    "agent_not_detected: herdr detected no agent ready in pane {pane} within {}ms",
                    timeout.as_millis()
                )));
            }
            self.sleep(Duration::from_millis(250));
        }
    }
    fn herdr_agent_rename(&self, pane: &str, name: &str) -> WorldResult<()> {
        herdr(&["agent", "rename", pane, name])?;
        Ok(())
    }
    /// Only named agents; one with no status reported is `unknown`.
    fn herdr_agents(&self) -> WorldResult<Vec<Agent>> {
        let listed = herdr(&["agent", "list"])?;
        let agents = listed["agents"]
            .as_array()
            .ok_or_else(|| invalid("herdr"))?;
        Ok((agents.iter())
            .filter_map(|a| {
                Some(Agent {
                    name: a["name"].as_str().filter(|n| !n.is_empty())?.into(),
                    state: a["agent_status"].as_str().unwrap_or("unknown").into(),
                })
            })
            .collect())
    }
    fn herdr_agent_read(&self, name: &str) -> WorldResult<String> {
        Ok(herdr_text(&["agent", "read", name, "--source", "visible"])?)
    }
    fn herdr_agent_send_keys(&self, name: &str, keys: &[String]) -> WorldResult<()> {
        let mut all = vec!["agent", "send-keys", name];
        all.extend(keys.iter().map(String::as_str));
        herdr(&all)?;
        Ok(())
    }
    fn herdr_agent_wait(
        &self,
        name: &str,
        states: &[String],
        timeout: Duration,
    ) -> WorldResult<()> {
        let timeout = timeout.as_millis().to_string();
        let mut all = vec!["agent", "wait", name];
        for state in states {
            all.extend(["--until", state]);
        }
        all.extend(["--timeout", &timeout]);
        herdr(&all)?;
        Ok(())
    }
    /// Returns once the agent starts working, not when it is done.
    fn herdr_agent_prompt(&self, name: &str, text: &str) -> WorldResult<bool> {
        let wait = ["--wait", "--until", "working", "--timeout", "30000"];
        let mut all = vec!["agent", "prompt", name, text];
        all.extend(wait);
        match herdr(&all) {
            Ok(_) => Ok(true),
            Err(failure) if failure.is(&["agent_prompt_stalled"]) => Ok(false),
            Err(failure) => Err(failure.into()),
        }
    }
    fn opencode_save_variant(
        &self,
        file: &str,
        model: &str,
        effort: Option<&str>,
    ) -> WorldResult<()> {
        let file = match file.strip_prefix("~/") {
            Some(rest) => std::env::home_dir().unwrap_or_default().join(rest),
            None => PathBuf::from(file),
        };
        let shown = file.display();
        let fix = |problem: &str| WorldError(format!("{shown} {problem}; fix or delete it"));
        let mut saved: Value = match fs::read_to_string(&file) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                serde_json::json!({ "recent": [], "favorite": [] })
            }
            Err(e) => return Err(WorldError(format!("{shown}: {e}"))),
            Ok(text) => serde_json::from_str(&text).map_err(|_| fix("is not valid JSON"))?,
        };
        let variants = (saved.as_object_mut())
            .ok_or_else(|| fix("is not a JSON object"))?
            .entry("variant")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or_else(|| fix("has a `variant` that is not a JSON object"))?;
        match effort {
            Some(effort) => variants.insert(model.into(), effort.into()),
            None => variants.remove(model),
        };
        let written = || -> std::io::Result<()> {
            if let Some(dir) = file.parent() {
                fs::create_dir_all(dir)?;
            }
            // Per process, so concurrent dispatches don't write over each other's half-written file.
            let tmp = file.with_extension(format!("{}.tmp", std::process::id()));
            fs::write(&tmp, saved.to_string())?;
            fs::rename(&tmp, &file)
        };
        written().map_err(|e| WorldError(format!("{shown}: {e}")))
    }
    fn notify(&self, title: &str, body: &str) -> WorldResult<()> {
        let ran = Command::new("notify-send")
            .args(["--app-name", "nico-agent", "--", title, body])
            .stdin(Stdio::null())
            .output()
            .map_err(|_| WorldError("`notify-send` is not installed or not on PATH".into()))?;
        if ran.status.success() {
            return Ok(());
        }
        let reason = first_line(&ran.stderr, &ran.status);
        Err(WorldError(format!("`notify-send` failed: {reason}")))
    }
    /// Through `curl`, with the headers on its stdin: on its command line,
    /// any user's `ps` would show an API key.
    fn http(&self, request: &HttpRequest) -> WorldResult<HttpResponse> {
        let unreachable =
            |reason: &str| WorldError(format!("could not reach {}: {reason}", request.url));
        let mut curl = Command::new("curl");
        curl.args(["--silent", "--show-error", "--max-time", "30", "--request"])
            .arg(&request.method)
            .args(["--header", "@-", "--dump-header", "-"])
            .args(["--write-out", "\n%{http_code}"]);
        if !request.body.is_empty() {
            curl.arg("--data-binary").arg(&request.body);
        }
        let mut child = curl
            .arg(&request.url)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| WorldError("`curl` is not installed or not on PATH".into()))?;
        let headers: String = (request.headers.iter())
            .map(|(name, value)| format!("{name}: {value}\n"))
            .collect();
        (child.stdin.take().expect("stdin is piped"))
            .write_all(headers.as_bytes())
            .map_err(|e| unreachable(&e.to_string()))?;
        let ran = child
            .wait_with_output()
            .map_err(|e| unreachable(&e.to_string()))?;
        if !ran.status.success() {
            let stderr = String::from_utf8_lossy(&ran.stderr);
            return Err(unreachable(stderr.lines().next().unwrap_or("curl failed")));
        }
        let out = String::from_utf8_lossy(&ran.stdout);
        let (mut body, status) = out.rsplit_once('\n').unwrap_or(("", &out));
        // `--dump-header -` puts each response's head before the body, a
        // proxy's or a `100 Continue`'s before the last one's.
        let mut headers = vec![];
        while body.starts_with("HTTP/") {
            let (head, rest) = body.split_once("\r\n\r\n").unwrap_or((body, ""));
            headers = (head.lines().skip(1))
                .filter_map(|line| line.split_once(':'))
                .map(|(name, value)| (name.trim().into(), value.trim().into()))
                .collect();
            body = rest;
        }
        Ok(HttpResponse {
            status: status.trim().parse().map_err(|_| invalid(&request.url))?,
            headers,
            body: body.into(),
        })
    }
    fn log(&self, line: &str) {
        eprintln!("{line}");
    }
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration)
    }
    fn every(&self, interval: Duration, task: &mut dyn FnMut()) {
        loop {
            std::thread::sleep(interval);
            task();
        }
    }
    fn process_id(&self) -> u32 {
        std::process::id()
    }
    fn process_alive(&self, pid: u32) -> bool {
        // shortcut: Linux-only liveness check; use kill(pid, 0) if nico-agent ever runs elsewhere.
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
}
