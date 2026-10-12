//! A Repo's Install: the command it runs in its clone after a merge into its
//! Base, so what it builds is what the next agent uses. One at a time per
//! Repo, kept in `installs.json` with how the last one went.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::checks;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Repo};
use crate::launch;
use crate::repo;
use crate::stage::Pr;
use crate::state;
use crate::world::{World, WorldError, WorldResult};

pub const FILE: &str = "installs.json";

/// How many of the last lines an Install printed are kept.
const OUTPUT_LINES: usize = 20;

/// A Repo's Installs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Install {
    /// The process running one, while one does, and the boot it runs in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner_boot: Option<String>,
    /// A merge into the Base was seen while one ran: one more runs after it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub queued: bool,
    /// The workspace the loop last ran one in, closed when it opens the next.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<Last>,
}

/// How the last Install went.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Last {
    /// When it started, before it pulled.
    pub at: String,
    /// The commit it installed; none when it was refused or its pull failed.
    pub sha: Option<String>,
    pub ok: bool,
    /// The last lines of what it printed, or why it was refused.
    pub output: String,
}

impl Install {
    /// The pid of the live process running one, in this boot.
    fn running(&self, world: &dyn World) -> Option<u32> {
        let this_boot = self.runner_boot.as_deref() == Some(&world.boot_id());
        self.runner
            .filter(|pid| this_boot && world.process_alive(*pid))
    }
}

/// `install <slug>`: in the Repo's clone, on its Base with no changes to
/// tracked files, pull fast-forward and run its command with `sh -c`; keep
/// how it went, refused included, then run its Readiness checks. While
/// another runs, one more is queued after it instead.
pub fn install(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let args = Args::parse("install", args, &[])?;
    let slug = args.positionals(&["<owner/name>"])?[0];
    let config = config::load(&ctx.config_dir)?;
    let (slug, repo) = config
        .repo(slug)
        .ok_or_else(|| repo::not_configured(slug))?;
    let Some(command) = &repo.install else {
        return Err(Refusal::new(
            format!("{slug} has no install command"),
            vec![format!(
                "Set it on {slug}'s tab, or as repos.\"{slug}\".install in config.toml"
            )],
        ));
    };
    let at = state::iso(ctx.world.now());
    if let Some(pid) = claim(ctx, slug)? {
        return Err(Refusal::new(
            format!("an Install of {slug} is running (pid {pid})"),
            vec!["One more runs once it ends".into()],
        ));
    }
    let last = run(ctx.world, repo, command, at);
    update(&ctx.config_dir, slug, |install| {
        (install.runner, install.runner_boot) = (None, None);
        install.last = Some(last.clone());
    })?;
    checks::run(ctx, &config, |checked, _| checked == slug)?;
    match (last.ok, last.sha) {
        (true, Some(sha)) => Ok(json!({ "installed": format!("{slug} at {sha}") })),
        _ => Err(Refusal::new(
            format!(
                "the Install of {slug} failed: {}",
                last.output.lines().last().unwrap_or_default()
            ),
            vec![format!("Run `nico-agent install {slug}` once it is fixed")],
        )),
    }
}

/// Start an Install of each Repo with an install command that has a PR of
/// `merged` into its Base, or one queued; while one runs, queue one more
/// instead. What it said.
pub fn step(ctx: &Context, config: &Config, merged: &[Pr]) -> io::Result<Vec<String>> {
    let installs = load(&ctx.config_dir)?;
    let mut said = vec![];
    for (slug, repo) in (config.repos.iter()).filter(|(_, r)| r.install.is_some()) {
        let install = installs.get(slug).cloned().unwrap_or_default();
        let mut into = merged.iter().filter(|pr| pr.repo == *slug).peekable();
        // Asked only on a merge: a merge into a stacked branch is no merge into it.
        let base = match (into.peek(), &repo.base) {
            (None, _) => None,
            (Some(_), Some(base)) => Some(base.clone()),
            (Some(_), None) => match ctx.world.git_default_branch(&repo.path) {
                Ok(base) => Some(base),
                Err(e) => {
                    said.push(format!(
                        "could not tell whether a merge into {slug} was into its Base: {e}"
                    ));
                    None
                }
            },
        };
        let merge = base.filter(|base| into.any(|pr| pr.base == *base));
        if merge.is_none() && !install.queued {
            continue;
        }
        if let Some(pid) = install.running(ctx.world) {
            if let Some(base) = merge {
                update(&ctx.config_dir, slug, |install| install.queued = true)?;
                said.push(format!(
                    "{slug}: a PR merged into {base} while its Install runs (pid {pid}); one more queued"
                ));
            }
            continue;
        }
        said.push(start(ctx, slug, repo, install.workspace.as_deref())?);
    }
    Ok(said)
}

