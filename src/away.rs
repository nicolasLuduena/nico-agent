//! The loop's agents that are no Implementer nor Reviewer: a quality-scan per
//! Repo, weekly, a faux-nico per Asking, and the morning agent, daily. Each
//! start is kept as a Run in `runs.json`, and its workspace closed once herdr
//! reports its agent ended. What such an agent files is its own Source
//! write; nico-agent writes nothing for it.

use std::fs;
use std::io;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::cli::{Context, Refusal};
use crate::config::{Config, Launch, Repo, Weekday, fill_in};
use crate::dispatch;
use crate::faux_nico;
use crate::launch::{self, AgentLaunch};
use crate::state;
use crate::world::{self, Agent, AgentState, Tab};

pub const FILE: &str = "runs.json";

/// The Morning summary, which the morning agent writes in the config directory.
pub const SUMMARY: &str = "morning.md";

/// The Morning summary as last notified.
const NOTIFIED: &str = "morning.notified";

/// One start of a trigger's agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    #[serde(flatten)]
    pub trigger: Trigger,
    /// The Repo it ran for, if one.
    pub repo: Option<String>,
    /// When it started.
    pub at: String,
    #[serde(flatten)]
    pub launch: AgentLaunch,
    pub workspace: Option<String>,
    /// Set when it runs on a worktree, removed with its workspace.
    pub worktree: Option<String>,
    /// Why its start stopped short, if it did; it counts as run all the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    /// While herdr reports its agent blocked, since when; the user is told once a spell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_since: Option<String>,
    /// When its agent was seen ended and its workspace closed.
    pub closed_at: Option<String>,
}

/// What started a Run, as `runs.json` writes it: `"trigger": "quality-scan"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "trigger", rename_all = "kebab-case")]
pub enum Trigger {
    QualityScan,
    Morning,
    /// For `issue`, on its Asking since `asking`.
    FauxNico {
        issue: String,
        asking: String,
        /// It ended leaving that Asking unanswered, and the user was told.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        passed: bool,
    },
    /// One this build no longer starts, so a `runs.json` holding it still
    /// loads; never closed nor shown.
    #[serde(other)]
    Gone,
}

impl Trigger {
    /// The label of its Run's tab, and its agent's name or the start of it.
    pub fn label(&self) -> &'static str {
        match self {
            Trigger::QualityScan => "quality-scan",
            Trigger::Morning => "morning",
            Trigger::Gone => "gone",
            Trigger::FauxNico { .. } => "faux-nico",
        }
    }
}

/// Every Run, oldest first.
// shortcut: kept forever (a few hundred bytes per scan or Asking); prune like Dispatches if it grows.
pub fn load(config_dir: &Path) -> io::Result<Vec<Run>> {
    state::load(&config_dir.join(FILE))
}

/// The last quality-scan of the Repo `slug`.
pub fn last_scan<'a>(runs: &'a [Run], slug: &str) -> Option<&'a Run> {
    (runs.iter()).rfind(|r| r.trigger == Trigger::QualityScan && r.repo.as_deref() == Some(slug))
}

/// The last morning Run.
pub fn last_morning(runs: &[Run]) -> Option<&Run> {
    (runs.iter()).rfind(|r| r.trigger == Trigger::Morning)
}

/// Close the Runs whose agents ended, start each quality-scan due and the
/// morning agent if due, and send the Morning summary if it changed;
/// `agents` as the tick listed them, if it did. What it said, and the Runs
/// it closed.
pub fn step(
    ctx: &Context,
    config: &Config,
    agents: Option<&[Agent]>,
) -> Result<(Vec<String>, Vec<Run>), Refusal> {
    let (mut said, ended) = close_ended(ctx, agents)?;
    said.extend(scan(ctx, config)?);
    said.extend(morning(ctx, config)?);
    said.extend(send_summary(ctx)?);
    Ok((said, ended))
}

