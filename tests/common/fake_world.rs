//! An in-memory World: issues, PRs and agents held here, every outside call
//! recorded in order as the command it stands for, in `main`'s shapes.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, SystemTime};

use nico_agent::world::*;

pub struct FakeWorld {
    /// Every outside call, in order.
    pub calls: RefCell<Vec<String>>,
    /// Calls that fail with a message, by a prefix of the recorded call.
    pub failures: RefCell<Vec<(String, String)>>,
    pub viewer: RefCell<String>,
    pub linear_user: RefCell<String>,
    /// Remotes of each clone, by path.
    pub clones: RefCell<HashMap<String, Vec<String>>>,
    /// Default branch of each clone's origin; `main` when unset.
    pub default_branches: RefCell<HashMap<String, String>>,
    /// GitHub issues, by slug.
    pub issues: RefCell<HashMap<String, Vec<GitHubIssue>>>,
    pub linear: RefCell<Vec<LinearIssue>>,
    pub linear_attachments: RefCell<HashMap<String, Vec<String>>>,
    /// Every PR GitHub knows.
    pub prs: RefCell<Vec<PullRequest>>,
    /// URLs of the PRs that close each issue, by `slug#N`.
    pub linked: RefCell<HashMap<String, Vec<String>>>,
    /// What `github_pull_request_activity` reports, by `slug#N`; when unset, a
    /// draft in the PR's state that merges cleanly, on its base, with head
    /// `sha<N>`, last active now.
    pub activity: RefCell<HashMap<String, PullRequestActivity>>,
    /// PRs marked ready, by `slug#N`: never reported draft again.
    pub readied: RefCell<Vec<String>>,
    pub app_repos: RefCell<Vec<String>>,
    /// Agent state of each named agent, as `herdr agent list` reports it.
    pub agents: RefCell<BTreeMap<String, String>>,
    /// The pane each named agent runs in.
    pub agent_panes: RefCell<HashMap<String, String>>,
    /// What `herdr agent read` shows of each named agent.
    pub screens: RefCell<HashMap<String, String>>,
    /// The startup question the next agents started are blocked on, shown as
    /// their screen until keys are sent to one.
    pub blocked_screen: RefCell<Option<String>>,
    /// How many prompts from now on agents drop without starting work.
    pub stalled_prompts: Cell<u32>,
    /// Desktop notifications shown, as (title, body).
    pub notifications: RefCell<Vec<(String, String)>>,
    pub clock: Cell<SystemTime>,
    /// How many times `every` runs its task before it returns.
    pub timer_runs: Cell<u32>,
    /// What answers the requests `serve` listens for.
    pub listening: RefCell<Option<Handler>>,
    /// Log lines, each after the time it was written at.
    pub logged: RefCell<Vec<String>>,
    pub pid: Cell<u32>,
    pub dead_pids: RefCell<Vec<u32>>,
    /// This boot of the machine; a restart of it is a new one.
    pub boot: RefCell<String>,
    /// Files outside the config directory (worktrees, the Bucket), by path.
    pub files: RefCell<BTreeMap<String, Vec<u8>>>,
    /// How far local time is ahead of UTC, in seconds: 0, UTC, unless set.
    pub utc_offset: Cell<i64>,
    workspaces: Cell<u32>,
    tabs: RefCell<HashMap<String, u32>>,
}