/// Run `nico-agent install <slug>` in a new tab of a new workspace
/// `install-<repo>` on its clone, closing the last one's; one that could not
/// be is queued again. What it said.
fn start(ctx: &Context, slug: &str, repo: &Repo, last: Option<&str>) -> io::Result<String> {
    let (world, label) = (ctx.world, launch::repo_agent_name("install", slug));
    let mut made = None;
    let opened = (|| {
        if let Some(last) = last {
            world.herdr_workspace_close(last)?;
        }
        let workspace = made.insert(world.herdr_workspace_create(&repo.path, &label)?);
        let tab = world.herdr_tab_create(workspace, &repo.path, "install")?;
        world.herdr_pane_run(&tab.pane, &format!("nico-agent install {slug}"))
    })();
    update(&ctx.config_dir, slug, |install| {
        install.workspace = made.or(install.workspace.take());
        install.queued = opened.is_err();
    })?;
    Ok(match opened {
        Ok(()) => format!("{slug}: Install started in {label}"),
        Err(e) => format!("could not start the Install of {slug}, queued again: {e}"),
    })
}

/// Take the Repo's Install for this process, any queued one with it, unless
/// another live process runs one: then queue one more and say its pid.
fn claim(ctx: &Context, slug: &str) -> io::Result<Option<u32>> {
    update(&ctx.config_dir, slug, |install| {
        if let Some(pid) = install.running(ctx.world) {
            install.queued = true;
            return Some(pid);
        }
        install.runner = Some(ctx.world.process_id());
        install.runner_boot = Some(ctx.world.boot_id());
        install.queued = false;
        None
    })
}

/// Install in the Repo's clone, started `at`: how it went.
fn run(world: &dyn World, repo: &Repo, command: &str, at: String) -> Last {
    let path = &repo.path;
    let pulled = || -> WorldResult<String> {
        let base = match &repo.base {
            Some(base) => base.clone(),
            None => world.git_default_branch(path)?,
        };
        let on = world.git_branch(path)?;
        if on != base {
            let on = if on.is_empty() { "no branch" } else { &on };
            return Err(WorldError(format!(
                "{path} is on {on}, not its Base {base}"
            )));
        }
        let changes = world.git_tracked_changes(path)?;
        if !changes.is_empty() {
            let changes = changes.join(", ");
            return Err(WorldError(format!(
                "{path} has changes to tracked files: {changes}"
            )));
        }
        world.git_pull(path)?;
        world.git_head(path)
    };
    let sha = match pulled() {
        Ok(sha) => sha,
        Err(e) => {
            return Last {
                at,
                sha: None,
                ok: false,
                output: e.0,
            };
        }
    };
    let (ok, printed) = world.shell(path, command).unwrap_or_else(|e| (false, e.0));
    let lines: Vec<&str> = printed.lines().collect();
    Last {
        at,
        sha: Some(sha),
        ok,
        output: lines[lines.len().saturating_sub(OUTPUT_LINES)..].join("\n"),
    }
}

/// Change the Repo `slug`'s Installs under the file's lock.
fn update<T>(
    config_dir: &Path,
    slug: &str,
    change: impl FnOnce(&mut Install) -> T,
) -> io::Result<T> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: BTreeMap<String, Install> = state::parse(&file, text)?;
        let out = change(all.entry(slug.into()).or_default());
        Ok((state::text(&all), out))
    })
}

/// Every Repo's Installs, by slug.
pub fn load(config_dir: &Path) -> io::Result<BTreeMap<String, Install>> {
    state::load(&config_dir.join(FILE))
}

/// The Repo's Install as `status` shows it, if it has a command.
pub fn shown(installs: &BTreeMap<String, Install>, slug: &str, repo: &Repo) -> Option<Value> {
    let last = installs.get(slug).and_then(|i| i.last.as_ref());
    (repo.install.as_ref()).map(|command| json!({ "command": command, "last": last }))
}
