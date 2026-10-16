//! The one boundary: every effect outside the process (herdr, git, `gh`,
//! Linear, notifications, the clock, timers, HTTP) goes through [`World`].
//! [`RealWorld`] reaches the outside; tests swap in a fake that records each
//! call. Call shapes are ported from the TypeScript build on `main`.

mod linear;

use std::fmt;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubBlocker {
    pub slug: String,
    pub number: u64,
    pub title: String,
    pub state: IssueState,
    /// ISO 8601, once closed.
    pub closed_at: Option<String>,
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
    pub title: String,
    /// Linear's state type (`unstarted`, `completed`, ...).
    pub state: String,
    /// ISO 8601, once completed or canceled.
    pub closed_at: Option<String>,
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
    /// The assignee's user id, which is compared with the viewer's.
    pub assignee: Option<String>,
    /// The assignee's display name, as the Board shows it.
    pub assignee_name: Option<String>,
    pub blockers: Vec<LinearBlocker>,
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
    /// When it was opened, ISO 8601 as GitHub gives it.
    pub created_at: String,
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
    /// When it merged, if it did.
    pub merged_at: Option<String>,
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

/// A named herdr agent with its Agent state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agent {
    pub name: String,
    pub state: AgentState,
}

/// An Agent state, as herdr names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Idle,
    Working,
    /// Waiting on a human: for an Implementer, Asking.
    Blocked,
    Done,
    /// None reported, or one this build does not know.
    #[serde(other)]
    Unknown,
}

impl From<&str> for AgentState {
    fn from(name: &str) -> Self {
        serde_json::from_value(Value::from(name)).unwrap_or(AgentState::Unknown)
    }
}

/// The Agent state herdr reports for the agent `name` among `agents`;
/// `None` when it has no such agent.
pub fn agent_state(agents: &[Agent], name: &str) -> Option<AgentState> {
    (agents.iter()).find(|a| a.name == name).map(|a| a.state)
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
    /// Bytes: a file served from the Bucket may be an image.
    pub body: Vec<u8>,
}

/// One headless, read-only call of a Harness: `command` with `args`, then
/// `prompt` as its last argument, with `env` set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Headless {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub prompt: String,
}

/// What a headless call answered, and the session to correct it in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answered {
    pub text: String,
    pub session: String,
}

/// What a call of [`World::harness_headless`] did: started, or answered,
/// well or not.
pub enum Called {
    Started,
    Answered,
}

/// What `serve` answers a request with.
pub enum Answer {
    /// One response, sent whole.
    Whole(HttpResponse),
    /// A server-sent-events stream, open till the client leaves: every
    /// `every`, `poll` says what to send, if anything.
    Events { every: Duration, poll: Poll },
}

/// What an event stream sends at a poll, given the World of its thread.
pub type Poll = Box<dyn FnMut(&dyn World) -> String>;

/// What answers each request `serve` takes, in the World of the thread taking it.
pub type Handler = Box<dyn Fn(&dyn World, &HttpRequest) -> Answer + Send + Sync>;

pub trait World {
    // git
    /// Remote URLs of the git clone at `path`, or `None` if it isn't one.
    fn git_remotes(&self, path: &str) -> WorldResult<Option<Vec<String>>>;
    /// Fetch origin, or a head branch into its origin tracking ref.
    fn git_fetch(&self, path: &str, branch: Option<&str>) -> WorldResult<()>;
    /// The default branch of the clone's origin, without the remote prefix.
    fn git_default_branch(&self, path: &str) -> WorldResult<String>;
    /// Make the folder `path`, and its parents, an empty git repo.
    fn git_init(&self, path: &str) -> WorldResult<()>;
    /// Commit what `add`, a path in the clone at `path`, holds, new files
    /// included, if it is there; even when nothing changed.
    fn git_commit(&self, path: &str, add: &str, message: &str) -> WorldResult<()>;
    /// Commit the removal of `file`, a path in the clone at `path`, with
    /// `message`: gone from its files, kept in its history.
    fn git_remove(&self, path: &str, file: &str, message: &str) -> WorldResult<()>;
    /// Whether what `folder`, a path in the clone at `path`, holds is not its
    /// last commit's: a file new, changed or staged in it.
    fn git_changed(&self, path: &str, folder: &str) -> WorldResult<bool>;
    /// Whether origin answers the clone at `path` without asking anything: a
    /// key not loaded fails at once rather than waiting on its passphrase.
    fn git_ls_remote(&self, path: &str) -> WorldResult<()>;
    /// What `file` holds at `rev` in the clone at `path`; `None` when it has no such file.
    fn git_show(&self, path: &str, rev: &str, file: &str) -> WorldResult<Option<String>>;
    /// The names of what the folder `folder` holds at `rev` in the clone at
    /// `path`; none when it has no such folder.
    fn git_ls_tree(&self, path: &str, rev: &str, folder: &str) -> WorldResult<Vec<String>>;
    /// The branch the clone at `path` is on; empty when its HEAD is detached.
    fn git_branch(&self, path: &str) -> WorldResult<String>;
    /// The changes to tracked files in the clone at `path`, a line each as
    /// `git status --porcelain` lists them; none when it has none.
    fn git_tracked_changes(&self, path: &str) -> WorldResult<Vec<String>>;
    /// Pull the clone's branch fast-forward only, failing at once rather
    /// than asking for a passphrase.
    fn git_pull(&self, path: &str) -> WorldResult<()>;
    /// The commit `rev` names in the clone at `path`: `HEAD`, the one it is on.
    fn git_rev(&self, path: &str, rev: &str) -> WorldResult<String>;
    /// Check `rev` of the clone at `path` out in the folder `dir`, a worktree
    /// of it on no branch.
    fn git_worktree_add(&self, path: &str, dir: &str, rev: &str) -> WorldResult<()>;
    /// Remove the clone at `path`'s worktree in the folder `dir`, changes and
    /// all; no-op when there is none.
    fn git_worktree_remove(&self, path: &str, dir: &str) -> WorldResult<()>;
    /// Each file at `rev` in the clone at `path`, every folder down, as its
    /// path and its blob; no symlink nor submodule.
    fn git_ls_tree_blobs(&self, path: &str, rev: &str) -> WorldResult<Vec<(String, String)>>;
    /// How many commits `to` holds that `from` does not, in the clone at `path`.
    fn git_rev_count(&self, path: &str, from: &str, to: &str) -> WorldResult<usize>;
    /// Fetch the tag `tag` of `url`, its commit alone, into the bare repo at
    /// `path`, made first if missing: one kept across fetches, with the
    /// user's own git credentials.
    fn git_fetch_tag(&self, path: &str, url: &str, tag: &str) -> WorldResult<()>;