impl Default for FakeWorld {
    fn default() -> Self {
        FakeWorld {
            calls: Default::default(),
            failures: Default::default(),
            viewer: RefCell::new("me".into()),
            linear_user: RefCell::new("linear-me".into()),
            clones: Default::default(),
            default_branches: Default::default(),
            issues: Default::default(),
            linear: Default::default(),
            linear_attachments: Default::default(),
            prs: Default::default(),
            linked: Default::default(),
            activity: Default::default(),
            readied: Default::default(),
            app_repos: Default::default(),
            agents: Default::default(),
            agent_panes: Default::default(),
            screens: Default::default(),
            blocked_screen: Default::default(),
            stalled_prompts: Default::default(),
            notifications: Default::default(),
            // 2026-09-30T12:00:00Z
            clock: Cell::new(SystemTime::UNIX_EPOCH + Duration::from_secs(1_790_769_600)),
            timer_runs: Cell::new(0),
            listening: Default::default(),
            logged: Default::default(),
            pid: Cell::new(4242),
            dead_pids: Default::default(),
            boot: RefCell::new("boot-1".into()),
            files: Default::default(),
            utc_offset: Cell::new(0),
            workspaces: Cell::new(0),
            tabs: Default::default(),
        }
    }
}

/// An open `ready-for-agent` issue of `slug`, unassigned and unblocked.
pub fn github_issue(slug: &str, number: u64) -> GitHubIssue {
    GitHubIssue {
        number,
        title: format!("Issue {number}"),
        url: format!("https://github.com/{slug}/issues/{number}"),
        created_at: "2026-09-01T00:00:00Z".into(),
        state: IssueState::Open,
        labels: vec!["ready-for-agent".into()],
        assignees: vec![],
        blockers: vec![],
        parent: None,
        has_sub_issues: false,
    }
}

/// An unstarted `ready-for-agent` issue of the BLE team.
pub fn linear_issue(identifier: &str) -> LinearIssue {
    LinearIssue {
        identifier: identifier.into(),
        title: identifier.into(),
        url: format!("https://linear.app/bleentr/issue/{identifier}/title"),
        branch_name: format!("nico/{}", identifier.to_lowercase()),
        created_at: "2026-09-01T00:00:00.000Z".into(),
        team: LinearTeam {
            id: "team-ble".into(),
            key: "BLE".into(),
            name: "Bleentr".into(),
        },
        project: None,
        labels: vec!["ready-for-agent".into()],
        state: "unstarted".into(),
        assignee: None,
        blockers: vec![],
        parent: None,
        has_sub_issues: false,
    }
}

/// An open PR of `slug` on `agent/pr-N`, against `main`.
pub fn pull_request(slug: &str, number: u64) -> PullRequest {
    PullRequest {
        repo: slug.into(),
        number,
        url: format!("https://github.com/{slug}/pull/{number}"),
        state: PrState::Open,
        base_branch: "main".into(),
        head_branch: Some(format!("agent/pr-{number}")),
    }
}

impl FakeWorld {
    /// The calls recorded so far, in order.
    pub fn calls(&self) -> Vec<String> {
        self.calls.borrow().clone()
    }

    /// Make every call recorded as starting with `prefix` fail with `message`.
    pub fn fail_call(&self, prefix: &str, message: &str) {
        self.failures
            .borrow_mut()
            .push((prefix.into(), message.into()));
    }

    pub fn clear_failures(&self) {
        self.failures.borrow_mut().clear();
    }

    pub fn add_clone(&self, path: &str, remotes: &[&str]) {
        self.clones
            .borrow_mut()
            .insert(path.into(), remotes.iter().map(|r| r.to_string()).collect());
    }

    pub fn add_issue(&self, slug: &str, issue: GitHubIssue) {
        self.issues
            .borrow_mut()
            .entry(slug.into())
            .or_default()
            .push(issue);
    }

    pub fn add_linear_issue(&self, issue: LinearIssue) {
        self.linear.borrow_mut().push(issue);
    }

    pub fn add_pr(&self, pr: PullRequest) {
        self.prs.borrow_mut().push(pr);
    }

    /// Add a PR that closes `slug#issue` when merged.
    pub fn link_pr(&self, slug: &str, issue: u64, pr: PullRequest) {
        self.linked
            .borrow_mut()
            .entry(format!("{slug}#{issue}"))
            .or_default()
            .push(pr.url.clone());
        self.add_pr(pr);
    }

    pub fn add_file(&self, path: &str, contents: &[u8]) {
        self.files.borrow_mut().insert(path.into(), contents.into());
    }

