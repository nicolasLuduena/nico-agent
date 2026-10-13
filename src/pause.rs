//! A Source's rate limit, kept in `pauses.json` as when it may be asked
//! again, so no tick, command or restarted `serve` asks it till then.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;
use std::time::{Duration, SystemTime};

use crate::state;
use crate::world::{
    Agent, Answered, GitHubIssue, Handler, Headless, HttpRequest, LinearIssue, PullRequest,
    PullRequestActivity, Tab, Worktree, World, WorldError, WorldResult,
};

pub const FILE: &str = "pauses.json";

const GITHUB: &str = "GitHub";
const LINEAR: &str = "Linear";

/// Every Source, as its rate limit names it.
pub const SOURCES: [&str; 2] = [GITHUB, LINEAR];

/// When `source` may be asked again, while it is paused.
pub fn until(world: &dyn World, config_dir: &Path, source: &str) -> io::Result<Option<String>> {
    let pauses: BTreeMap<String, String> = state::load(&config_dir.join(FILE))?;
    let now = state::iso(world.now());
    Ok(pauses
        .get(&source.to_lowercase())
        .filter(|until| **until > now)
        .cloned())
}

/// The pause on `source`, as the error a read of it would fail with.
pub fn of(world: &dyn World, config_dir: &Path, source: &str) -> io::Result<Option<WorldError>> {
    let until = until(world, config_dir, source)?;
    Ok(until.map(|until| WorldError::rate_limited(source, &until)))
}

/// Keep the pause a rate-limited `error` carries.
fn note(config_dir: &Path, error: &WorldError) -> io::Result<()> {
    let Some((source, until)) = error.rate_limit() else {
        return Ok(());
    };
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut pauses: BTreeMap<String, String> = state::parse(&file, text)?;
        pauses.insert(source.to_lowercase(), until.into());
        Ok::<_, io::Error>((state::text(&pauses), ()))
    })
}

/// `world` asking GitHub and Linear only while not paused, each refusal for
/// a rate limit kept as the pause: the one way to them every command takes.
/// The GitHub App is asked on its own rate limit, outside the pause.
pub struct Guarded<'a> {
    pub world: &'a dyn World,
    pub config_dir: &'a Path,
}

impl Guarded<'_> {
    /// `call` to `source`, failing with its pause while it is paused.
    fn ask<T>(
        &self,
        source: &str,
        call: impl FnOnce(&dyn World) -> WorldResult<T>,
    ) -> WorldResult<T> {
        let unread = |e: io::Error| WorldError(e.to_string());
        if let Some(paused) = of(self.world, self.config_dir, source).map_err(unread)? {
            return Err(paused);
        }
        let asked = call(self.world);
        // Still the rate limit it was, so the caller stops asking.
        if let Err(e) = &asked
            && let Err(unkept) = note(self.config_dir, e)
        {
            self.world
                .log(&format!("could not keep {source}'s pause: {unkept}"));
        }
        asked
    }
}

