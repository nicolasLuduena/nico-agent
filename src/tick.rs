//! The tick: what the loop does each time, in #230's order, one function per
//! step, each behind its own switch. Each step says what it did, a line per
//! action, and a failure that only touches one Repo, Dispatch or PR is said
//! and the tick goes on; one that touches the state files fails the tick.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, Read as _, Write};

use crate::asking;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config};
use crate::dispatch::{self, Flags};
use crate::restart;
use crate::review;
use crate::source::{self, Read};
use crate::stage;
use crate::verdict;
use crate::world::Agent;

/// Held by the running tick, with its pid.
pub const LOCK: &str = "tick.lock";

/// Run one tick, unless another is running; says what it did, a line per action.
pub fn tick(ctx: &Context) -> Result<Vec<String>, Refusal> {
    let _held = match lock(ctx)? {
        Ok(held) => held,
        Err(pid) => {
            return Ok(vec![format!(
                "tick skipped: another tick is running (pid {pid})"
            )]);
        }
    };
    let config = config::load(&ctx.config_dir)?;
    let (mut said, reads) = read_sources(ctx, &config)?;
    let (watched, no_pr) = stage::watch(ctx)?;
    said.extend(watched);
    said.extend(dispatch::close_finished(ctx)?);
    let agents = list_agents(ctx, &mut said)?;
    // 4. Restart what broke: rebooted, stalled (#240); conflict, retarget (#244); verdict (#243).
    said.extend(restart::step(ctx, &config, agents.as_deref(), &no_pr)?);
    said.extend(take_up(ctx, &config)?);
    // 5. Start Reviewers (#242).
    said.extend(review::start_reviewers(ctx, &config, agents.as_deref())?);
    // 6. Flip Verified PRs to ready (#243).
    said.extend(verdict::flip(ctx, &config)?);
    said.extend(asking::step(ctx, agents.as_deref())?);
    said.extend(fill_rooms(ctx, &config, &reads)?);
    Ok(said)
}

/// herdr's agents, listed once for the steps that read Agent states, while a
/// Dispatch is live. `None` when none is, or when herdr did not answer, which
/// is said: herdr down is never every agent gone.
fn list_agents(ctx: &Context, said: &mut Vec<String>) -> io::Result<Option<Vec<Agent>>> {
    let dispatches = dispatch::load(&ctx.config_dir)?;
    if dispatches.iter().all(|d| d.closed_at.is_some()) {
        return Ok(None);
    }
    Ok(ctx
        .world
        .herdr_agents()
        .map_err(|e| said.push(format!("could not list herdr's agents: {e}")))
        .ok())
}

/// Take the tick lock and write our pid in it, or say the pid of the tick
/// holding it. An flock: the lock of a process that died is released with it.
fn lock(ctx: &Context) -> io::Result<Result<File, String>> {
    fs::create_dir_all(&ctx.config_dir)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(ctx.config_dir.join(LOCK))?;
    match file.try_lock() {
        Ok(()) => {
            file.set_len(0)?;
            write!(file, "{}", ctx.world.process_id())?;
            Ok(Ok(file))
        }
        Err(TryLockError::WouldBlock) => {
            let mut pid = String::new();
            file.read_to_string(&mut pid)?;
            Ok(Err(pid.trim().into()))
        }
        Err(TryLockError::Error(e)) => Err(e),
    }
}

/// (1) Each Repo's Source, read when its cache is older than a tick; a
/// failed read is said, and its cache, if any, stands in for it.
fn read_sources(
    ctx: &Context,
    config: &Config,
) -> Result<(Vec<String>, BTreeMap<String, Read>), Refusal> {
    let (mut said, mut reads) = (vec![], BTreeMap::new());
    for (slug, repo) in &config.repos {
        let (read, error) = source::issues(ctx.world, &ctx.config_dir, slug, repo, config.tick())?;
        if let Some(e) = error {
            said.push(format!("could not read the issues of {slug}: {e}"));
        }
        if let Some(read) = read {
            reads.insert(slug.clone(), read);
        }
    }
    Ok((said, reads))
}

/// (7) Dispatch each Repo's Ready issues, then its Stackable ones behind
/// the `stack` switch, oldest first, while its live Dispatches are under its
/// room; behind the `dispatch` switch.
fn fill_rooms(
    ctx: &Context,
    config: &Config,
    reads: &BTreeMap<String, Read>,
) -> Result<Vec<String>, Refusal> {
    let mut said = vec![];
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let prs = stage::load(&ctx.config_dir)?;
    for (slug, repo) in config.repos.iter().filter(|(_, r)| r.switches.dispatch) {
        let Some(read) = reads.get(slug) else {
            continue;
        };
        let live = (dispatches.iter())
            .filter(|d| d.repo == *slug && d.closed_at.is_none())
            .count();
        let room = (repo.room as usize).saturating_sub(live);
        let readiness = source::readiness(read, &dispatches, &prs);
        let stackable = (readiness.stackable.into_iter()).filter(|_| repo.switches.stack);
        for row in readiness.ready.into_iter().chain(stackable).take(room) {
            let done = format!("{} dispatched", row.key);
            said.extend(run_steps(ctx, config, &row.key, done)?);
        }
    }
    Ok(said)
}

/// (4) Take up, behind each Repo's `restart` switch, each live Dispatch
/// whose steps stopped short with no live process running them (it died, or
/// the machine restarted), from the step it stopped at, as `dispatch` does.
fn take_up(ctx: &Context, config: &Config) -> Result<Vec<String>, Refusal> {
    let mut said = vec![];
    for d in dispatch::load(&ctx.config_dir)? {
        let Some(step) = d.next_step() else {
            continue;
        };
        if d.closed_at.is_none()
            && d.failure.is_none()
            && !d.running(ctx.world)
            && config.repo_of(&d).switches.restart
        {
            let done = format!("{} continued from {step}", d.issue);
            said.extend(run_steps(ctx, config, &d.issue, done)?);
        }
    }
    Ok(said)
}

/// Run the steps of `key`'s Dispatch as `dispatch` does: `done` and its
/// warnings, or why it failed, said once to the user too.
fn run_steps(
    ctx: &Context,
    config: &Config,
    key: &str,
    done: String,
) -> Result<Vec<String>, Refusal> {
    Ok(match dispatch::issue(ctx, config, key, Flags::default()) {
        Ok(answer) => {
            let warnings = answer["warnings"].as_array().into_iter().flatten();
            [done]
                .into_iter()
                .chain(warnings.filter_map(|w| w.as_str().map(String::from)))
                .collect()
        }
        // Failed at a step: it is live, so it holds its room till dispatched by hand.
        Err(no) => [no.error]
            .into_iter()
            .chain(restart::announce(ctx, key)?)
            .collect(),
    })
}