    pub fn logged(&self) -> Vec<String> {
        self.logged.borrow().clone()
    }

    /// Move the clock on by `by`.
    pub fn advance(&self, by: Duration) {
        self.clock.set(self.clock.get() + by);
    }

    fn call(&self, text: String) -> WorldResult<()> {
        let failure = self
            .failures
            .borrow()
            .iter()
            .find(|(prefix, _)| text.starts_with(prefix.as_str()))
            .map(|(_, m)| m.clone());
        self.calls.borrow_mut().push(text);
        failure.map_or(Ok(()), |message| Err(WorldError(message)))
    }

    fn pr(&self, slug: &str, number: u64) -> Option<PullRequest> {
        self.prs
            .borrow()
            .iter()
            .find(|pr| pr.repo == slug && pr.number == number)
            .cloned()
    }
}

impl World for FakeWorld {
    fn git_remotes(&self, path: &str) -> WorldResult<Option<Vec<String>>> {
        self.call(format!("git remotes {path}"))?;
        Ok(self.clones.borrow().get(path).cloned())
    }

    fn git_fetch(&self, path: &str, branch: Option<&str>) -> WorldResult<()> {
        let refspec = branch
            .map(|b| format!(" +refs/heads/{b}:refs/remotes/origin/{b}"))
            .unwrap_or_default();
        self.call(format!("git -C {path} fetch origin{refspec}"))
    }

    fn git_default_branch(&self, path: &str) -> WorldResult<String> {
        self.call(format!("git -C {path} default-branch"))?;
        Ok(self.git_default_branch_of(path))
    }

    /// The repo is a clone with no remotes from now on.
    fn git_init(&self, path: &str) -> WorldResult<()> {
        self.call(format!("git init {path}"))?;
        self.clones.borrow_mut().insert(path.into(), vec![]);
        Ok(())
    }

    fn git_commit(&self, path: &str, add: &str, message: &str) -> WorldResult<()> {
        self.call(format!(
            "git -C {path} add -- {add} && git -C {path} -c user.name=nico-agent -c user.email=nico-agent@localhost commit --quiet --allow-empty --no-gpg-sign -m {message}"
        ))
    }

    fn copy_dir(&self, from: &str, to: &str) -> WorldResult<()> {
        self.call(format!("cp -r {from}/. {to}"))?;
        let mut files = self.files.borrow_mut();
        let copies: Vec<(String, Vec<u8>)> = (files.iter())
            .filter_map(|(path, bytes)| {
                let rest = path.strip_prefix(&format!("{from}/"))?;
                let git = rest.split('/').any(|part| part == ".git");
                (!git).then(|| (format!("{to}/{rest}"), bytes.clone()))
            })
            .collect();
        files.extend(copies);
        Ok(())
    }

    fn write_file(&self, path: &str, contents: &[u8]) -> WorldResult<()> {
        self.call(format!("write {path}"))?;
        self.add_file(path, contents);
        Ok(())
    }

    fn read_file(&self, path: &str) -> WorldResult<Option<Vec<u8>>> {
        self.call(format!("read {path}"))?;
        Ok(self.files.borrow().get(path).cloned())
    }

    fn list_files(&self, path: &str) -> WorldResult<Vec<String>> {
        self.call(format!("find {path} -name .git -prune -o -type f -print"))?;
        let under = format!("{path}/");
        let files = self.files.borrow();
        Ok((files.keys())
            .filter_map(|file| Some(file.strip_prefix(&under)?.to_string()))
            .filter(|file| !file.split('/').any(|part| part == ".git"))
            .collect())
    }

    fn github_viewer(&self) -> WorldResult<String> {
        self.call("github viewer".into())?;
        Ok(self.viewer.borrow().clone())
    }