impl World for Guarded<'_> {
    fn github_viewer(&self) -> WorldResult<String> {
        self.ask(GITHUB, |w| w.github_viewer())
    }
    fn github_issues(&self, slug: &str) -> WorldResult<Vec<GitHubIssue>> {
        self.ask(GITHUB, |w| w.github_issues(slug))
    }
    fn github_linked_pull_requests(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<Vec<PullRequest>> {
        self.ask(GITHUB, |w| w.github_linked_pull_requests(slug, number))
    }
    fn github_pull_request(&self, slug: &str, number: u64) -> WorldResult<Option<PullRequest>> {
        self.ask(GITHUB, |w| w.github_pull_request(slug, number))
    }
    fn github_branch_pull_requests(
        &self,
        slug: &str,
        branch: &str,
    ) -> WorldResult<Vec<PullRequest>> {
        self.ask(GITHUB, |w| w.github_branch_pull_requests(slug, branch))
    }
    fn github_pull_request_activity(
        &self,
        slug: &str,
        number: u64,
    ) -> WorldResult<PullRequestActivity> {
        self.ask(GITHUB, |w| w.github_pull_request_activity(slug, number))
    }
    fn github_assign_self(&self, slug: &str, number: u64) -> WorldResult<()> {
        self.ask(GITHUB, |w| w.github_assign_self(slug, number))
    }
    fn github_pr_ready(&self, slug: &str, number: u64) -> WorldResult<()> {
        self.ask(GITHUB, |w| w.github_pr_ready(slug, number))
    }
    fn linear_viewer(&self) -> WorldResult<String> {
        self.ask(LINEAR, |w| w.linear_viewer())
    }
    fn linear_issues(&self, team: &str) -> WorldResult<Vec<LinearIssue>> {
        self.ask(LINEAR, |w| w.linear_issues(team))
    }
    fn linear_attachment_urls(&self, identifier: &str) -> WorldResult<Vec<String>> {
        self.ask(LINEAR, |w| w.linear_attachment_urls(identifier))
    }
    fn linear_assign_self(&self, identifier: &str) -> WorldResult<()> {
        self.ask(LINEAR, |w| w.linear_assign_self(identifier))
    }

    /// Each request's World guarded too.
    fn listen(&self, port: u16, handler: Handler) -> WorldResult<()> {
        let config_dir = self.config_dir.to_path_buf();
        let guarded = move |world: &dyn World, request: &HttpRequest| {
            let world = Guarded {
                world,
                config_dir: &config_dir,
            };
            handler(&world, request)
        };
        self.world.listen(port, Box::new(guarded))
    }

    // Neither GitHub nor Linear.
    fn github_app_repos(&self) -> WorldResult<Vec<String>> {
        self.world.github_app_repos()
    }
    fn git_remotes(&self, path: &str) -> WorldResult<Option<Vec<String>>> {
        self.world.git_remotes(path)
    }
    fn git_fetch(&self, path: &str, branch: Option<&str>) -> WorldResult<()> {
        self.world.git_fetch(path, branch)
    }
    fn git_default_branch(&self, path: &str) -> WorldResult<String> {
        self.world.git_default_branch(path)
    }
    fn git_init(&self, path: &str) -> WorldResult<()> {
        self.world.git_init(path)
    }
    fn git_commit(&self, path: &str, add: &str, message: &str) -> WorldResult<()> {
        self.world.git_commit(path, add, message)
    }
    fn git_changed(&self, path: &str, folder: &str) -> WorldResult<bool> {
        self.world.git_changed(path, folder)
    }
    fn git_ls_remote(&self, path: &str) -> WorldResult<()> {
        self.world.git_ls_remote(path)
    }
    fn git_show(&self, path: &str, rev: &str, file: &str) -> WorldResult<Option<String>> {
        self.world.git_show(path, rev, file)
    }
    fn git_ls_tree(&self, path: &str, rev: &str, folder: &str) -> WorldResult<Vec<String>> {
        self.world.git_ls_tree(path, rev, folder)
    }
    fn git_branch(&self, path: &str) -> WorldResult<String> {
        self.world.git_branch(path)
    }
    fn git_tracked_changes(&self, path: &str) -> WorldResult<Vec<String>> {
        self.world.git_tracked_changes(path)
    }
    fn git_pull(&self, path: &str) -> WorldResult<()> {
        self.world.git_pull(path)
    }
    fn git_rev(&self, path: &str, rev: &str) -> WorldResult<String> {
        self.world.git_rev(path, rev)
    }
    fn git_worktree_add(&self, path: &str, dir: &str, rev: &str) -> WorldResult<()> {
        self.world.git_worktree_add(path, dir, rev)
    }
    fn git_worktree_remove(&self, path: &str, dir: &str) -> WorldResult<()> {
        self.world.git_worktree_remove(path, dir)
    }
    fn git_ls_tree_blobs(&self, path: &str, rev: &str) -> WorldResult<Vec<(String, String)>> {
        self.world.git_ls_tree_blobs(path, rev)
    }
    fn git_rev_count(&self, path: &str, from: &str, to: &str) -> WorldResult<usize> {
        self.world.git_rev_count(path, from, to)
    }
    fn harness_headless(
        &self,
        cwd: &str,
        calls: &[Headless],
        at_once: usize,
    ) -> Vec<WorldResult<Answered>> {
        self.world.harness_headless(cwd, calls, at_once)
    }
    fn ollama_embed(
        &self,
        ollama: &str,
        model: &str,
        input: &[String],
    ) -> WorldResult<Vec<Vec<f32>>> {
        self.world.ollama_embed(ollama, model, input)
    }
    fn shell(&self, cwd: &str, command: &str) -> WorldResult<(bool, String)> {
        self.world.shell(cwd, command)
    }
    fn copy_dir(&self, from: &str, to: &str) -> WorldResult<()> {
        self.world.copy_dir(from, to)
    }
    fn write_file(&self, path: &str, contents: &[u8]) -> WorldResult<()> {
        self.world.write_file(path, contents)
    }
    fn read_file(&self, path: &str) -> WorldResult<Option<Vec<u8>>> {
        self.world.read_file(path)
    }
    fn list_files(&self, path: &str) -> WorldResult<Vec<String>> {
        self.world.list_files(path)
    }
    fn has_skill(&self, dir: &str, name: &str) -> bool {
        self.world.has_skill(dir, name)
    }
    fn herdr_worktree_create(
        &self,
        cwd: &str,
        branch: &str,
        base: &str,
        label: &str,
    ) -> WorldResult<Worktree> {
        self.world.herdr_worktree_create(cwd, branch, base, label)
    }
    fn herdr_worktree_remove(&self, workspace: &str) -> WorldResult<()> {
        self.world.herdr_worktree_remove(workspace)
    }
    fn herdr_workspace_close(&self, workspace: &str) -> WorldResult<()> {
        self.world.herdr_workspace_close(workspace)
    }
    fn herdr_tab_create(&self, workspace: &str, cwd: &str, label: &str) -> WorldResult<Tab> {
        self.world.herdr_tab_create(workspace, cwd, label)
    }
    fn herdr_tab_close(&self, tab: &str) -> WorldResult<()> {
        self.world.herdr_tab_close(tab)
    }
    fn herdr_agent_start(
        &self,
        name: &str,
        kind: &str,
        pane: &str,
        args: &[String],
    ) -> WorldResult<bool> {
        self.world.herdr_agent_start(name, kind, pane, args)
    }
    fn herdr_pane_run(&self, pane: &str, command: &str) -> WorldResult<()> {
        self.world.herdr_pane_run(pane, command)
    }
    fn herdr_pane_exists(&self, pane: &str) -> WorldResult<bool> {
        self.world.herdr_pane_exists(pane)
    }
    fn herdr_agent_detect(&self, pane: &str, timeout: Duration) -> WorldResult<()> {
        self.world.herdr_agent_detect(pane, timeout)
    }
    fn herdr_agent_rename(&self, pane: &str, name: &str) -> WorldResult<()> {
        self.world.herdr_agent_rename(pane, name)
    }
    fn herdr_agents(&self) -> WorldResult<Vec<Agent>> {
        self.world.herdr_agents()
    }
    fn herdr_agent_read(&self, name: &str) -> WorldResult<String> {
        self.world.herdr_agent_read(name)
    }
    fn herdr_agent_send_keys(&self, name: &str, keys: &[String]) -> WorldResult<()> {
        self.world.herdr_agent_send_keys(name, keys)
    }
    fn herdr_agent_wait(
        &self,
        name: &str,
        states: &[String],
        timeout: Duration,
    ) -> WorldResult<()> {
        self.world.herdr_agent_wait(name, states, timeout)
    }
    fn herdr_agent_prompt(&self, name: &str, text: &str) -> WorldResult<bool> {
        self.world.herdr_agent_prompt(name, text)
    }
    fn herdr_workspace_create(&self, cwd: &str, label: &str) -> WorldResult<String> {
        self.world.herdr_workspace_create(cwd, label)
    }
    fn opencode_save_variant(
        &self,
        file: &str,
        model: &str,
        effort: Option<&str>,
    ) -> WorldResult<()> {
        self.world.opencode_save_variant(file, model, effort)
    }
    fn notify(&self, title: &str, body: &str) -> WorldResult<()> {
        self.world.notify(title, body)
    }
    fn read_line(&self) -> WorldResult<Option<String>> {
        self.world.read_line()
    }
    fn write_line(&self, line: &str) -> WorldResult<()> {
        self.world.write_line(line)
    }
    fn log(&self, line: &str) {
        self.world.log(line)
    }
    fn now(&self) -> SystemTime {
        self.world.now()
    }
    fn every(&self, interval: Duration, task: &mut dyn FnMut()) {
        self.world.every(interval, task)
    }
    fn process_id(&self) -> u32 {
        self.world.process_id()
    }
    fn process_alive(&self, pid: u32) -> bool {
        self.world.process_alive(pid)
    }
    fn boot_id(&self) -> String {
        self.world.boot_id()
    }
    fn utc_offset(&self) -> i64 {
        self.world.utc_offset()
    }
}