/// Close each open Run whose agent is idle, done or gone from herdr, and tell
/// the user of each newly blocked. Closing removes its worktree and closes its
/// workspace; one that fails is said and tried again next tick. One blocked
/// stays open, its user told once a spell: a faux-nico waiting on a
/// permission may hold its answer. What it said, and the Runs it closed.
fn close_ended(ctx: &Context, agents: Option<&[Agent]>) -> io::Result<(Vec<String>, Vec<Run>)> {
    let open: Vec<Run> = (load(&ctx.config_dir)?.into_iter())
        .filter(|r| r.closed_at.is_none() && r.trigger != Trigger::Gone)
        .collect();
    if open.is_empty() {
        return Ok((vec![], vec![]));
    }
    let listed;
    let agents = match agents {
        Some(agents) => agents,
        None => match ctx.world.herdr_agents() {
            Ok(all) => {
                listed = all;
                &listed
            }
            // herdr down is never every agent gone.
            Err(e) => return Ok((vec![format!("could not list herdr's agents: {e}")], vec![])),
        },
    };
    let (mut said, mut ended) = (vec![], vec![]);
    for run in open {
        let agent = &run.launch.agent;
        match world::agent_state(agents, agent) {
            None | Some(AgentState::Idle | AgentState::Done) => {}
            Some(AgentState::Blocked) if run.blocked_since.is_none() => {
                let now = state::iso(ctx.world.now());
                update_open(&ctx.config_dir, &run.launch, |open| {
                    open.blocked_since = Some(now)
                })?;
                said.push(format!("{agent} is blocked"));
                said.extend(tell_blocked(ctx, &run)?);
                continue;
            }
            Some(AgentState::Working) if run.blocked_since.is_some() => {
                update_open(&ctx.config_dir, &run.launch, |open| {
                    open.blocked_since = None
                })?;
                continue;
            }
            Some(_) => continue,
        }
        let closed = run.workspace.as_ref().map_or(Ok(()), |workspace| {
            (run.worktree.as_ref())
                .map_or(Ok(()), |_| {
                    ctx.world.herdr_worktree_remove(workspace, false)
                })
                .and_then(|()| ctx.world.herdr_workspace_close(workspace))
        });
        if let Err(e) = closed {
            said.push(format!("could not close the workspace of {agent}: {e}"));
            continue;
        }
        let now = state::iso(ctx.world.now());
        // As kept: faux-nico's `pass` finds it by all it holds.
        let closed = update_open(&ctx.config_dir, &run.launch, |open| {
            open.closed_at = Some(now);
            open.blocked_since = None;
            open.clone()
        })?;
        said.push(format!("{agent} ended; its workspace closed"));
        ended.extend(closed);
    }
    Ok((said, ended))
}

/// Change the open Run of `launch` under the file's lock; what `change` gave,
/// if it is still open.
fn update_open<T>(
    config_dir: &Path,
    launch: &AgentLaunch,
    change: impl FnOnce(&mut Run) -> T,
) -> io::Result<Option<T>> {
    update(config_dir, |all| {
        let open = (all.iter_mut()).find(|r| r.closed_at.is_none() && r.launch == *launch);
        open.map(change)
    })
}

/// Tell the user `run`'s agent is blocked, naming it to take over, and for a
/// faux-nico its Dispatch's Asking, if still unanswered, to answer by hand;
/// what failed, said. Once: a failed notification is not tried again.
fn tell_blocked(ctx: &Context, run: &Run) -> io::Result<Option<String>> {
    let label = run.trigger.label();
    let (who, asked) = match &run.trigger {
        Trigger::FauxNico { issue, .. } => {
            let dispatches = dispatch::load(&ctx.config_dir)?;
            let question = (dispatches.iter())
                .find(|d| dispatch::is_live(d, issue))
                .and_then(|d| (d.asking.as_ref()).filter(|a| !faux_nico::answered(d, &a.since)));
            let asked = question.map_or(String::new(), |a| {
                format!(
                    "\"{}\"\nAnswer it with nico-agent answer {issue} --text \"...\".\n",
                    a.question
                )
            });
            (Some(issue.as_str()), asked)
        }
        _ => (run.repo.as_deref(), String::new()),
    };
    let title = who.map_or(format!("{label} is blocked"), |who| {
        format!("{label} of {who} is blocked")
    });
    let body = format!(
        "{asked}Take it over: herdr agent read {}.",
        run.launch.agent
    );
    Ok((ctx.world.notify(&title, &body))
        .err()
        .map(|e| format!("could not notify \"{title}\": {e}")))
}