    /// Like the real one, only open `ready-for-agent` issues.
    fn github_issues(&self, slug: &str) -> WorldResult<Vec<GitHubIssue>> {
        self.call(format!("github issues {slug}"))?;
        let issues = self.issues.borrow().get(slug).cloned().unwrap_or_default();
        Ok(issues
            .into_iter()
            .filter(|i| {
                i.state == IssueState::Open && i.labels.iter().any(|l| l == "ready-for-agent")
            })
            .collect())
    }

    fn github_linked_pull_requests(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<Vec<PullRequest>> {
        self.call(format!("github linked prs {slug}#{number}"))?;
        let urls = self
            .linked
            .borrow()
            .get(&format!("{slug}#{number}"))
            .cloned()
            .unwrap_or_default();
        Ok(self
            .prs
            .borrow()
            .iter()
            .filter(|pr| urls.contains(&pr.url) && pr.state != PrState::Closed)
            .cloned()
            .collect())
    }

    fn github_pull_request(&self, slug: &str, number: u64) -> WorldResult<Option<PullRequest>> {
        self.call(format!("github pr {slug}#{number}"))?;
        Ok(self.pr(slug, number))
    }

    fn github_branch_pull_requests(
        &self,
        slug: &str,
        branch: &str,
    ) -> WorldResult<Vec<PullRequest>> {
        self.call(format!("github branch prs {slug}:{branch}"))?;
        Ok(self
            .prs
            .borrow()
            .iter()
            .filter(|pr| pr.repo == slug && pr.head_branch.as_deref() == Some(branch))
            .cloned()
            .collect())
    }

    fn github_pull_request_activity(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<PullRequestActivity> {
        self.call(format!("github pr activity {slug}#{number}"))?;
        let key = format!("{slug}#{number}");
        let ready = self.readied.borrow().contains(&key);
        if let Some(activity) = self.activity.borrow().get(&key) {
            let draft = activity.draft && !ready;
            return Ok(PullRequestActivity {
                draft,
                ..activity.clone()
            });
        }
        let pr = self
            .pr(slug, number)
            .ok_or_else(|| WorldError(format!("no PR {slug}#{number}")))?;
        Ok(PullRequestActivity {
            state: pr.state,
            draft: !ready,
            head_sha: format!("sha{number}"),
            base_branch: pr.base_branch,
            mergeable: Mergeable::Mergeable,
            updated_at: nico_agent::state::iso(self.clock.get()),
            merged_at: (pr.state == PrState::Merged)
                .then(|| nico_agent::state::iso(self.clock.get())),
        })
    }

    fn github_app_repos(&self) -> WorldResult<Vec<String>> {
        self.call("github app repos".into())?;
        Ok(self.app_repos.borrow().clone())
    }

    fn github_assign_self(&self, slug: &str, number: u64) -> WorldResult<()> {
        self.call(format!("github assign {slug}#{number} @me"))
    }

    fn github_pr_ready(&self, slug: &str, number: u64) -> WorldResult<()> {
        self.call(format!("github pr ready {slug}#{number}"))?;
        self.readied.borrow_mut().push(format!("{slug}#{number}"));
        Ok(())
    }

    fn linear_viewer(&self) -> WorldResult<String> {
        self.call("linear viewer".into())?;
        Ok(self.linear_user.borrow().clone())
    }

    /// Like the real one, only `ready-for-agent` issues of the team, by key, id or name.
    fn linear_issues(&self, team: &str) -> WorldResult<Vec<LinearIssue>> {
        self.call(format!("linear issues {team}"))?;
        let of_team =
            |i: &&LinearIssue| [&i.team.key, &i.team.id, &i.team.name].contains(&&team.to_string());
        Ok(self
            .linear
            .borrow()
            .iter()
            .filter(of_team)
            .filter(|i| i.labels.iter().any(|l| l == "ready-for-agent"))
            .cloned()
            .collect())
    }

    fn linear_attachment_urls(&self, identifier: &str) -> WorldResult<Vec<String>> {
        self.call(format!("linear attachments {identifier}"))?;
        Ok(self
            .linear_attachments
            .borrow()
            .get(identifier)
            .cloned()
            .unwrap_or_default())
    }

    fn linear_assign_self(&self, identifier: &str) -> WorldResult<()> {
        self.call(format!("linear assign {identifier}"))
    }

    fn herdr_worktree_create(
        &self,
        cwd: &str,
        branch: &str,
        base: &str,
        label: &str,
    ) -> WorldResult<Worktree> {
        self.call(format!("herdr worktree create --cwd {cwd} --branch {branch} --base {base} --label {label} --no-focus"))?;
        Ok(Worktree {
            workspace: self.next_workspace(),
            path: format!("/worktrees/{}", branch.rsplit('/').next().unwrap_or(branch)),
        })
    }

    fn herdr_worktree_remove(&self, workspace: &str) -> WorldResult<()> {
        self.call(format!("herdr worktree remove --workspace {workspace}"))
    }

    /// Closing a workspace ends the agents in it.
    fn herdr_workspace_close(&self, workspace: &str) -> WorldResult<()> {
        self.call(format!("herdr workspace close {workspace}"))?;
        let panes = self.agent_panes.borrow();
        self.agents.borrow_mut().retain(|name, _| {
            !panes
                .get(name)
                .is_some_and(|p| p.starts_with(&format!("{workspace}:")))
        });
        Ok(())
    }

    fn herdr_tab_create(&self, workspace: &str, cwd: &str, label: &str) -> WorldResult<Tab> {
        self.call(format!(
            "herdr tab create --workspace {workspace} --cwd {cwd} --label {label} --no-focus"
        ))?;
        // Tab 1 is the workspace's own; created ones follow it.
        let mut tabs = self.tabs.borrow_mut();
        let n = tabs.entry(workspace.into()).or_insert(1);
        *n += 1;
        Ok(Tab {
            tab: format!("{workspace}:t{n}"),
            pane: format!("{workspace}:p{n}"),
        })
    }

    /// Closing a tab ends the agent in its pane.
    fn herdr_tab_close(&self, tab: &str) -> WorldResult<()> {
        self.call(format!("herdr tab close {tab}"))?;
        let pane = tab.replace(":t", ":p");
        let panes = self.agent_panes.borrow();
        (self.agents.borrow_mut()).retain(|name, _| panes.get(name) != Some(&pane));
        Ok(())
    }

    fn herdr_agent_start(
        &self,
        name: &str,
        kind: &str,
        pane: &str,
        args: &[String],
    ) -> WorldResult<bool> {
        self.call(format!(
            "herdr agent start {name} --kind {kind} --pane {pane} -- {}",
            args.join(" ")
        ))?;
        self.place_agent(pane, name);
        Ok(self.blocked_screen.borrow().is_none())
    }

    fn herdr_pane_run(&self, pane: &str, command: &str) -> WorldResult<()> {
        self.call(format!("herdr pane run {pane} {command}"))
    }

    fn herdr_agent_detect(&self, pane: &str, timeout: Duration) -> WorldResult<()> {
        self.call(format!(
            "herdr agent detect {pane} --timeout {}",
            timeout.as_millis()
        ))
    }

    fn herdr_agent_rename(&self, pane: &str, name: &str) -> WorldResult<()> {
        self.call(format!("herdr agent rename {pane} {name}"))?;
        self.place_agent(pane, name);
        Ok(())
    }

    fn herdr_agents(&self) -> WorldResult<Vec<Agent>> {
        self.call("herdr agent list".into())?;
        Ok(self
            .agents
            .borrow()
            .iter()
            .map(|(name, state)| Agent {
                name: name.clone(),
                state: state.as_str().into(),
            })
            .collect())
    }

    fn herdr_agent_read(&self, name: &str) -> WorldResult<String> {
        self.call(format!("herdr agent read {name} --source visible"))?;
        let blocked = self.blocked_screen.borrow().clone();
        Ok(blocked.unwrap_or_else(|| self.screens.borrow().get(name).cloned().unwrap_or_default()))
    }

    /// Answers the startup question the agent is blocked on.
    fn herdr_agent_send_keys(&self, name: &str, keys: &[String]) -> WorldResult<()> {
        self.call(format!("herdr agent send-keys {name} {}", keys.join(" ")))?;
        self.blocked_screen.take();
        Ok(())
    }

    fn herdr_agent_wait(
        &self,
        name: &str,
        states: &[String],
        timeout: Duration,
    ) -> WorldResult<()> {
        let until: String = states.iter().map(|s| format!(" --until {s}")).collect();
        self.call(format!(
            "herdr agent wait {name}{until} --timeout {}",
            timeout.as_millis()
        ))?;
        if self.blocked_screen.borrow().is_some() {
            return Err(WorldError(format!(
                "agent_wait_timeout: {name} did not reach {}",
                states.join(" or ")
            )));
        }
        Ok(())
    }

    fn herdr_agent_prompt(&self, name: &str, text: &str) -> WorldResult<bool> {
        self.call(format!("herdr agent prompt {name} {text}"))?;
        if self.stalled_prompts.get() > 0 {
            self.stalled_prompts.set(self.stalled_prompts.get() - 1);
            return Ok(false);
        }
        self.agents
            .borrow_mut()
            .insert(name.into(), "working".into());
        Ok(true)
    }

    fn herdr_workspace_create(&self, cwd: &str, label: &str) -> WorldResult<String> {
        self.call(format!(
            "herdr workspace create --cwd {cwd} --label {label} --no-focus"
        ))?;
        Ok(self.next_workspace())
    }

    fn opencode_save_variant(
        &self,
        file: &str,
        model: &str,
        effort: Option<&str>,
    ) -> WorldResult<()> {
        let effort = effort.map(|e| format!(" {e}")).unwrap_or_default();
        self.call(format!("opencode variant {file} {model}{effort}"))
    }

    fn notify(&self, title: &str, body: &str) -> WorldResult<()> {
        self.call(format!("notify {title}"))?;
        self.notifications
            .borrow_mut()
            .push((title.into(), body.into()));
        Ok(())
    }

    /// Keeps `handler` for the tests to send requests to.
    fn listen(&self, port: u16, handler: Handler) -> WorldResult<()> {
        self.call(format!("listen 127.0.0.1:{port}"))?;
        *self.listening.borrow_mut() = Some(handler);
        Ok(())
    }

    /// Stamped with the clock, as journald stamps the real one.
    fn log(&self, line: &str) {
        let at = nico_agent::state::iso(self.clock.get());
        self.logged.borrow_mut().push(format!("{at} {line}"));
    }

    fn now(&self) -> SystemTime {
        self.clock.get()
    }

    /// Runs `task` `timer_runs` times, moving the clock on by `interval` before each.
    fn every(&self, interval: Duration, task: &mut dyn FnMut()) {
        for _ in 0..self.timer_runs.get() {
            self.advance(interval);
            task();
        }
    }

    fn process_id(&self) -> u32 {
        self.pid.get()
    }

    fn process_alive(&self, pid: u32) -> bool {
        !self.dead_pids.borrow().contains(&pid)
    }

    fn boot_id(&self) -> String {
        self.boot.borrow().clone()
    }

    fn utc_offset(&self) -> i64 {
        self.utc_offset.get()
    }
}

impl FakeWorld {
    fn git_default_branch_of(&self, path: &str) -> String {
        self.default_branches
            .borrow()
            .get(path)
            .cloned()
            .unwrap_or_else(|| "main".into())
    }

    fn next_workspace(&self) -> String {
        self.workspaces.set(self.workspaces.get() + 1);
        format!("w{}", self.workspaces.get())
    }

    fn place_agent(&self, pane: &str, name: &str) {
        self.agents.borrow_mut().insert(name.into(), "idle".into());
        self.agent_panes
            .borrow_mut()
            .insert(name.into(), pane.into());
    }
}
