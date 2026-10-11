//! The one boundary: every effect outside the process (herdr, git, `gh`,
//! Linear, notifications, the clock, timers, HTTP) goes through [`World`].
//! [`RealWorld`] reaches the outside; tests swap in a fake that records each
//! call. Call shapes are ported from the TypeScript build on `main`.

use std::fmt;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime};

/// A failure reported by the outside world, already stripped of tool noise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldError(pub String);

impl fmt::Display for WorldError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for WorldError {}

pub type WorldResult<T> = Result<T, WorldError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrState {
    Open,
    Closed,
    Merged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearTeam {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
    pub base_branch: String,
    pub mergeable: Mergeable,
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

    // notify
    /// Show the user a desktop notification.
    fn notify(&self, title: &str, body: &str) -> WorldResult<()>;

    // http
    /// Send a request to a service nico-agent doesn't run; any status is a response.
    fn http(&self, request: &HttpRequest) -> WorldResult<HttpResponse>;

    // clock, timers, process
    fn now(&self) -> SystemTime;
    fn sleep(&self, duration: Duration);
    fn process_id(&self) -> u32;
    fn process_alive(&self, pid: u32) -> bool;
}

/// The World of the running binary.
pub struct RealWorld;

/// What every real call answers until the ticket that needs it fills it in.
fn unbuilt<T>(name: &str) -> WorldResult<T> {
    Err(WorldError(format!("World::{name} is not built yet")))
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
    fn git_fetch(&self, _: &str, _: Option<&str>) -> WorldResult<()> {
        unbuilt("git_fetch")
    }
    fn git_remote_branches(&self, _: &str) -> WorldResult<Vec<String>> {
        unbuilt("git_remote_branches")
    }
    fn git_default_branch(&self, _: &str) -> WorldResult<String> {
        unbuilt("git_default_branch")
    }
    fn git_diff(&self, _: &str, _: &str) -> WorldResult<String> {
        unbuilt("git_diff")
    }
    fn github_viewer(&self) -> WorldResult<String> {
        unbuilt("github_viewer")
    }
    fn github_issues(&self, _: &str) -> WorldResult<Vec<GitHubIssue>> {
        unbuilt("github_issues")
    }
    fn github_issue(&self, _: &str, _: u64) -> WorldResult<Option<GitHubIssue>> {
        unbuilt("github_issue")
    }
    fn github_linked_pull_requests(&self, _: &str, _: u64) -> WorldResult<Vec<PullRequest>> {
        unbuilt("github_linked_pull_requests")
    }
    fn github_pull_request(&self, _: &str, _: u64) -> WorldResult<Option<PullRequest>> {
        unbuilt("github_pull_request")
    }
    fn github_branch_pull_requests(&self, _: &str, _: &str) -> WorldResult<Vec<PullRequest>> {
        unbuilt("github_branch_pull_requests")
    }
    fn github_pull_request_activity(&self, _: &str, _: u64) -> WorldResult<PullRequestActivity> {
        unbuilt("github_pull_request_activity")
    }
    fn github_app_repos(&self) -> WorldResult<Vec<String>> {
        unbuilt("github_app_repos")
    }
    fn github_assign_self(&self, _: &str, _: u64) -> WorldResult<()> {
        unbuilt("github_assign_self")
    }
    fn linear_viewer(&self) -> WorldResult<String> {
        unbuilt("linear_viewer")
    }
    fn linear_issues(&self, _: &str) -> WorldResult<Vec<LinearIssue>> {
        unbuilt("linear_issues")
    }
    fn linear_issue(&self, _: &str) -> WorldResult<Option<LinearIssue>> {
        unbuilt("linear_issue")
    }
    fn linear_attachment_urls(&self, _: &str) -> WorldResult<Vec<String>> {
        unbuilt("linear_attachment_urls")
    }
    fn linear_assign_self(&self, _: &str) -> WorldResult<()> {
        unbuilt("linear_assign_self")
    }
    fn herdr_worktree_create(&self, _: &str, _: &str, _: &str, _: &str) -> WorldResult<Worktree> {
        unbuilt("herdr_worktree_create")
    }
    fn herdr_worktree_remove(&self, _: &str) -> WorldResult<()> {
        unbuilt("herdr_worktree_remove")
    }
    fn herdr_workspace_create(&self, _: &str, _: &str) -> WorldResult<String> {
        unbuilt("herdr_workspace_create")
    }
    fn herdr_workspace_close(&self, _: &str) -> WorldResult<()> {
        unbuilt("herdr_workspace_close")
    }
    fn herdr_tab_create(&self, _: &str, _: &str, _: &str) -> WorldResult<Tab> {
        unbuilt("herdr_tab_create")
    }
    fn herdr_agent_start(&self, _: &str, _: &str, _: &str, _: &[String]) -> WorldResult<bool> {
        unbuilt("herdr_agent_start")
    }
    fn herdr_pane_run(&self, _: &str, _: &str) -> WorldResult<()> {
        unbuilt("herdr_pane_run")
    }
    fn herdr_agent_detect(&self, _: &str, _: Duration) -> WorldResult<()> {
        unbuilt("herdr_agent_detect")
    }
    fn herdr_agent_rename(&self, _: &str, _: &str) -> WorldResult<()> {
        unbuilt("herdr_agent_rename")
    }
    fn herdr_agents(&self) -> WorldResult<Vec<Agent>> {
        unbuilt("herdr_agents")
    }
    fn herdr_agent_read(&self, _: &str) -> WorldResult<String> {
        unbuilt("herdr_agent_read")
    }
    fn herdr_agent_send_keys(&self, _: &str, _: &[String]) -> WorldResult<()> {
        unbuilt("herdr_agent_send_keys")
    }
    fn herdr_agent_wait(&self, _: &str, _: &[String], _: Duration) -> WorldResult<()> {
        unbuilt("herdr_agent_wait")
    }
    fn herdr_agent_prompt(&self, _: &str, _: &str) -> WorldResult<bool> {
        unbuilt("herdr_agent_prompt")
    }
    fn notify(&self, _: &str, _: &str) -> WorldResult<()> {
        unbuilt("notify")
    }
    fn http(&self, _: &HttpRequest) -> WorldResult<HttpResponse> {
        unbuilt("http")
    }
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration)
    }
    fn process_id(&self) -> u32 {
        std::process::id()
    }
    fn process_alive(&self, pid: u32) -> bool {
        // shortcut: Linux-only liveness check; use kill(pid, 0) if nico-agent ever runs elsewhere.
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
}