    // Harnesses
    /// Make each of `calls` in the folder `cwd`, with no input, up to
    /// `at_once` of them at a time, `told` of each, by its place in `calls`,
    /// as it starts and as it answers: the last message each answered, and
    /// its session, in order.
    /// opencode's, claude's and codex's JSON output is read.
    fn harness_headless(
        &self,
        cwd: &str,
        calls: &[Headless],
        at_once: usize,
        told: &mut dyn FnMut(usize, Called),
    ) -> Vec<WorldResult<Answered>>;

    // Ollama
    /// The embedding of each of `input`, in order, by the `model` of the
    /// Ollama answering at `ollama`, through its `/api/embed`.
    fn ollama_embed(
        &self,
        ollama: &str,
        model: &str,
        input: &[String],
    ) -> WorldResult<Vec<Vec<f32>>>;

    // shell
    /// Run `command` with `sh -c` in the folder `cwd`, with no input, showing
    /// what it prints on stderr as it prints it, so stdout stays the
    /// command's own: whether it succeeded, and what it printed, stdout and
    /// stderr as they came.
    fn shell(&self, cwd: &str, command: &str) -> WorldResult<(bool, String)>;

    // files outside the config directory: worktrees, the Bucket
    /// Copy the files [`World::list_files`] lists under the folder `from`
    /// into the folder `to`; nothing when `from` is missing.
    fn copy_dir(&self, from: &str, to: &str) -> WorldResult<()>;
    /// Write a file, making its folders.
    fn write_file(&self, path: &str, contents: &[u8]) -> WorldResult<()>;
    /// What a file holds; `None` when there is no file at `path`.
    fn read_file(&self, path: &str) -> WorldResult<Option<Vec<u8>>>;
    /// Every file under the folder `path`, by its path from there, sorted,
    /// without symlinks nor git's `.git`; none when there is no such folder.
    fn list_files(&self, path: &str) -> WorldResult<Vec<String>>;
    /// Whether the folder `dir` (`~/` the home directory) holds the skill
    /// `name`: its `<name>/SKILL.md`, through symlinks.
    fn has_skill(&self, dir: &str, name: &str) -> bool;

    // gh
    /// Login of the user's own GitHub session.
    fn github_viewer(&self) -> WorldResult<String>;
    /// Open `ready-for-agent` issues of a repo; the core still applies the Ready rule.
    fn github_issues(&self, slug: &str) -> WorldResult<Vec<GitHubIssue>>;
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
    /// Mark a draft PR ready for review (the flip): the one write to a PR,
    /// which never merges, approves or comments.
    fn github_pr_ready(&self, slug: &str, number: u64) -> WorldResult<()>;

    // Linear
    fn linear_viewer(&self) -> WorldResult<String>;
    fn linear_issues(&self, team: &str) -> WorldResult<Vec<LinearIssue>>;
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
    /// Whether herdr still has the pane: one closed, or whose shell exited, is gone.
    fn herdr_pane_exists(&self, pane: &str) -> WorldResult<bool>;
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
    /// Open a workspace on the folder `cwd`, with no worktree, without focusing it.
    fn herdr_workspace_create(&self, cwd: &str, label: &str) -> WorldResult<String>;

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
    /// Answer HTTP on 127.0.0.1:`port` with `handler`, a thread per request,
    /// while this thread goes on; fails when the port cannot be taken.
    fn listen(&self, port: u16, handler: Handler) -> WorldResult<()>;