/// Start a quality-scan in each Repo with its switch on that has room, no
/// scan running, and none since the latest weekly slot; a Repo never scanned
/// only within its slot's hour, so turning the switch on scans nothing at once.
fn scan(ctx: &Context, config: &Config) -> Result<Vec<String>, Refusal> {
    let runs = load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let weekly = &config.quality_scan;
    let slot = last_slot(ctx, Some(weekly.weekday), weekly.hour);
    // shortcut: a first slot with no room in its hour waits a week; remember the missed slot if that bites.
    let first_due = ctx.world.now() < slot + HOUR;
    let slot = state::iso(slot);
    let mut said = vec![];
    for (slug, repo) in (config.repos.iter()).filter(|(_, r)| r.switches.quality_scan) {
        let live = (dispatches.iter())
            .filter(|d| d.repo == *slug && d.closed_at.is_none())
            .count();
        let last = last_scan(&runs, slug);
        let due = last.map_or(first_due, |r| r.closed_at.is_some() && r.at < slot);
        if live >= repo.room as usize || !due {
            continue;
        }
        let chosen = repo.or_implementer(&repo.quality_scan);
        let sigil = &config.harnesses[&chosen.harness].sigil;
        let values = [("sigil", sigil.as_str()), ("repoSlug", slug)];
        let text = fill_in(&config.prompts.quality_scan, &values);
        // On a worktree of the Repo at its Base.
        let start = |run: &mut Run| {
            let base = match &repo.base {
                Some(base) => base.clone(),
                None => ctx.world.git_default_branch(&repo.path)?,
            };
            start_on_worktree(ctx, config, repo, &base, run, &text)
        };
        said.push(start_run(
            ctx,
            Trigger::QualityScan,
            Some(slug),
            chosen,
            start,
        )?);
    }
    Ok(said)
}

/// Start a Run of `trigger` now, for the Repo `repo` if one, launched as
/// `chosen`, with `start`; keep it in `runs.json`, one whose start stopped
/// short with why: it counts as run all the same. Says which, naming it by
/// its issue, else its Repo.
pub fn start_run(
    ctx: &Context,
    trigger: Trigger,
    repo: Option<&str>,
    chosen: Launch,
    start: impl FnOnce(&mut Run) -> Result<(), Refusal>,
) -> io::Result<String> {
    let label = trigger.label();
    let (agent, who) = match (&trigger, repo) {
        (Trigger::FauxNico { issue, .. }, Some(slug)) => {
            (launch::agent_name(label, slug, issue), Some(issue.clone()))
        }
        (_, Some(slug)) => (launch::repo_agent_name(label, slug), Some(slug.into())),
        (_, None) => (label.into(), None),
    };
    let mut run = Run {
        trigger,
        repo: repo.map(Into::into),
        at: state::iso(ctx.world.now()),
        launch: AgentLaunch {
            agent,
            harness: chosen.harness,
            model: chosen.model,
            effort: chosen.effort,
            tab: None,
            pane: None,
        },
        workspace: None,
        worktree: None,
        failure: None,
        blocked_since: None,
        closed_at: None,
    };
    let said = match start(&mut run) {
        Ok(()) => {
            let who = who.map_or(String::new(), |who| format!("{who}: "));
            format!("{who}{label} started on {}", run.launch.harness)
        }
        Err(no) => {
            let of = who.map_or(String::new(), |who| format!(" of {who}"));
            let said = format!("could not start the {label}{of}: {}", no.error);
            run.failure = Some(no.error);
            said
        }
    };
    update(&ctx.config_dir, |all| all.push(run))?;
    Ok(said)
}

/// Open a fresh worktree of the Repo at `base` and start the Run's agent
/// there on `text`.
pub fn start_on_worktree(
    ctx: &Context,
    config: &Config,
    repo: &Repo,
    base: &str,
    run: &mut Run,
    text: &str,
) -> Result<(), Refusal> {
    let world = ctx.world;
    world.git_fetch(&repo.path, None)?;
    // A fresh branch each run: removing a worktree keeps its branch.
    let stamp = run.at.replace(['-', ':', 'T', 'Z'], "");
    let branch = format!("{}-{stamp}", run.launch.agent);
    let base = format!("origin/{base}");
    let made = world.herdr_worktree_create(&repo.path, &branch, &base, &run.launch.agent)?;
    run.workspace = Some(made.workspace);
    run.worktree = Some(made.path.clone());
    start(ctx, config, run, made.tab, &made.path, &repo.path, text)
}

