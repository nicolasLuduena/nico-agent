//! Readiness checks: per Repo, what would break it before it does, said in
//! needs-you. Checked when `serve` starts, on Refresh and after a write to a
//! Repo's or its Project's settings; never on a plain tick, and never
//! stopping a step. Kept in `checks.json`, a Repo's rewritten only when its
//! results change, so `changed` is sent only then.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cli::Context;
use crate::config::{Config, Repo};
use crate::repo;
use crate::state;
use crate::world::{World, WorldResult};

pub const FILE: &str = "checks.json";

/// A Repo's checks, and since when they say what they say.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Checks {
    /// When they were first found to say this.
    pub at: String,
    pub results: Vec<Check>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Check {
    pub name: String,
    pub ok: bool,
    pub said: String,
    /// What to do about it, while it fails.
    pub help: Option<String>,
}

/// Every Repo's checks, by slug.
pub fn load(config_dir: &Path) -> io::Result<BTreeMap<String, Checks>> {
    state::load(&config_dir.join(FILE))
}

/// Check each Repo of `config` that `which` picks, by its slug and Repo,
/// and keep what each found.
pub fn run(ctx: &Context, config: &Config, which: impl Fn(&str, &Repo) -> bool) -> io::Result<()> {
    let checked: Vec<(String, Vec<Check>)> = (config.repos.iter())
        .filter(|(slug, repo)| which(slug, repo))
        .map(|(slug, repo)| (slug.clone(), check(ctx.world, config, slug, repo)))
        .collect();
    let at = state::iso(ctx.world.now());
    let file = ctx.config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: BTreeMap<String, Checks> = state::parse(&file, text)?;
        for (slug, results) in checked {
            if all.get(&slug).is_none_or(|was| was.results != results) {
                let at = at.clone();
                all.insert(slug, Checks { at, results });
            }
        }
        Ok::<_, io::Error>((state::text(&all), ()))
    })
}

fn ok(name: &str, said: String) -> Check {
    Check {
        name: name.into(),
        ok: true,
        said,
        help: None,
    }
}

fn failing(name: &str, said: String, help: String) -> Check {
    Check {
        name: name.into(),
        ok: false,
        said,
        help: Some(help),
    }
}

/// The Repo's checks, in order; those in its clone only when it is one.
fn check(world: &dyn World, config: &Config, slug: &str, repo: &Repo) -> Vec<Check> {
    let path = &repo.path;
    let mut results = vec![match repo::clone_of(world, slug, path) {
        Ok(()) => ok("clone", format!("{path} is a clone of {slug}")),
        Err(no) => failing("clone", no.error, no.help.join("; ")),
    }];
    if results[0].ok {
        let fetches = world.git_ls_remote(path);
        // origin may be asked its default branch, and one that asks for a
        // passphrase would hold serve's start: then the Base's tip goes unchecked.
        let base = match (&repo.base, &fetches) {
            (Some(base), _) => Some(Ok(base.clone())),
            (None, Ok(())) => Some(world.git_default_branch(path)),
            (None, Err(_)) => None,
        };
        if let (Ok(()), Some(Ok(base))) = (&fetches, &base) {
            // One that fails leaves the tip the clone had, or none, which the checks below say.
            let _ = world.git_fetch(path, Some(base));
        }
        results.push(match fetches {
            Ok(()) => ok(
                "fetch",
                format!("{path} fetches from origin without asking"),
            ),
            Err(e) => failing(
                "fetch",
                e.0,
                "Load its key with `ssh-add`, or set origin to its https URL".into(),
            ),
        });
        if let Some(base) = base {
            results.push(evidence(world, path, &base));
            results.push(verification(world, path, &base));
        }
    }
    results.push(skills(world, config, repo));
    results.push(bot(world, slug));
    results
}

/// `.evidence/` ignored by the `.gitignore` at the tip of the Base.
fn evidence(world: &dyn World, path: &str, base: &WorldResult<String>) -> Check {
    let help = "Add `.evidence/` to the Base's .gitignore, or Close cannot remove a worktree";
    match at_tip(base, |tip| world.git_show(path, tip, ".gitignore")) {
        Ok((base, text)) if ignores_evidence(text.as_deref().unwrap_or_default()) => {
            ok("evidence", format!(".evidence/ is ignored on {base}"))
        }
        Ok((base, _)) => failing(
            "evidence",
            format!(".evidence/ is not ignored on {base}"),
            help.into(),
        ),
        Err(e) => failing("evidence", e.0, help.into()),
    }
}

/// What `read` finds at the tip of `base`, with the Base's name.
fn at_tip<T>(
    base: &WorldResult<String>,
    read: impl FnOnce(&str) -> WorldResult<T>,
) -> WorldResult<(String, T)> {
    let base = base.clone()?;
    let found = read(&format!("origin/{base}"))?;
    Ok((base, found))
}