    // stdio
    /// The next line on stdin, without its line ending; `None` once stdin is closed.
    fn read_line(&self) -> WorldResult<Option<String>>;
    /// Write `line` and a newline to stdout, at once.
    fn write_line(&self, line: &str) -> WorldResult<()>;

    // log
    /// Write a line to `serve`'s log: stderr, which journald keeps for a service.
    fn log(&self, line: &str);

    // clock, timers, process
    fn now(&self) -> SystemTime;
    /// Run `task` every `interval`, each run `interval` after the last one
    /// ended; the real World never returns.
    fn every(&self, interval: Duration, task: &mut dyn FnMut());
    fn process_id(&self) -> u32;
    fn process_alive(&self, pid: u32) -> bool;
    /// This boot of the machine: a pid from another boot is another process.
    fn boot_id(&self) -> String;
    /// How far local time is ahead of UTC now, in seconds.
    fn utc_offset(&self) -> i64;
}

/// Read one HTTP/1.1 request from `stream`, answer it with `handler`, close.
fn answer(world: &RealWorld, handler: &Handler, mut stream: TcpStream) -> io::Result<()> {
    // A client that never finishes its request does not hold a thread.
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let request = {
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let mut words = line.split_whitespace().map(String::from);
        let (method, url) = (
            words.next().unwrap_or_default(),
            words.next().unwrap_or_default(),
        );
        let mut headers = vec![];
        loop {
            line.clear();
            reader.read_line(&mut line)?;
            let Some((name, value)) = line.split_once(':') else {
                break;
            };
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
        let length = (headers.iter())
            .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.parse().ok())
            .unwrap_or(0usize);
        let mut body = vec![0; length.min(1 << 20)];
        reader.read_exact(&mut body)?;
        HttpRequest {
            method,
            url,
            headers,
            body: String::from_utf8_lossy(&body).into(),
        }
    };
    match handler(world, &request) {
        Answer::Whole(response) => {
            let head: String = (response.headers.iter())
                .map(|(name, value)| format!("{name}: {value}\r\n"))
                .collect();
            let length = response.body.len();
            write!(
                stream,
                "HTTP/1.1 {} \r\n{head}Content-Length: {length}\r\nConnection: close\r\n\r\n",
                response.status
            )?;
            stream.write_all(&response.body)
        }
        Answer::Events { every, mut poll } => {
            stream.write_all(b"HTTP/1.1 200 \r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n")?;
            // Waiting to read is the timer: a read that times out is the next
            // poll, and an end of the stream is the client gone.
            stream.set_read_timeout(Some(every))?;
            loop {
                match stream.read(&mut [0; 512]) {
                    Ok(0) => return Ok(()),
                    Ok(_) => {}
                    Err(e)
                        if matches!(
                            e.kind(),
                            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                        ) =>
                    {
                        stream.write_all(poll(world).as_bytes())?
                    }
                    Err(e) => return Err(e),
                }
            }
        }
    }
}