/// Start the Run's agent in `tab`, the one its new workspace opened with,
/// working in `cwd` and trusting `repo_path`, and prompt it with `text`.
fn start(
    ctx: &Context,
    config: &Config,
    run: &mut Run,
    tab: Tab,
    cwd: &str,
    repo_path: &str,
    text: &str,
) -> Result<(), Refusal> {
    let harness = &config.harnesses[&run.launch.harness];
    let workspace = run.workspace.clone().expect("its workspace is open");
    launch::open_tab(
        ctx.world,
        &mut run.launch,
        &workspace,
        cwd,
        run.trigger.label(),
        Some(tab),
    )?;
    let ready = launch::start(ctx.world, harness, &run.launch, repo_path)?;
    launch::get_ready(ctx.world, harness, &run.launch, cwd, ready)?;
    launch::prompt(ctx.world, harness, &run.launch.agent, text)
}

/// Start the morning agent, while `morning` is enabled, within the hour of
/// `morning.hour` local time, once that day: a missed hour is a missed
/// morning. It runs in a workspace on the config directory, with no worktree.
fn morning(ctx: &Context, config: &Config) -> Result<Vec<String>, Refusal> {
    let now = ctx.world.now();
    let slot = last_slot(ctx, None, config.morning.hour);
    let chosen = (config.morning.launch.clone())
        .or_else(|| config.repos.values().next().map(|r| r.implementer.clone()));
    let Some(chosen) = chosen.filter(|_| config.morning.enabled && now < slot + HOUR) else {
        return Ok(vec![]);
    };
    let runs = load(&ctx.config_dir)?;
    let last = last_morning(&runs);
    if last.is_some_and(|r| r.closed_at.is_none() || r.at >= state::iso(slot)) {
        return Ok(vec![]);
    }
    // The first morning reads the day before.
    let since = last.map_or_else(|| state::iso(now - 24 * HOUR), |r| r.at.clone());
    let dir = ctx.config_dir.display().to_string();
    let sigil = &config.harnesses[&chosen.harness].sigil;
    let values = [
        ("sigil", sigil.as_str()),
        ("lastMorningAt", &since),
        ("configDir", &dir),
    ];
    let text = fill_in(&config.prompts.morning, &values);
    let said = start_run(ctx, Trigger::Morning, None, chosen, |run| {
        let made = ctx.world.herdr_workspace_create(&dir, &run.launch.agent)?;
        run.workspace = Some(made.workspace);
        start(ctx, config, run, made.tab, &dir, &dir, &text)
    })?;
    Ok(vec![said])
}

/// Send the user the first line of the Morning summary under its headings,
/// once for each text it holds. Once: a failed notification is said, not
/// tried again.
fn send_summary(ctx: &Context) -> io::Result<Vec<String>> {
    let text = match fs::read_to_string(ctx.config_dir.join(SUMMARY)) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        read => read?,
    };
    let first = (text.lines().map(str::trim)).find(|l| !l.is_empty() && !l.starts_with('#'));
    let Some(first) = first else {
        return Ok(vec![]);
    };
    let file = ctx.config_dir.join(NOTIFIED);
    let new = state::update(&file, |old| Ok::<_, io::Error>((text.clone(), old != text)))?;
    if !new {
        return Ok(vec![]);
    }
    Ok(vec![match ctx.world.notify("Morning summary", first) {
        Ok(()) => format!("Morning summary sent: {first}"),
        Err(e) => format!("could not send the Morning summary: {e}"),
    }])
}

const HOUR: Duration = Duration::from_secs(3600);

/// When the latest slot at or before now began: `hour` local time, on
/// `weekday` when one is given, else daily.
pub fn last_slot(ctx: &Context, weekday: Option<Weekday>, hour: u32) -> SystemTime {
    const DAY: i64 = 86_400;
    let offset = ctx.world.utc_offset();
    let now = ctx.world.now().duration_since(UNIX_EPOCH);
    let local = now.map_or(0, |d| d.as_secs() as i64) + offset;
    let today = local.div_euclid(DAY);
    // 1970-01-01 was a Thursday, and a Sunday is 0.
    let back = weekday.map_or(0, |w| (today + 4 - w as i64).rem_euclid(7));
    let mut slot = (today - back) * DAY + (HOUR * hour).as_secs() as i64;
    if slot > local {
        slot -= weekday.map_or(1, |_| 7) * DAY;
    }
    // shortcut: now's offset stands for the slot's, so a DST change between them moves it an hour once.
    UNIX_EPOCH + Duration::from_secs((slot - offset).max(0) as u64)
}

/// Change the Runs under the file's lock.
pub fn update<T>(config_dir: &Path, change: impl FnOnce(&mut Vec<Run>) -> T) -> io::Result<T> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all = state::parse(&file, text)?;
        let out = change(&mut all);
        Ok((state::text(&all), out))
    })
}