/// Whether the `.gitignore` `text` ignores the root's `.evidence/`, by a
/// pattern naming it. shortcut: a glob only matching it (`.e*`) is not read
/// as one; read globs if a Repo ever relies on one.
fn ignores_evidence(text: &str) -> bool {
    let mut ignored = false;
    for line in text.lines().map(str::trim) {
        let (negated, pattern) = match line.strip_prefix('!') {
            Some(pattern) => (true, pattern),
            None => (false, line),
        };
        let pattern = (pattern.trim_start_matches("**/").trim_start_matches('/'))
            .trim_end_matches(['/', '*']);
        if pattern == ".evidence" {
            ignored = !negated;
        }
    }
    ignored
}

/// A Verification skill, `.agents/skills/verify-*/`, at the tip of the Base.
fn verification(world: &dyn World, path: &str, base: &WorldResult<String>) -> Check {
    let help = "Add the Repo's Verification skill as .agents/skills/verify-<name>/ on the Base; without it every Verdict fails";
    match at_tip(base, |tip| world.git_ls_tree(path, tip, ".agents/skills")) {
        Ok((base, skills)) => match skills.iter().find(|s| s.starts_with("verify-")) {
            Some(skill) => ok(
                "verification",
                format!("{base} has the Verification skill {skill}"),
            ),
            None => failing(
                "verification",
                format!("{base} has no Verification skill under .agents/skills/verify-*/"),
                help.into(),
            ),
        },
        Err(e) => failing("verification", e.0, help.into()),
    }
}

/// Each skill a prompt names for a step the Repo has on, found for the
/// Harness that step runs on in one of its `skill_dirs`.
fn skills(world: &dyn World, config: &Config, repo: &Repo) -> Check {
    let (prompts, on) = (&config.prompts, &repo.switches);
    let reviewer = config.reviewer(repo, &repo.implementer.harness);
    let (faux_nico, quality_scan) = (
        repo.or_implementer(&repo.faux_nico),
        repo.or_implementer(&repo.quality_scan),
    );
    let steps = [
        (
            true,
            &prompts.implement,
            "the Implementer's",
            &repo.implementer,
        ),
        (
            true,
            &prompts.research,
            "the Implementer's",
            &repo.implementer,
        ),
        (on.review, &prompts.review, "the Reviewer's", &reviewer),
        (on.answer, &prompts.faux_nico, "faux-nico's", &faux_nico),
        (
            on.quality_scan,
            &prompts.quality_scan,
            "the quality-scan's",
            &quality_scan,
        ),
    ];
    let (mut missing, mut help) = (vec![], vec![]);
    for (_, prompt, whose, launch) in steps.iter().filter(|(on, ..)| *on) {
        let (Some(skill), Some(harness)) =
            (skill_of(prompt), config.harnesses.get(&launch.harness))
        else {
            continue;
        };
        let dirs: Vec<String> = (harness.skill_dirs.iter())
            .map(|dir| match dir.starts_with("~/") || dir.starts_with('/') {
                true => dir.clone(),
                false => format!("{}/{dir}", repo.path),
            })
            .collect();
        if dirs.iter().any(|dir| world.has_skill(dir, skill)) {
            continue;
        }
        let name = &launch.harness;
        missing.push(format!("no {skill} skill for {name}, {whose} Harness"));
        help.push(match dirs.is_empty() {
            true => format!("Set harnesses.{name}.skill_dirs to where {name} reads skills"),
            false => format!("Install {skill} in one of {}", dirs.join(", ")),
        });
    }
    match missing.is_empty() {
        true => ok(
            "skills",
            "each skill a step names is installed for its Harness".into(),
        ),
        false => failing("skills", missing.join("; "), help.join("; ")),
    }
}

/// The skill `prompt` calls: the name after its `{sigil}`.
fn skill_of(prompt: &str) -> Option<&str> {
    let (_, called) = prompt.split_once("{sigil}")?;
    let name = called
        .split(|c: char| !(c.is_ascii_alphanumeric() || "-_".contains(c)))
        .next()?;
    (!name.is_empty()).then_some(name)
}

/// Whether the GitHub App is installed on the Repo `slug`, which the
/// implement prompt's bot suffix needs.
pub fn app_installed(world: &dyn World, slug: &str) -> WorldResult<bool> {
    let repos = world.github_app_repos()?;
    Ok(repos.iter().any(|r| r.eq_ignore_ascii_case(slug)))
}

fn bot(world: &dyn World, slug: &str) -> Check {
    match app_installed(world, slug) {
        Ok(true) => ok("bot", format!("the GitHub App is installed on {slug}")),
        Ok(false) => failing(
            "bot",
            format!("the GitHub App is not installed on {slug}"),
            format!("Install it on {slug}, or its PRs are opened as you, not the bot"),
        ),
        Err(e) => failing(
            "bot",
            format!("could not check the GitHub App on {slug}: {e}"),
            "Run `ghbot api /installation/repositories` to see why; till then its PRs are opened as you, not the bot".into(),
        ),
    }
}