/// Send a request to a service nico-agent doesn't run; any status is a
/// response. The headers go on `curl`'s stdin: on its command line, any
/// user's `ps` would show an API key.
fn curl(request: &HttpRequest) -> WorldResult<HttpResponse> {
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

/// How long an outside call may run before it is killed: long enough for a
/// slow fetch, short enough that one hung call can't stop the night.
const DEADLINE: Duration = Duration::from_secs(300);

/// [`DEADLINE`], or `NICO_AGENT_DEADLINE_SECS` when set: no user setting, but
/// a test's stub that hangs shouldn't hold it for minutes.
fn deadline() -> Duration {
    (std::env::var("NICO_AGENT_DEADLINE_SECS").ok())
        .and_then(|secs| secs.parse().ok())
        .map_or(DEADLINE, Duration::from_secs)
}

/// Run `command` to its end, as `output()` does, or kill it once `deadline`
/// passes and fail naming it as `shown`; `failed` words a failure to start it.
fn run_till(
    command: &mut Command,
    deadline: Duration,
    shown: &str,
    failed: impl FnOnce(io::Error) -> WorldError,
) -> WorldResult<Output> {
    use std::os::unix::process::CommandExt;
    let started = Instant::now();
    // In a group of its own, so a kill reaches what it started too (git's ssh).
    let mut child = (command.stdout(Stdio::piped()).stderr(Stdio::piped()))
        .process_group(0)
        .spawn()
        .map_err(failed)?;
    // Read as it prints: a child that fills a pipe would never end.
    let (stdout, stderr) = (drain(child.stdout.take()), drain(child.stderr.take()));
    let past = || {
        WorldError(format!(
            "`{shown}` ran past its {}s deadline and was killed",
            deadline.as_secs()
        ))
    };
    let status = loop {
        if let Ok(Some(status)) = child.try_wait() {
            break status;
        }
        if started.elapsed() >= deadline {
            let group = format!("-{}", child.id());
            let killed = Command::new("kill").args(["-KILL", "--", &group]).status();
            if !killed.is_ok_and(|s| s.success()) {
                let _ = child.kill();
            }
            let _ = child.wait();
            return Err(past());
        }
        thread::sleep(Duration::from_millis(10));
    };
    // A process it left in the background may hold its pipes past its end;
    // a second's grace, so one that ends right at its deadline still answers.
    let read = |pipe: mpsc::Receiver<Vec<u8>>| {
        (pipe.recv_timeout(deadline.saturating_sub(started.elapsed()) + Duration::from_secs(1)))
            .map_err(|_| past())
    };
    Ok(Output {
        status,
        stdout: read(stdout)?,
        stderr: read(stderr)?,
    })
}

/// All of `pipe`, read on its own thread.
fn drain(pipe: Option<impl Read + Send + 'static>) -> mpsc::Receiver<Vec<u8>> {
    let (sent, read) = mpsc::channel();
    let mut pipe = pipe.expect("the pipe is piped");
    thread::spawn(move || {
        let mut all = vec![];
        let _ = pipe.read_to_end(&mut all);
        let _ = sent.send(all);
    });
    read
}

/// The World of the running binary.
pub struct RealWorld {
    /// Where `secrets.env` may hold the Linear API key.
    pub config_dir: PathBuf,
}

/// Run `gh` (or `ghbot`, its bot twin) with prompts and colors off: whether
/// it succeeded, its stdout and stderr.
fn gh_run(bin: &str, args: &[String]) -> WorldResult<(bool, String, String)> {
    let shown = format!(
        "{bin} {}",
        args.iter().take(2).cloned().collect::<Vec<_>>().join(" ")
    );
    let ran = run_till(
        Command::new(bin)
            .args(args)
            .env("GH_PROMPT_DISABLED", "1")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null()),
        deadline(),
        &shown,
        |_| WorldError(format!("`{bin}` is not installed or not on PATH")),
    )?;
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
        blockedBy(first: 50) { nodes { number title state closedAt repository { nameWithOwner } } }
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
    sub_issues_summary: Total,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NumberedNode {
    number: u64,
    title: String,
    state: String,
    closed_at: Option<String>,
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
                    title: b.title,
                    state: issue_state(&b.state),
                    closed_at: b.closed_at,
                })
                .collect(),
            has_sub_issues: node.sub_issues_summary.total > 0,
        }
    }
}

const LINKED_PRS_QUERY: &str = "query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 20) {
        nodes { number url state baseRefName headRefName createdAt headRepository { nameWithOwner } repository { nameWithOwner } }
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
    created_at: String,
    head_repository: Option<Repository>,
    repository: Repository,
}

/// The fields `gh pr view` and `gh pr list` give a PR by.
const LISTED_PR_FIELDS: &str =
    "number,url,state,baseRefName,headRefName,isCrossRepository,createdAt";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListedPr {
    number: u64,
    url: String,
    state: String,
    base_ref_name: String,
    head_ref_name: String,
    is_cross_repository: bool,
    created_at: String,
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
            created_at: self.created_at,
        }
    }
}

/// Run `git -C <dir> <args>`: whether it succeeded, and what it printed.
fn git(dir: &Path, args: &[&str]) -> WorldResult<(bool, String)> {
    let ran = run_till(
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .stdin(Stdio::null()),
        deadline(),
        &format!("git {}", args.join(" ")),
        |e| WorldError(format!("could not run git: {e}")),
    )?;
    Ok((
        ran.status.success(),
        String::from_utf8_lossy(&ran.stdout).into_owned(),
    ))
}

/// ssh that fails at once rather than asking for a passphrase; ConnectTimeout:
/// an unreachable origin does not hold serve's start, which checks it.
const BATCH_SSH: (&str, &str) = (
    "GIT_SSH_COMMAND",
    "ssh -o BatchMode=yes -o ConnectTimeout=10",
);

/// Run `git -C <path> <args>`, never prompting: what it printed, trimmed, or
/// its failure with git's first line about it.
fn git_ok(path: &str, args: &[&str]) -> WorldResult<String> {
    git_env(path, args, &[])
}

/// [`git_ok`] with `env` set too.
fn git_env(path: &str, args: &[&str], env: &[(&str, &str)]) -> WorldResult<String> {
    let ran = run_till(
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .envs(env.iter().copied())
            .stdin(Stdio::null()),
        deadline(),
        &format!("git {}", args.join(" ")),
        |e| WorldError(format!("could not run git: {e}")),
    )?;
    if ran.status.success() {
        return Ok(String::from_utf8_lossy(&ran.stdout).trim().into());
    }
    let reason = first_line(&ran.stderr, &ran.status);
    Err(WorldError(format!(
        "`git {}` failed in {path}: {reason}",
        args.join(" ")
    )))
}

/// Copy the files under `from` into `to`, as [`list_tree`] finds them:
/// symlinks, which would point back into the worktree, skipped.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let mut files = vec![];
    list_tree(from, Path::new(""), &mut files)?;
    for file in files {
        let target = to.join(&file);
        target.parent().map_or(Ok(()), fs::create_dir_all)?;
        fs::copy(from.join(&file), target)?;
    }
    Ok(())
}

