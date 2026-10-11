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

use serde::Deserialize;
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
pub struct RealWorld {
    /// Where `secrets.env` may hold the Linear API key.
    pub config_dir: PathBuf,
}

/// What every real call answers until the ticket that needs it fills it in.
fn unbuilt<T>(name: &str) -> WorldResult<T> {
    Err(WorldError(format!("World::{name} is not built yet")))
}

/// Run `gh` with prompts and colors off: whether it succeeded, its stdout and stderr.
fn gh_run(args: &[String]) -> WorldResult<(bool, String, String)> {
    let ran = Command::new("gh")
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| WorldError("`gh` is not installed or not on PATH".into()))?;
    let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).into_owned();
    Ok((ran.status.success(), text(&ran.stdout), text(&ran.stderr)))
}

/// Run `gh`: what it printed, or its failure in words the user can act on.
fn gh(args: &[String]) -> WorldResult<String> {
    match gh_run(args)? {
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
    } else if says(&["rate limit"]) {
        // shortcut: no reset time; #245 pauses GitHub reads until the reset.
        "GitHub rate limit exceeded"
    } else {
        "GitHub request failed; check your network and `gh auth status`"
    };
    WorldError(message.into())
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
        match gh_run(&args)? {
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
    /// Through `curl`, with the headers on its stdin: on its command line,
    /// any user's `ps` would show an API key.
    fn http(&self, request: &HttpRequest) -> WorldResult<HttpResponse> {
        let unreachable =
            |reason: &str| WorldError(format!("could not reach {}: {reason}", request.url));
        let mut curl = Command::new("curl");
        curl.args(["--silent", "--show-error", "--max-time", "30", "--request"])
            .arg(&request.method)
            .args(["--header", "@-", "--write-out", "\n%{http_code}"]);
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
        let (body, status) = out.rsplit_once('\n').unwrap_or(("", &out));
        Ok(HttpResponse {
            status: status.trim().parse().map_err(|_| invalid(&request.url))?,
            body: body.into(),
        })
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