/// Push the files under `dir` onto `files`, each after `under`; none of git's
/// (`.git`, a folder or a worktree's file), nor a symlink.
fn list_tree(dir: &Path, under: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    use io::ErrorKind::{NotADirectory, NotFound};
    let entries = match fs::read_dir(dir) {
        Err(e) if matches!(e.kind(), NotFound | NotADirectory) => return Ok(()),
        entries => entries?,
    };
    for entry in entries {
        let entry = entry?;
        let (name, kind) = (under.join(entry.file_name()), entry.file_type()?);
        if entry.file_name() == ".git" {
            continue;
        } else if kind.is_dir() {
            list_tree(&entry.path(), &name, files)?;
        } else if kind.is_file() {
            files.push(name);
        }
    }
    Ok(())
}

/// `path` with a leading `~/` the home directory.
fn home(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => std::env::home_dir().unwrap_or_default().join(rest),
        None => PathBuf::from(path),
    }
}

/// A failed command's first line on stderr, else its exit status.
fn first_line(stderr: &[u8], status: &std::process::ExitStatus) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    (stderr.lines().map(str::trim).find(|l| !l.is_empty()))
        .map_or_else(|| status.to_string(), String::from)
}

/// A headless model call reads a code base and writes a whole Wiki page.
const HEADLESS_DEADLINE: Duration = Duration::from_secs(3600);

/// Make one headless call of a Harness in `cwd`: the text of its last
/// message, with its session, or the error it reported, read from the JSON
/// lines it printed: opencode's events (`--format json`), codex's (`--json`)
/// or claude's one result (`--output-format json`), its structured output
/// when a schema asked for one.
fn headless(cwd: &str, call: &Headless) -> WorldResult<Answered> {
    let command = format!(
        "{} {}",
        call.command,
        call.args.first().map_or("", String::as_str)
    );
    // shortcut: the prompt is one argument, which Linux caps at 128 KiB (a top part of some 2,800 files); send it on stdin for a code base that big.
    let ran = run_till(
        Command::new(&call.command)
            .args(&call.args)
            .arg(&call.prompt)
            .envs(call.env.iter().map(|(name, value)| (name, value)))
            .current_dir(cwd)
            // With an input open it waits on it, and never answers.
            .stdin(Stdio::null()),
        HEADLESS_DEADLINE,
        &command,
        |e| WorldError(format!("could not run `{command}` in {cwd}: {e}")),
    )?;
    let events: Vec<Value> = (String::from_utf8_lossy(&ran.stdout).lines())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let last = |read: &dyn Fn(&Value) -> Option<String>| events.iter().rev().find_map(read);
    let text = last(&|event| match event["type"].as_str()? {
        "text" => event["part"]["text"].as_str().map(String::from),
        // codex's other items are its commands, and its warnings.
        "item.completed" if event["item"]["type"] == "agent_message" => {
            event["item"]["text"].as_str().map(String::from)
        }
        "result" if event["is_error"] == false => match &event["structured_output"] {
            Value::Null => event["result"].as_str().map(String::from),
            output => Some(output.to_string()),
        },
        _ => None,
    });
    if let Some(text) = text
        && ran.status.success()
    {
        let session = (events.iter())
            .find_map(|event| {
                (["sessionID", "thread_id", "session_id"].iter())
                    .find_map(|key| event[key].as_str())
            })
            .ok_or_else(|| WorldError(format!("`{command}` failed: it named no session")))?;
        let session = session.into();
        return Ok(Answered { text, session });
    }
    let why = last(&|event| {
        let why = match event["type"].as_str()? {
            "error" => event["error"]["message"]
                .as_str()
                .or(event["message"].as_str()),
            "turn.failed" => event["error"]["message"].as_str(),
            "result" => event["result"].as_str(),
            _ => None,
        };
        why.map(String::from)
    })
    .or_else(|| (!ran.status.success()).then(|| first_line(&ran.stderr, &ran.status)))
    .unwrap_or_else(|| "it answered nothing".into());
    Err(WorldError(format!("`{command}` failed: {why}")))
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
    herdr_till(args, deadline())
}

/// [`herdr_text`], killed once `deadline` passes.
fn herdr_till(args: &[&str], deadline: Duration) -> Result<String, HerdrFailure> {
    let command = args[..args.len().min(2)].join(" ");
    let ran = run_till(
        Command::new("herdr").args(args).stdin(Stdio::null()),
        deadline,
        &format!("herdr {command}"),
        |_| WorldError("`herdr` is not installed or not on PATH".into()),
    )
    .map_err(|error| HerdrFailure { code: None, error })?;
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
        git_env(path, &args, &[BATCH_SSH]).map(drop)
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
    fn git_init(&self, path: &str) -> WorldResult<()> {
        fs::create_dir_all(path).map_err(|e| WorldError(format!("could not make {path}: {e}")))?;
        git_ok(path, &["init", "--quiet"]).map(drop)
    }
    /// Unsigned, as nico-agent: a service has no one to unlock a signing key, and the
    /// machine may have no git identity at all.
    fn git_commit(&self, path: &str, add: &str, message: &str) -> WorldResult<()> {
        // git refuses to add a path that is not there: a Verdict with no Evidence nor findings.
        if Path::new(path).join(add).exists() {
            git_ok(path, &["add", "--", add])?;
        }
        let commit = [
            "-c",
            "user.name=nico-agent",
            "-c",
            "user.email=nico-agent@localhost",
            "commit",
            "--quiet",
            "--allow-empty",
            "--no-gpg-sign",
        ];
        git_ok(path, &[&commit[..], &["-m", message]].concat()).map(drop)
    }
    fn git_remove(&self, path: &str, file: &str, message: &str) -> WorldResult<()> {
        git_ok(path, &["rm", "--quiet", "-r", "--", file])?;
        self.git_commit(path, file, message)
    }
    fn git_changed(&self, path: &str, folder: &str) -> WorldResult<bool> {
        git_ok(path, &["status", "--porcelain", "--", folder]).map(|out| !out.is_empty())
    }
    fn git_ls_remote(&self, path: &str) -> WorldResult<()> {
        git_env(path, &["ls-remote", "origin"], &[BATCH_SSH]).map(drop)
    }
    fn git_show(&self, path: &str, rev: &str, file: &str) -> WorldResult<Option<String>> {
        // Lists nothing for a file `rev` lacks; fails for a `rev` the clone lacks.
        if git_ok(path, &["ls-tree", "--name-only", rev, "--", file])?.is_empty() {
            return Ok(None);
        }
        git_ok(path, &["show", &format!("{rev}:{file}")]).map(Some)
    }
    fn git_ls_tree(&self, path: &str, rev: &str, folder: &str) -> WorldResult<Vec<String>> {
        let folder = format!("{folder}/");
        let listed = git_ok(path, &["ls-tree", "--name-only", rev, &folder])?;
        Ok((listed.lines())
            .map(|name| name.strip_prefix(&folder).unwrap_or(name).to_string())
            .collect())
    }
    fn git_branch(&self, path: &str) -> WorldResult<String> {
        git_ok(path, &["branch", "--show-current"])
    }
    fn git_tracked_changes(&self, path: &str) -> WorldResult<Vec<String>> {
        let listed = git_ok(path, &["status", "--porcelain", "--untracked-files=no"])?;
        Ok(listed.lines().map(|line| line.trim().to_string()).collect())
    }
    fn git_pull(&self, path: &str) -> WorldResult<()> {
        git_env(path, &["pull", "--ff-only"], &[BATCH_SSH]).map(drop)
    }
    fn git_rev(&self, path: &str, rev: &str) -> WorldResult<String> {
        git_ok(path, &["rev-parse", rev])
    }
    fn git_worktree_add(&self, path: &str, dir: &str, rev: &str) -> WorldResult<()> {
        git_ok(path, &["worktree", "add", "--detach", "--quiet", dir, rev]).map(drop)
    }
    fn git_worktree_remove(&self, path: &str, dir: &str) -> WorldResult<()> {
        // Forgets one whose folder is gone too; with no folder, none is no worktree to remove.
        match git_ok(path, &["worktree", "remove", "--force", dir]) {
            Err(_) if !Path::new(dir).exists() => Ok(()),
            removed => removed.map(drop),
        }
    }
    fn git_ls_tree_blobs(&self, path: &str, rev: &str) -> WorldResult<Vec<(String, String)>> {
        // `-z`: paths as they are, never quoted.
        let listed = git_ok(path, &["ls-tree", "-r", "-z", rev])?;
        Ok((listed.split('\0'))
            .filter_map(|entry| {
                let (about, file) = entry.split_once('\t')?;
                match about.split(' ').collect::<Vec<_>>()[..] {
                    [mode, "blob", blob] if mode != "120000" => Some((file.into(), blob.into())),
                    _ => None,
                }
            })
            .collect())
    }
    fn git_rev_count(&self, path: &str, from: &str, to: &str) -> WorldResult<usize> {
        let counted = git_ok(path, &["rev-list", "--count", &format!("{from}..{to}")])?;
        (counted.parse())
            .map_err(|e| WorldError(format!("git rev-list --count printed {counted:?}: {e}")))
    }
    fn git_fetch_tag(&self, path: &str, url: &str, tag: &str) -> WorldResult<()> {
        fs::create_dir_all(path).map_err(|e| WorldError(format!("could not make {path}: {e}")))?;
        // Again on a bare repo, it only says so: its objects stay.
        git_ok(path, &["init", "--bare", "--quiet"])?;
        let refspec = format!("+refs/tags/{tag}:refs/tags/{tag}");
        let fetch = ["fetch", "--quiet", "--depth", "1", url, &refspec];
        git_env(path, &fetch, &[BATCH_SSH]).map(drop)
    }
    fn harness_headless(
        &self,
        cwd: &str,
        calls: &[Headless],
        at_once: usize,
        told: &mut dyn FnMut(usize, Called),
    ) -> Vec<WorldResult<Answered>> {
        let next = AtomicUsize::new(0);
        let mut answered: Vec<(usize, WorldResult<Answered>)> = thread::scope(|scope| {
            // Each worker says when a call starts (no answer yet) and when it answers.
            let (said, heard) = mpsc::channel();
            for _ in 0..at_once.clamp(1, calls.len().max(1)) {
                let (said, next) = (said.clone(), &next);
                scope.spawn(move || {
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(call) = calls.get(i) else {
                            return;
                        };
                        // Heard till the last answer: the receiving end outlives every worker.
                        let _ = said.send((i, None));
                        let _ = said.send((i, Some(headless(cwd, call))));
                    }
                });
            }
            drop(said);
            (heard.into_iter())
                .filter_map(|(i, answer)| match answer {
                    None => {
                        told(i, Called::Started);
                        None
                    }
                    Some(answer) => {
                        told(i, Called::Answered);
                        Some((i, answer))
                    }
                })
                .collect()
        });
        answered.sort_by_key(|(i, _)| *i);
        answered.into_iter().map(|(_, answer)| answer).collect()
    }
    fn ollama_embed(
        &self,
        ollama: &str,
        model: &str,
        input: &[String],
    ) -> WorldResult<Vec<Vec<f32>>> {
        #[derive(Deserialize)]
        struct Embedded {
            embeddings: Vec<Vec<f32>>,
        }
        let url = format!("{}/api/embed", ollama.trim_end_matches('/'));
        let response = curl(&HttpRequest {
            method: "POST".into(),
            url: url.clone(),
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: json!({ "model": model, "input": input }).to_string(),
        })?;
        if response.status != 200 {
            let said = String::from_utf8_lossy(&response.body);
            let status = response.status;
            return Err(WorldError(format!(
                "{url} answered {status}: {}",
                said.trim()
            )));
        }
        let read: Embedded = (serde_json::from_slice(&response.body).ok())
            .filter(|read: &Embedded| read.embeddings.len() == input.len())
            .ok_or_else(|| invalid(&url))?;
        Ok(read.embeddings)
    }
    fn shell(&self, cwd: &str, command: &str) -> WorldResult<(bool, String)> {
        let failed = |e: io::Error| WorldError(format!("could not run `{command}` in {cwd}: {e}"));
        let (mut reader, writer) = io::pipe().map_err(failed)?;
        // Our ends of the pipe go with the Command: the reads below end when its process does.
        let mut child = Command::new("sh")
            .args(["-c", command])
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(writer.try_clone().map_err(failed)?)
            .stderr(writer)
            .spawn()
            .map_err(failed)?;
        // shortcut: no deadline, as a Repo's checks may rightly run long; give it one if one ever hangs `install`.
        // shortcut: a process it leaves in the background holding the pipe holds this till it ends; none we run does.
        let (mut printed, mut chunk, mut shown) = (vec![], [0; 8192], io::stderr());
        loop {
            let n = reader.read(&mut chunk).map_err(failed)?;
            if n == 0 {
                break;
            }
            // Shown is for whoever watches; a closed terminal stops nothing.
            let _ = shown.write_all(&chunk[..n]).and_then(|()| shown.flush());
            printed.extend_from_slice(&chunk[..n]);
        }
        let status = child.wait().map_err(failed)?;
        Ok((status.success(), String::from_utf8_lossy(&printed).into()))
    }
    fn copy_dir(&self, from: &str, to: &str) -> WorldResult<()> {
        copy_tree(Path::new(from), Path::new(to))
            .map_err(|e| WorldError(format!("could not copy {from} to {to}: {e}")))
    }
    fn write_file(&self, path: &str, contents: &[u8]) -> WorldResult<()> {
        let path = Path::new(path);
        (path.parent().map_or(Ok(()), fs::create_dir_all))
            .and_then(|()| fs::write(path, contents))
            .map_err(|e| WorldError(format!("could not write {}: {e}", path.display())))
    }
    fn read_file(&self, path: &str) -> WorldResult<Option<Vec<u8>>> {
        use io::ErrorKind::{IsADirectory, NotADirectory, NotFound};
        match fs::read(home(path)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if matches!(e.kind(), NotFound | IsADirectory | NotADirectory) => Ok(None),
            Err(e) => Err(WorldError(format!("could not read {path}: {e}"))),
        }
    }
    fn list_files(&self, path: &str) -> WorldResult<Vec<String>> {
        let mut files = vec![];
        list_tree(Path::new(path), Path::new(""), &mut files)
            .map_err(|e| WorldError(format!("could not list {path}: {e}")))?;
        let mut files: Vec<String> = (files.iter())
            .map(|f| f.to_string_lossy().into_owned())
            .collect();
        files.sort();
        Ok(files)
    }
    fn has_skill(&self, dir: &str, name: &str) -> bool {
        home(dir).join(name).join("SKILL.md").is_file()
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
                    created_at: pr.created_at,
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
            merged_at: Option<String>,
        }
        let number = number.to_string();
        let fields = "state,isDraft,headRefOid,baseRefName,mergeable,updatedAt,mergedAt";
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
            merged_at: viewed.merged_at,
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
    fn github_pr_ready(&self, slug: &str, number: u64) -> WorldResult<()> {
        let number = number.to_string();
        let args = ["pr", "ready", &number, "--repo", slug];
        gh(&args.map(String::from)).map(drop)
    }
    fn linear_viewer(&self) -> WorldResult<String> {
        linear::viewer(self)
    }
    fn linear_issues(&self, team: &str) -> WorldResult<Vec<LinearIssue>> {
        linear::issues(self, team)
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
    fn herdr_pane_exists(&self, pane: &str) -> WorldResult<bool> {
        match herdr(&["pane", "get", pane]) {
            Ok(_) => Ok(true),
            Err(failure) if failure.is(&["pane_not_found"]) => Ok(false),
            Err(failure) => Err(failure.into()),
        }
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
            std::thread::sleep(Duration::from_millis(250));
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
                    state: a["agent_status"].as_str().unwrap_or_default().into(),
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
        let millis = timeout.as_millis().to_string();
        let mut all = vec!["agent", "wait", name];
        for state in states {
            all.extend(["--until", state]);
        }
        all.extend(["--timeout", &millis]);
        // herdr gives up at its own --timeout; this is in case herdr itself hangs.
        herdr_till(&all, timeout + deadline())?;
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
    fn herdr_workspace_create(&self, cwd: &str, label: &str) -> WorldResult<String> {
        let args = [
            "workspace",
            "create",
            "--cwd",
            cwd,
            "--label",
            label,
            "--no-focus",
        ];
        let result = herdr(&args)?;
        herdr_str(&result["workspace"]["workspace_id"])
    }
    fn opencode_save_variant(
        &self,
        file: &str,
        model: &str,
        effort: Option<&str>,
    ) -> WorldResult<()> {
        let file = home(file);
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
        let ran = run_till(
            Command::new("notify-send")
                .args(["--app-name", "nico-agent", "--", title, body])
                .stdin(Stdio::null()),
            deadline(),
            "notify-send",
            |_| WorldError("`notify-send` is not installed or not on PATH".into()),
        )?;
        if ran.status.success() {
            return Ok(());
        }
        let reason = first_line(&ran.stderr, &ran.status);
        Err(WorldError(format!("`notify-send` failed: {reason}")))
    }
    fn listen(&self, port: u16, handler: Handler) -> WorldResult<()> {
        let listener = TcpListener::bind(("127.0.0.1", port))
            .map_err(|e| WorldError(format!("could not listen on 127.0.0.1:{port}: {e}")))?;
        let (handler, config_dir) = (Arc::new(handler), self.config_dir.clone());
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let handler = Arc::clone(&handler);
                let world = RealWorld {
                    config_dir: config_dir.clone(),
                };
                // A client that left mid-answer is no one to tell.
                thread::spawn(move || answer(&world, &handler, stream).ok());
            }
        });
        Ok(())
    }
    fn read_line(&self) -> WorldResult<Option<String>> {
        let mut line = vec![];
        match io::stdin().lock().read_until(b'\n', &mut line) {
            Ok(0) => Ok(None),
            // Bytes that are no UTF-8 make a line that does not parse, not a read that fails.
            Ok(_) => Ok(Some(
                String::from_utf8_lossy(&line)
                    .trim_end_matches(['\n', '\r'])
                    .into(),
            )),
            Err(e) => Err(WorldError(format!("could not read stdin: {e}"))),
        }
    }
    fn write_line(&self, line: &str) -> WorldResult<()> {
        let mut out = io::stdout().lock();
        (writeln!(out, "{line}").and_then(|()| out.flush()))
            .map_err(|e| WorldError(format!("could not write stdout: {e}")))
    }
    fn log(&self, line: &str) {
        eprintln!("{line}");
    }
    fn now(&self) -> SystemTime {
        SystemTime::now()
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
    fn boot_id(&self) -> String {
        let id = fs::read_to_string("/proc/sys/kernel/random/boot_id");
        id.unwrap_or_default().trim().into()
    }
    /// `date +%z`, e.g. `-0300`; UTC when it cannot say.
    fn utc_offset(&self) -> i64 {
        let ran = Command::new("date").arg("+%z").output();
        let zone = ran.map_or_else(
            |_| String::new(),
            |r| String::from_utf8_lossy(&r.stdout).into(),
        );
        let zone = zone.trim();
        let (sign, digits) = match zone.strip_prefix('-') {
            Some(digits) => (-1, digits),
            None => (1, zone.trim_start_matches('+')),
        };
        let (hours, minutes) = digits.split_at(digits.len().min(2));
        let (hours, minutes) = (hours.parse().unwrap_or(0), minutes.parse().unwrap_or(0));
        sign * (hours * 3600 + minutes * 60)
    }
}
