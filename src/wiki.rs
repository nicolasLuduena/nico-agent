//! A Repo's or a Library version's Wiki, built by `wiki build` from scratch,
//! with `--update` from the Wiki before it, asking only about what changed,
//! or with `--continue` asking only about the parts its budget left Gaps.
//! Its code, a Repo's at `origin/<base>` or a Library version's at its tag
//! under its subfolder, is divided top-down, as know-the-map's hermeneut does:
//! each part is one headless, read-only call of the `[wiki]` launch, and
//! code checks every answer, sending each claim that fails back to the
//! model in the same session, up to 3 rounds, then dropping it and recording
//! its part as a Gap. The Wiki lands in the Bucket in one commit, then its
//! records are embedded for `ask`; the build's outcome in `wikis.json`, last.
//!
//! The loop runs each build as a Run in a herdr pane, one at a time across
//! every Wiki and outside every room, the others waiting in `wiki-queue.json`;
//! the Board's buttons queue theirs first.
//!
//! Between builds, whoever serves a Repo's Wiki marks Stale each
//! Interpretation citing a file whose blob at `origin/<base>` is not the one
//! it was written against.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::{fs, io};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::ask;
use crate::away::{self, Run, Trigger};
use crate::bucket;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config::{self, Config, Harness, Launch, Library, Repo, fill_in};
use crate::dispatch;
use crate::install::base;
use crate::launch;
use crate::repo;
use crate::state;
use crate::world::{Answered, Called, Headless, World, WorldResult};

/// Each Wiki's last build, by its id: a Repo's slug, or a Library version's.
pub const FILE: &str = "wikis.json";

/// The Wikis waiting for a build, and when each one was last checked.
const QUEUE: &str = "wiki-queue.json";

/// The builds a button or a flag asks for: `--update`, `--rebuild` (from
/// scratch, as with no flag) or `--continue`.
pub const BUILDS: [&str; 3] = ["update", "rebuild", "continue"];

/// The id of a Wiki's top Component: the whole of its code.
const INDEX: &str = "index";

const KINDS: [&str; 5] = [
    "invariant",
    "precondition",
    "postcondition",
    "effect",
    "role",
];
const RELATIONSHIPS: [&str; 4] = ["uses", "calls", "reads", "writes"];
/// The most steps an Explainer has.
const MOST_STEPS: usize = 8;

/// How many times a part's failing claims go back to the model.
const ROUNDS: u32 = 3;

/// How a build ended, as `wikis.json` keeps it: `"outcome": "built"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum Outcome {
    Built(Built),
    Failed {
        at: String,
        why: String,
        /// The last build that built the Wiki, whose Wiki the Bucket still holds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        built: Option<Built>,
    },
}

/// A build that built its Wiki.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Built {
    at: String,
    commit: String,
    components: usize,
    /// How many Gaps of each reason it left.
    gaps: BTreeMap<String, usize>,
}

/// How far a build has got, in `wiki/<folder>/progress.json` beside its
/// `build.lock`: written as it starts, as each call starts and answers and
/// at each Gap, removed once the build ends, built or failed.
#[derive(Default, Serialize, Deserialize)]
struct Progress {
    /// When the build started; as `status` shows it, when its Run did.
    at: String,
    /// The calls it may make, and those it started.
    calls: u32,
    made: u32,
    /// How deep it may divide, and the deepest part it asked.
    depth: u32,
    reached: u32,
    /// The parts asked, those sent back for a correction round, and the Gaps so far.
    asked: usize,
    sent_back: usize,
    gaps: usize,
    /// The trails of the parts asked now, each till its call answers.
    now: Vec<String>,
}

impl Progress {
    /// Count `called`, a call about `part` in its correction round `round`
    /// (0: its first ask), and keep it: started, a call made, its part asked
    /// or sent back, and asked now; answered, asked no more.
    fn told(&mut self, file: &Path, called: Called, part: &Part, round: u32) {
        match called {
            Called::Started => {
                self.made += 1;
                match round {
                    0 => self.asked += 1,
                    // One sent back again in a later round was counted in its first.
                    1 => self.sent_back += 1,
                    _ => {}
                }
                self.reached = self.reached.max(part.depth);
                self.now.push(part.trail.clone());
            }
            Called::Answered => self.now.retain(|trail| *trail != part.trail),
        }
        self.keep(file);
    }

    fn keep(&self, file: &Path) {
        // A build never fails for its progress: it is only shown.
        let _ = state::update(file, |_| Ok::<_, io::Error>((state::text(self), ())));
    }
}

/// A build's [`Progress`] file, removed however the build ends.
struct Removed(PathBuf);

impl Drop for Removed {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Queue {
    /// By id, in the order they start.
    waiting: Vec<String>,
    /// How each the user asked for is built, by id: one of [`BUILDS`].
    #[serde(default)]
    asked: BTreeMap<String, String>,
    /// When each Wiki was last checked: a Repo's against its Base, a Library
    /// version's for having none, by id.
    #[serde(default)]
    checked: BTreeMap<String, String>,
}

/// Close the wiki Run whose build ended; check each Wiki the loop builds
/// (a Repo's with its `wiki` switch on, and each Library version's) once a
/// day from the wiki hour and at once when it first is one, queueing it when
/// it has none or, a Repo's, when its `origin/<base>` moved from its commit;
/// then start the first queued while no wiki Run is open, built as a button
/// asked, or else an Update once a Repo has a Wiki. A check that fails is
/// said and tried again next tick, as is one of a Wiki whose build waits or
/// runs. What it said.
pub fn step(ctx: &Context, config: &Config) -> Result<Vec<String>, Refusal> {
    let mut said = close(ctx)?;
    let outcomes = load(&ctx.config_dir)?;
    let runs = away::load(&ctx.config_dir)?;
    let open = open_run(&runs).and_then(|r| r.repo.as_ref());
    let queue: Queue = state::load(&ctx.config_dir.join(QUEUE))?;
    let slot = state::iso(away::last_slot(ctx, None, config.wiki.hour));
    let (mut queued, mut checked) = (vec![], vec![]);
    for of in every(config).into_iter().filter(Of::looped) {
        let id = of.id();
        let due = queue.checked.get(&id).is_none_or(|at| *at < slot);
        // One waiting or building is checked once built: a Continue builds at its Wiki's commit.
        if !due || queue.waiting.contains(&id) || open == Some(&id) {
            continue;
        }
        let why = match (outcomes.get(&id).and_then(Outcome::wiki), &of) {
            (None, _) => Some("it has none".into()),
            // A tag never moves: a Library version's Wiki is built once.
            (Some(_), Of::Library(_)) => None,
            (Some(Built { commit, .. }), Of::Repo(slug, repo)) => {
                match base_head(ctx.world, repo) {
                    Err(e) => {
                        said.push(format!("could not check {slug}'s Base for its Wiki: {e}"));
                        continue;
                    }
                    Ok((_, head)) if head == *commit => None,
                    Ok((base, head)) => {
                        Some(format!("origin/{base} moved from {commit} to {head}"))
                    }
                }
            }
        };
        queued.extend(why.map(|why| (id.clone(), why)));
        checked.push(id);
    }
    let now = state::iso(ctx.world.now());
    let next = update_queue(&ctx.config_dir, |queue| {
        // A Repo's switched off, or a Library version no longer linked nor
        // added, is built no more: one waiting waits no longer, and its check
        // is forgotten, so it is checked once it is one again. One the user
        // asked for is built all the same, while the config names it.
        let on = |id: &String| of(config, id).is_some_and(|of| of.looped());
        queue.asked.retain(|id, _| of(config, id).is_some());
        queue
            .waiting
            .retain(|id| on(id) || queue.asked.contains_key(id));
        queue.checked.retain(|id, _| on(id));
        for (id, why) in queued {
            // Not one a button queued since the queue was read.
            if queue.waiting.contains(&id) {
                continue;
            }
            said.push(format!("{id}: wiki queued, {why}"));
            queue.waiting.push(id);
        }
        for id in checked {
            queue.checked.insert(id, now.clone());
        }
        (open.is_none() && !queue.waiting.is_empty()).then(|| {
            let id = queue.waiting.remove(0);
            let how = queue.asked.remove(&id);
            (id, how)
        })
    })?;
    if let Some((id, how)) = next {
        let cwd = match of(config, &id).expect("only a Wiki the config names waits") {
            Of::Repo(_, repo) => repo.path.clone(),
            // No clone of its own till its build fetches one.
            Of::Library(_) => ctx.config_dir.display().to_string(),
        };
        // Once it has a Wiki, a Repo's is updated from it, unless asked otherwise.
        let has = outcomes.get(&id).and_then(Outcome::wiki);
        let how = how.or_else(|| has.map(|_| "update".into()));
        let flag = how.map_or(String::new(), |how| format!(" --{how}"));
        let start = |run: &mut Run| {
            let workspace =
                (run.workspace).insert(ctx.world.herdr_workspace_create(&cwd, &run.launch.agent)?);
            let label = run.trigger.label();
            launch::open_tab(ctx.world, &mut run.launch, workspace, &cwd, label)?;
            let pane = run.launch.pane.as_deref().expect("its tab is open");
            // Its shell exits with it, so a pane gone is a build ended.
            let command = format!(
                "nico-agent wiki build {}{flag}; exit",
                launch::shell_word(&id)
            );
            Ok(ctx.world.herdr_pane_run(pane, &command)?)
        };
        let chosen = config.wiki.launch.clone();
        said.push(away::start_run(
            ctx,
            Trigger::Wiki,
            Some(&id),
            chosen,
            start,
        )?);
    }
    Ok(said)
}

/// Queue each Library version the config names that no build has tried,
/// unless it waits or builds already, as the next tick would: one the user
/// just linked or added.
pub fn queue_new(ctx: &Context, config: &Config) -> Result<(), Refusal> {
    let tried = load(&ctx.config_dir)?;
    let runs = away::load(&ctx.config_dir)?;
    let open = open_run(&runs).and_then(|r| r.repo.clone());
    Ok(update_queue(&ctx.config_dir, |queue| {
        for id in config.libraries().into_keys() {
            if !tried.contains_key(&id) && !queue.waiting.contains(&id) && open != Some(id.clone())
            {
                queue.waiting.push(id);
            }
        }
    })?)
}

/// Take the Wiki `of` out of the Bucket's files in one commit, its history
/// keeping it, and forget its builds and its place in the queue, so it is
/// built again once it is one again; refused while it builds. Whether the
/// Bucket held it.
pub fn forget(ctx: &Context, config: &Config, of: &Of) -> Result<bool, Refusal> {
    let id = of.id();
    let runs = away::load(&ctx.config_dir)?;
    if open_run(&runs).is_some_and(|r| r.repo.as_ref() == Some(&id)) {
        return Err(Refusal::new(
            format!("the Wiki of {id} is building"),
            vec![
                "Remove it once its build ends, built or failed, as `nico-agent status` shows"
                    .into(),
            ],
        ));
    }
    let message = format!("wiki {id} removed");
    let dropped = bucket::drop_wiki(ctx, config, &of.folder(), &message)?;
    update_queue(&ctx.config_dir, |queue| {
        queue.waiting.retain(|waiting| *waiting != id);
        queue.checked.remove(&id);
    })?;
    let file = ctx.config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: BTreeMap<String, Outcome> = state::parse(&file, text)?;
        all.remove(&id);
        Ok::<_, io::Error>((state::text(&all), ()))
    })?;
    Ok(dropped)
}

/// Close the open wiki Run once its build wrote an outcome since it
/// started, or once its pane is gone without one: failed, which `wikis.json`
/// then keeps. Closing closes its workspace; one that fails is said and
/// tried again next tick. What it said.
fn close(ctx: &Context) -> Result<Vec<String>, Refusal> {
    let runs = away::load(&ctx.config_dir)?;
    let Some(run) = open_run(&runs) else {
        return Ok(vec![]);
    };
    let id = run
        .repo
        .as_deref()
        .expect("a wiki Run is of a Wiki, by its id");
    // Asked first: a pane gone is a build exited, its outcome written if any.
    let gone = match (&run.failure, &run.launch.pane) {
        (None, Some(pane)) => match ctx.world.herdr_pane_exists(pane) {
            Ok(there) => !there,
            Err(e) => return Ok(vec![format!("could not find the pane of {id}'s wiki: {e}")]),
        },
        // Its start stopped short of the build.
        _ => true,
    };
    let ended = load(&ctx.config_dir)?.remove(id);
    let outcome = match ended.filter(|o| o.at() >= run.at.as_str()) {
        Some(outcome) => outcome,
        None if gone => {
            let why = (run.failure.clone())
                .unwrap_or_else(|| "its pane is gone without an outcome".into());
            let failed = Outcome::Failed {
                at: state::iso(ctx.world.now()),
                why,
                built: None,
            };
            keep(&ctx.config_dir, id, &failed)?;
            failed
        }
        None => return Ok(vec![]),
    };
    let mut said = match &outcome {
        Outcome::Built(Built { commit, .. }) => format!("{id}: wiki built at {commit}"),
        Outcome::Failed { why, .. } => format!("{id}: wiki failed: {why}"),
    };
    if let Some(workspace) = &run.workspace {
        if let Err(e) = ctx.world.herdr_workspace_close(workspace) {
            return Ok(vec![format!(
                "could not close the workspace of {id}'s wiki: {e}"
            )]);
        }
        said += "; its workspace closed";
    }
    let now = state::iso(ctx.world.now());
    away::update(&ctx.config_dir, |all| {
        let open = all
            .iter_mut()
            .find(|r| r.trigger == Trigger::Wiki && r.closed_at.is_none());
        open.map(|r| r.closed_at = Some(now))
    })?;
    Ok(vec![said])
}

/// Every Wiki built, tried, queued or building, as `status` shows it: its
/// state, the commit, time and Gaps of the build that built it, why its
/// last build failed if it did, and while its Run is open, how far the
/// build it runs has got, from when the Run started.
pub fn shown(config_dir: &Path, config: &Config, runs: &[Run]) -> io::Result<Vec<Value>> {
    let outcomes = load(config_dir)?;
    let queue: Queue = state::load(&config_dir.join(QUEUE))?;
    let open = open_run(runs);
    let mut ids: Vec<&String> = outcomes.keys().chain(&queue.waiting).collect();
    ids.extend(open.and_then(|r| r.repo.as_ref()));
    ids.sort();
    ids.dedup();
    (ids.into_iter())
        .map(|id| {
            let building = open.filter(|r| r.repo.as_ref() == Some(id));
            let progress = match (building, of(config, id)) {
                (Some(run), Some(of)) => {
                    let progress: Option<Progress> = state::load(&of.progress(config_dir))?;
                    // Not one a build before this Run's left behind.
                    (progress.filter(|p| p.at >= run.at)).map(|p| Progress {
                        at: run.at.clone(),
                        ..p
                    })
                }
                _ => None,
            };
            let outcome = outcomes.get(id);
            let state = match outcome {
                _ if building.is_some() => "building",
                _ if queue.waiting.contains(id) => "queued",
                Some(Outcome::Built(_)) => "built",
                _ => "failed",
            };
            let mut shown = json!({
                "wiki": id,
                "target": Target::of(id),
                "state": state,
                "commit": null,
                "built_at": null,
                "gaps": null,
                "pane": building.and_then(|r| r.launch.pane.clone()),
                "progress": progress,
            });
            if let Some(Built {
                at, commit, gaps, ..
            }) = outcome.and_then(Outcome::wiki)
            {
                shown["commit"] = json!(commit);
                shown["built_at"] = json!(at);
                shown["gaps"] = json!(gaps.values().sum::<usize>());
            }
            if let Some(Outcome::Failed { at, why, .. }) = outcome {
                shown["failed_at"] = json!(at);
                shown["why"] = json!(why);
            }
            Ok(shown)
        })
        .collect()
}

/// The Wikis faux-nico and morning are given of `repos`: each one's with its
/// `wiki` switch on and its Wiki built, by slug, and what the `wiki` prompt
/// says of them, one after another, for their `{wikiLine}`.
pub fn given<'a>(
    config_dir: &Path,
    config: &Config,
    repos: impl IntoIterator<Item = (&'a String, &'a Repo)>,
) -> io::Result<(Vec<String>, String)> {
    let outcomes = load(config_dir)?;
    let (mut wikis, mut line) = (vec![], String::new());
    for (slug, _) in repos.into_iter().filter(|(_, r)| r.switches.wiki) {
        if let Some(Built { commit, .. }) = outcomes.get(slug).and_then(Outcome::wiki) {
            line += &fill_in(&config.prompts.wiki, &[("repo", slug), ("sha", commit)]);
            wikis.push(slug.clone());
        }
    }
    Ok((wikis, line))
}

/// The Wikis an Implementer, Reviewer and quality-scan of `repo` are given:
/// each Library version it links whose Wiki is built, by id, and what the
/// `libraries` prompt says of them, for the end of their prompt; nothing
/// when none is. Never the Repo's own.
pub fn libraries(
    config_dir: &Path,
    config: &Config,
    repo: &Repo,
) -> io::Result<(Vec<String>, String)> {
    let outcomes = load(config_dir)?;
    let built = |id: &String| outcomes.get(id).and_then(Outcome::wiki).is_some();
    let wikis: Vec<String> = (repo.libraries.iter().map(Library::id))
        .filter(built)
        .collect();
    let named = wikis.join(", ");
    let line = match wikis.is_empty() {
        true => String::new(),
        false => fill_in(&config.prompts.libraries, &[("libraries", &named)]),
    };
    Ok((wikis, line))
}

/// The Repo's Base, and the commit its `origin/<base>` is on, fetched.
fn base_head(world: &dyn World, repo: &Repo) -> WorldResult<(String, String)> {
    let base = base(world, repo)?;
    world.git_fetch(&repo.path, None)?;
    let head = world.git_rev(&repo.path, &format!("origin/{base}"))?;
    Ok((base, head))
}

/// The wiki Run open, if one is.
fn open_run(runs: &[Run]) -> Option<&Run> {
    (runs.iter()).find(|r| r.trigger == Trigger::Wiki && r.closed_at.is_none())
}

impl Outcome {
    /// When the build ended.
    fn at(&self) -> &str {
        match self {
            Outcome::Built(Built { at, .. }) | Outcome::Failed { at, .. } => at,
        }
    }

    /// The last build that built the Wiki: this one, or the one before it failed.
    fn wiki(&self) -> Option<&Built> {
        match self {
            Outcome::Built(built) => Some(built),
            Outcome::Failed { built, .. } => built.as_ref(),
        }
    }
}

/// A Wiki as the Bucket keeps it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Wiki {
    version: u32,
    target: Target,
    commit: String,
    built_at: String,
    files: Vec<File>,
    components: Vec<Component>,
}

/// What a Wiki is of: a Repo, or a Library version at its tag and subfolder.
#[derive(Serialize, Deserialize)]
struct Target {
    repo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

impl Target {
    /// What the Wiki `id` is of, read back as [`Library::id`] writes it.
    fn of(id: &str) -> Target {
        let (repo, version) = id.split_once('@').unwrap_or((id, ""));
        let (tag, path) = match version.split_once(':') {
            Some((tag, path)) => (tag, Some(path.into())),
            None => (version, None),
        };
        let tag = (!tag.is_empty()).then(|| tag.into());
        Target {
            repo: repo.into(),
            tag,
            path,
        }
    }
}

/// A Wiki the config names: a Repo's, of its code at its Base, or a Library
/// version's, of its code at its tag under its subfolder.
pub enum Of<'a> {
    Repo(&'a str, &'a Repo),
    Library(&'a Library),
}

impl Of<'_> {
    /// Whether the loop builds it: a Repo's with its `wiki` switch on, and
    /// every Library version's.
    fn looped(&self) -> bool {
        match self {
            Of::Repo(_, repo) => repo.switches.wiki,
            Of::Library(_) => true,
        }
    }

    /// Its id: the Repo's slug, or the Library version's.
    pub fn id(&self) -> String {
        match self {
            Of::Repo(slug, _) => slug.to_string(),
            Of::Library(library) => library.id(),
        }
    }

    /// Where it is kept, under `wiki/` in the Bucket and in the config
    /// directory: the Repo's slug, or `<owner/name>/<tag>[/<path>]`, the
    /// tag's `%` and `/` escaped so that it is one folder.
    // shortcut: a tag or subfolder named as a Wiki's own files there (`checkout`, `build.lock`, `vectors.json`) shares them; escape such names if one is ever used.
    pub fn folder(&self) -> String {
        match self {
            Of::Repo(slug, _) => slug.to_string(),
            Of::Library(Library { repo, tag, path }) => {
                let tag = tag.replace('%', "%25").replace('/', "%2F");
                let path = path.as_ref().map_or(String::new(), |p| format!("/{p}"));
                format!("{repo}/{tag}{path}")
            }
        }
    }

    /// Where its build keeps its [`Progress`] while it runs.
    fn progress(&self, config_dir: &Path) -> PathBuf {
        let folder = config_dir.join("wiki").join(self.folder());
        folder.join("progress.json")
    }

    /// The clone holding its commits: the Repo's, or the Library's bare one,
    /// cached in the config directory for every version of it.
    pub fn clone_dir(&self, config_dir: &Path) -> String {
        match self {
            Of::Repo(_, repo) => repo.path.clone(),
            Of::Library(library) => {
                let clone = config_dir.join("libraries").join(&library.repo);
                format!("{}.git", clone.display())
            }
        }
    }
}

/// The Wiki `id` names, if the config has it: a Repo's by its slug, in any
/// casing, or a Library version's by its id.
pub fn of<'a>(config: &'a Config, id: &str) -> Option<Of<'a>> {
    match config.repo(id) {
        Some((slug, repo)) => Some(Of::Repo(slug, repo)),
        None => config.libraries().remove(id).map(Of::Library),
    }
}

/// Every Wiki the config names: each Repo's, then each Library version's.
pub fn every(config: &Config) -> Vec<Of<'_>> {
    let repos = (config.repos.iter()).map(|(slug, repo)| Of::Repo(slug, repo));
    let libraries = config.libraries().into_values().map(Of::Library);
    repos.chain(libraries).collect()
}

#[derive(Serialize, Deserialize)]
struct File {
    path: String,
    blob: String,
    lines: usize,
}

#[derive(Serialize, Deserialize)]
struct Component {
    id: String,
    name: String,
    parent: Option<String>,
    overview: String,
    files: Vec<String>,
    interpretations: Vec<Interpretation>,
    relationships: Vec<Relationship>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    explainer: Option<Explainer>,
    gaps: Vec<Gap>,
    /// The blob each file its Interpretations cite had when they were
    /// written, where the Wiki's has moved on since: one an Update kept.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    blobs: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct Interpretation {
    /// Its place among its Component's, from 1; never the model's to say.
    #[serde(default)]
    id: usize,
    kind: String,
    text: String,
    anchors: Vec<Anchor>,
}

/// Lines of a file, 1-based and inclusive.
#[derive(Serialize, Deserialize)]
pub struct Anchor {
    pub path: String,
    pub start: usize,
    pub end: usize,
}

/// A leaf's walkthrough: steps numbered from 1 in order, each citing
/// Anchors, and arrows between them by number.
#[derive(Serialize, Deserialize)]
struct Explainer {
    title: String,
    steps: Vec<Step>,
    #[serde(default)]
    arrows: Vec<Arrow>,
}

#[derive(Serialize, Deserialize)]
struct Step {
    n: usize,
    caption: String,
    anchors: Vec<Anchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lane: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Arrow {
    from: usize,
    to: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Relationship {
    to: String,
    kind: String,
    description: String,
}

#[derive(Serialize, Deserialize)]
struct Gap {
    paths: Vec<String>,
    reason: String,
}

/// What the model answers for a part, each claim read on its own.
#[derive(Deserialize)]
struct Answer {
    kind: String,
    #[serde(default)]
    overview: String,
    #[serde(default)]
    components: Vec<Value>,
    #[serde(default)]
    relationships: Vec<Value>,
    #[serde(default)]
    interpretations: Vec<Value>,
    #[serde(default)]
    explainer: Option<Value>,
}

/// A Component a division names.
#[derive(Deserialize)]
struct Named {
    name: String,
    #[serde(default)]
    summary: String,
    files: Vec<String>,
}

/// A Relationship a division says, between two of its Components by name.
#[derive(Deserialize)]
struct Said {
    from: String,
    to: String,
    kind: String,
    #[serde(default)]
    description: String,
}

/// The claims of an answer that pass every check.
struct Checked {
    overview: String,
    interpretations: Vec<Interpretation>,
    named: Vec<Named>,
    said: Vec<Said>,
    explainer: Option<Explainer>,
}

/// A part of the code still to describe.
struct Part {
    id: String,
    name: String,
    parent: Option<String>,
    /// What its parent's division said of it; the top part has none.
    summary: String,
    /// Where it is, from the Repo down: `acme/api > Core`.
    trail: String,
    files: Vec<String>,
    depth: u32,
    relationships: Vec<Relationship>,
}

/// `wiki build <wiki> [--update|--rebuild|--continue]`: build the Wiki of a
/// Repo or a Library version from scratch (`--rebuild` too), with `--update`
/// from the one the Bucket holds, or with `--continue` fill in its budget
/// Gaps, and keep it in the Bucket, writing how it went to `wikis.json` as
/// the last act.
pub fn build(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let (how, args): (Vec<&str>, Vec<&str>) = (args.iter().copied()).partition(|a| {
        a.strip_prefix("--")
            .is_some_and(|how| BUILDS.contains(&how))
    });
    if how.len() > 1 {
        let error = "--update, --rebuild and --continue are one at a time";
        return Err(bad_invocation(error.into(), "wiki build"));
    }
    let args = Args::parse("wiki build", &args, &[])?;
    let id = args.positionals(&["<owner/name>"])?[0];
    let config = config::load(&ctx.config_dir)?;
    let of = named(ctx, &config, id)?;
    let how = how.first().map(|how| &how[2..]);
    let (id, built) = (&of.id(), built(ctx, &config, &of, how));
    let at = state::iso(ctx.world.now());
    let outcome = match &built {
        Ok(wiki) => {
            let mut gaps = BTreeMap::new();
            for gap in wiki.components.iter().flat_map(|c| &c.gaps) {
                *gaps.entry(gap.reason.clone()).or_default() += 1;
            }
            Outcome::Built(Built {
                at,
                commit: wiki.commit.clone(),
                components: wiki.components.len(),
                gaps,
            })
        }
        Err(no) => Outcome::Failed {
            at,
            why: no.error.clone(),
            built: None,
        },
    };
    keep(&ctx.config_dir, id, &outcome)?;
    let mut said = serde_json::to_value(&outcome).expect("an outcome is plain data");
    said["wiki"] = json!(id);
    built.map(|_| said).map_err(|no| Refusal {
        error: format!("could not build the Wiki of {id}: {}", no.error),
        ..no
    })
}

/// The Wiki `id` names, or the refusal of an id the config does not name.
fn named<'a>(ctx: &Context, config: &'a Config, id: &str) -> Result<Of<'a>, Refusal> {
    of(config, id).ok_or_else(|| match id.contains('@') {
        true => Refusal::new(
            format!("{id} is no Library version a Repo links or [wiki] adds"),
            vec![format!(
                "Link it in a Repo's `libraries`, or add it to `libraries` under [wiki], in {}",
                ctx.config_dir.join(config::FILE).display()
            )],
        ),
        false => repo::not_configured(id),
    })
}

/// `POST /api/wiki/<id>/<how>`: queue the build of the Wiki `id` first, to
/// be built `how`, one of [`BUILDS`]; a `continue` only of a Wiki with
/// budget Gaps. The queue after.
pub fn queue(ctx: &Context, id: &str, how: &str) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let of = named(ctx, &config, id)?;
    let id = of.id();
    if how == "continue" {
        let wiki = kept(ctx, &config, &of)?.ok_or_else(|| uncontinued(&id))?;
        if budget(&wiki) == 0 {
            return Err(Refusal::new(
                format!("the Wiki of {id} has no budget Gaps to continue"),
                vec!["Update it, or Rebuild it from nothing".into()],
            ));
        }
    }
    let waiting = update_queue(&ctx.config_dir, |queue| {
        queue.waiting.retain(|waiting| *waiting != id);
        queue.waiting.insert(0, id.clone());
        queue.asked.insert(id.clone(), how.into());
        queue.waiting.clone()
    })?;
    Ok(json!({ "wiki": id, "build": how, "waiting": waiting }))
}

/// The refusal of a `continue` of `id`, which has no Wiki.
fn uncontinued(id: &str) -> Refusal {
    Refusal::new(
        format!("{id} has no Wiki to continue"),
        vec![format!("Build it first: nico-agent wiki build {id}")],
    )
}

/// Each Gap of each Component of `wiki`, as the Bucket holds it.
fn gaps(wiki: &Value) -> impl Iterator<Item = &Value> {
    (wiki["components"].as_array().into_iter().flatten())
        .flat_map(|c| c["gaps"].as_array().into_iter().flatten())
}

/// How many Gaps of `wiki` its budget left: those a `continue` asks about.
fn budget(wiki: &Value) -> usize {
    gaps(wiki).filter(|g| g["reason"] == "budget").count()
}

/// `GET /api/wikis`: each Wiki the Bucket holds of a Repo or a Library
/// version, and each not built yet while its build waits, runs or failed, by
/// its id, with the commit it describes, when it was built, how many Gaps it
/// has and how many of them `continue` asks about with its `calls`, and the
/// `state` of its build as `status` shows it, with the open Run's pane and
/// the build's progress, or why it failed.
pub fn list(ctx: &Context) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let builds = shown(&ctx.config_dir, &config, &away::load(&ctx.config_dir)?)?;
    let mut wikis = vec![];
    for of in every(&config) {
        // One the Bucket holds that no build of this machine's made is built.
        let id = of.id();
        let build = builds.iter().find(|b| b["wiki"] == id);
        let build = build.cloned().unwrap_or(json!({ "state": "built" }));
        let wiki = match kept(ctx, &config, &of)? {
            Some(wiki) => wiki,
            None if build["state"] != "built" => {
                json!({ "target": build["target"], "commit": null, "builtAt": null })
            }
            None => continue,
        };
        wikis.push(json!({
            "id": id,
            "target": wiki["target"],
            "commit": wiki["commit"],
            "builtAt": wiki["builtAt"],
            "gaps": gaps(&wiki).count(),
            "budget": budget(&wiki),
            "calls": config.wiki.calls,
            "state": build["state"],
            "pane": build["pane"],
            "why": build["why"],
            "progress": build["progress"],
        }));
    }
    Ok(json!(wikis))
}

/// `GET /api/wiki/<id>`: the Wiki `id` names, as the Bucket holds it, a
/// Repo's marked against its Base; none for an id the config does not name,
/// or a Wiki never built.
pub fn get(ctx: &Context, id: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let Some(of) = of(&config, id) else {
        return Ok(None);
    };
    let Some(mut wiki) = kept(ctx, &config, &of)? else {
        return Ok(None);
    };
    // A tag never moves: a Library version's Wiki is never Stale.
    if let Of::Repo(_, repo) = of {
        marked(ctx.world, repo, &mut wiki)?;
    }
    Ok(Some(wiki))
}

/// Mark `wiki`, the Wiki of `repo` as the Bucket holds it, against the
/// Repo's `origin/<base>` as its clone last fetched it: `stale` on each
/// Interpretation citing a file whose blob there is not the one it was
/// written against, with how many are, and how many commits the Wiki's is
/// `behind` the Base.
pub fn marked(world: &dyn World, repo: &Repo, wiki: &mut Value) -> WorldResult<()> {
    let base = base(world, repo)?;
    let head = format!("origin/{base}");
    let now: HashMap<String, String> = (world.git_ls_tree_blobs(&repo.path, &head)?)
        .into_iter()
        .collect();
    let commit = wiki["commit"].as_str().unwrap_or_default().to_string();
    let behind = world.git_rev_count(&repo.path, &commit, &head)?;
    let files: HashMap<String, Value> = (wiki["files"].as_array().into_iter().flatten())
        .map(|f| {
            (
                f["path"].as_str().unwrap_or_default().into(),
                f["blob"].clone(),
            )
        })
        .collect();
    let mut stale = 0;
    for c in wiki["components"].as_array_mut().into_iter().flatten() {
        let pins = c["blobs"].clone();
        for i in c["interpretations"].as_array_mut().into_iter().flatten() {
            let moved = (i["anchors"].as_array().into_iter().flatten()).any(|a| {
                let path = a["path"].as_str().unwrap_or_default();
                let written = pins.get(path).or(files.get(path)).and_then(Value::as_str);
                written != now.get(path).map(String::as_str)
            });
            if moved {
                i["stale"] = json!(true);
                stale += 1;
            }
        }
    }
    wiki["base"] = json!(base);
    wiki["behind"] = json!(behind);
    wiki["stale"] = json!(stale);
    Ok(())
}

/// What `PATCH /api/wiki/settings` sets, each with what it is.
const SETTINGS: [(&str, &str); 6] = [
    (
        "hour",
        "hour is when the loop checks each Repo's Wiki against its Base, daily, local time",
    ),
    (
        "launch",
        "launch is the Harness, model and Effort each part is asked of",
    ),
    ("calls", "calls is how many model calls a build may make"),
    ("depth", "depth is how deep a build divides the code"),
    (
        "concurrency",
        "concurrency is how many calls a build makes at once",
    ),
    (
        "embed_model",
        "embed_model is the Ollama model that embeds each Wiki for `ask`",
    ),
];

/// Every Wiki's settings, `[wiki]` as it takes effect but `ollama`, with the
/// Harnesses a Wiki builds on and the models and Efforts each takes (null: any).
pub fn settings(config: &Config) -> Value {
    let wiki = &config.wiki;
    let harnesses: serde_json::Map<String, Value> = (builders(config))
        .map(|(name, h)| {
            let takes = json!({ "models": h.models, "efforts": h.efforts });
            (name.clone(), takes)
        })
        .collect();
    json!({
        "hour": wiki.hour,
        "launch": wiki.launch,
        "calls": wiki.calls,
        "depth": wiki.depth,
        "concurrency": wiki.concurrency,
        "embed_model": wiki.embed_model,
        "harnesses": harnesses,
    })
}

/// `PATCH /api/wiki/settings`: write `set`, `{setting: value}` of
/// [`SETTINGS`], to `[wiki]` in the config, keeping the rest as written; null
/// takes the default. Every Wiki's settings after.
pub fn set(ctx: &Context, set: &Value) -> Result<Value, Refusal> {
    config::edit(&ctx.config_dir, |config, doc| {
        let set = checked_settings(config, set)?;
        repo::write(repo::table_at(doc.as_table_mut(), "wiki"), set);
        Ok::<_, Refusal>(())
    })??;
    Ok(settings(&config::load(&ctx.config_dir)?))
}

/// The Harnesses configured that a Wiki builds on: each with a headless form.
fn builders(config: &Config) -> impl Iterator<Item = (&String, &Harness)> {
    (config.harnesses.iter()).filter(|(name, _)| HEADLESS.contains(&name.as_str()))
}

/// `set` as an object of some of [`SETTINGS`], each null or a value
/// `[wiki]` holds; else a bad request.
fn checked_settings<'a>(
    config: &Config,
    set: &'a Value,
) -> Result<&'a serde_json::Map<String, Value>, Refusal> {
    let bad = |error: String, help: &str| Refusal {
        error,
        help: vec![help.into()],
        exit_code: 2,
    };
    let keys: Vec<&str> = SETTINGS.iter().map(|(key, _)| *key).collect();
    let all = format!("Settings: {}; null takes the default", keys.join(", "));
    let set = (set.as_object())
        .filter(|set| !set.is_empty())
        .ok_or_else(|| bad(format!("{set} sets nothing"), &all))?;
    let names: Vec<&str> = builders(config).map(|(name, _)| name.as_str()).collect();
    let builders_help = format!("Harnesses that build a Wiki: {}", names.join(", "));
    for (key, new) in set {
        let Some((_, help)) = SETTINGS.iter().find(|(name, _)| name == key) else {
            return Err(bad(format!("`{key}` is not a setting the page sets"), &all));
        };
        // Past u32, config.toml would no longer read.
        let whole = new.as_u64().and_then(|n| u32::try_from(n).ok());
        match (key.as_str(), new) {
            (_, Value::Null) => {}
            ("hour", _) if whole.is_some_and(|hour| hour <= 23) => {}
            ("hour", _) => {
                return Err(bad(
                    format!("hour is an hour from 0 to 23, not {new}"),
                    help,
                ));
            }
            ("embed_model", Value::String(model)) if !model.trim().is_empty() => {}
            ("embed_model", _) => {
                return Err(bad(
                    format!("embed_model is a model's name, not {new}"),
                    help,
                ));
            }
            ("launch", _) => {
                let launch: Launch = serde_json::from_value(new.clone()).map_err(|_| {
                    bad(
                        format!("launch is {{harness, model, effort}}, not {new}"),
                        &builders_help,
                    )
                })?;
                let harness = &launch.harness;
                if !names.contains(&harness.as_str()) {
                    let error = match config.harnesses.contains_key(harness) {
                        true => format!("{harness} has no headless form: {BUILDS_ON}"),
                        false => format!("unknown Harness `{harness}`"),
                    };
                    return Err(bad(error, &builders_help));
                }
                dispatch::check(config, &launch)?;
            }
            _ if whole.is_some_and(|n| n >= 1) => {}
            _ => {
                let error = format!("{key} is a whole number of at least 1, not {new}");
                return Err(bad(error, help));
            }
        }
    }
    Ok(set)
}

/// The Wiki `of` the Bucket holds.
fn kept(ctx: &Context, config: &Config, of: &Of) -> Result<Option<Value>, Refusal> {
    let Some(text) = bucket::wiki(ctx.world, config, &of.folder())? else {
        return Ok(None);
    };
    let id = of.id();
    let wiki = serde_json::from_slice(&text).map_err(|e| {
        Refusal::new(
            format!("the Wiki of {id} in the Bucket is not JSON: {e}"),
            vec![format!("Build it again: nico-agent wiki build {id}")],
        )
    })?;
    Ok(Some(wiki))
}

/// The Wiki `of`, built on a checkout of a Repo's Base or a Library
/// version's tag, removed after, and kept in the Bucket: built `how` it was
/// asked, from the one the Bucket holds for an `update` if it holds one; for
/// a `continue`, from it on a checkout of the commit it describes.
fn built(ctx: &Context, config: &Config, of: &Of, how: Option<&str>) -> Result<Wiki, Refusal> {
    let (world, call) = (ctx.world, headless(ctx, config, true, None)?);
    let (id, clone) = (&of.id(), of.clone_dir(&ctx.config_dir));
    let continuing = how == Some("continue");
    let previous = match how {
        Some("update" | "continue") => kept(ctx, config, of)?.map(serde_json::from_value::<Wiki>),
        _ => None,
    };
    let previous = previous.transpose().map_err(|e| {
        Refusal::new(
            format!("the Wiki of {id} in the Bucket does not read: {e}"),
            vec![format!("Build it from scratch: nico-agent wiki build {id}")],
        )
    })?;
    if continuing && previous.is_none() {
        return Err(uncontinued(id));
    }
    let rev = match of {
        Of::Repo(_, repo) => {
            let base = base(world, repo)?;
            world.git_fetch(&clone, None)?;
            format!("origin/{base}")
        }
        Of::Library(Library { repo, tag, .. }) => {
            let url = format!("https://github.com/{repo}.git");
            world.git_fetch_tag(&clone, &url, tag)?;
            format!("refs/tags/{tag}")
        }
    };
    let folder = ctx.config_dir.join("wiki").join(of.folder());
    // One build of a Wiki at a time: another would remove its checkout.
    let _building = state::lock(&folder.join("build"))?;
    // Dropped first, so removed while the lock is still held; one a build that died left is older than its next Run.
    let _progress = Removed(of.progress(&ctx.config_dir));
    let dir = folder.join("checkout").display().to_string();
    // One a build that died left behind.
    world.git_worktree_remove(&clone, &dir)?;
    let at = match &previous {
        // Filled in at its own commit, the Wiki still describes one.
        Some(wiki) if continuing => wiki.commit.clone(),
        _ => rev,
    };
    world.git_worktree_add(&clone, &dir, &at)?;
    let wiki = described(ctx, config, of, &dir, &call, previous, continuing);
    let removed = world.git_worktree_remove(&clone, &dir);
    let wiki = wiki?;
    removed?;
    let message = format!("wiki {id} {}", wiki.commit);
    bucket::keep_wiki(ctx, config, &of.folder(), &state::text(&wiki), &message)?;
    let kept = serde_json::to_value(&wiki).expect("a Wiki is plain data");
    if let Err(no) = ask::embedded(ctx, config, &of.folder(), &kept) {
        let why = no.error;
        world.log(&format!(
            "could not embed the Wiki of {id}, so ask embeds it first: {why}"
        ));
    }
    Ok(wiki)
}

/// A part of a depth, its answer if it was asked.
struct Asked {
    part: Part,
    /// Its first answer's session, with its last answer that reads.
    answered: Option<Answered>,
    /// Why it is a Gap, if it is: unasked, or a claim still failing.
    reason: &'static str,
    /// Whether its last reply did not read, its answer the one before.
    unread: bool,
}

/// The Wiki of the code checked out in `dir`, its parts asked by `call`
/// a depth at a time, each answer's failing claims sent back in rounds; only
/// those that changed since `previous`, when there is a Wiki before it, and
/// its budget Gaps too when `continuing` it.
// shortcut: a slow part holds up the next depth's; pipeline the calls if builds run long.
fn described(
    ctx: &Context,
    config: &Config,
    of: &Of,
    dir: &str,
    call: &Headless,
    previous: Option<Wiki>,
    continuing: bool,
) -> Result<Wiki, Refusal> {
    let (world, budget, id) = (ctx.world, &config.wiki, &of.id());
    let commit = world.git_rev(dir, "HEAD")?;
    let under = match of {
        Of::Library(library) => library.path.as_deref(),
        Of::Repo(..) => None,
    };
    let files = files(world, dir, under)?;
    if let (Of::Library(library), Some(under), true) = (of, under, files.is_empty()) {
        return Err(Refusal::new(
            format!("{} has no file under {under} at {commit}", library.repo),
            vec![format!(
                "Set its path to a folder {} holds at {}, in {}",
                library.repo,
                library.tag,
                ctx.config_dir.join(config::FILE).display()
            )],
        ));
    }
    let lines: HashMap<&str, usize> = (files.iter()).map(|f| (f.path.as_str(), f.lines)).collect();
    world.log(&format!(
        "building the Wiki of {id} at {commit}: {} calls, {} deep, {} at once",
        budget.calls, budget.depth, budget.concurrency
    ));
    // Where each Component was in the Wiki before: one asked again keeps its place.
    let mut places = HashMap::new();
    let (mut components, mut frontier) = match previous {
        Some(previous) => {
            let was = previous.commit.clone();
            let ids = previous.components.iter().map(|c| c.id.clone());
            places.extend(ids.enumerate().map(|(n, id)| (id, n)));
            let (components, parts) = updated(previous, &files, continuing);
            let from = match continuing {
                true => "continuing it".into(),
                false => format!("updating it from {was}"),
            };
            world.log(&format!(
                "{from}: {} part(s) copied or kept, {} to ask again",
                components.len(),
                parts.len()
            ));
            (components, parts)
        }
        None => (
            vec![],
            vec![Part {
                id: INDEX.into(),
                name: id.clone(),
                parent: None,
                summary: String::new(),
                trail: id.clone(),
                files: files.iter().map(|f| f.path.clone()).collect(),
                depth: 0,
                relationships: vec![],
            }],
        ),
    };
    let mut ids: HashSet<String> = (components.iter().map(|c| c.id.clone()))
        .chain(frontier.iter().map(|p| p.id.clone()))
        .collect();
    let mut calls_left = budget.calls;
    let file = of.progress(&ctx.config_dir);
    let mut progress = Progress {
        at: state::iso(world.now()),
        calls: budget.calls,
        depth: budget.depth,
        ..Progress::default()
    };
    progress.keep(&file);
    while !frontier.is_empty() {
        // Why each part goes unasked, if it does: the calls go to the first ones.
        let unasked: Vec<Option<&'static str>> = (frontier.iter())
            .map(|part| {
                if part.depth > budget.depth {
                    Some("depth")
                } else if calls_left == 0 {
                    Some("budget")
                } else {
                    calls_left -= 1;
                    let call = budget.calls - calls_left;
                    world.log(&format!(
                        "{}: asked (call {call} of {})",
                        part.trail, budget.calls
                    ));
                    None
                }
            })
            .collect();
        let called: Vec<&Part> = (frontier.iter().zip(&unasked))
            .filter(|(_, unasked)| unasked.is_none())
            .map(|(part, _)| part)
            .collect();
        let calls: Vec<Headless> = (called.iter())
            .map(|part| Headless {
                prompt: prompt(id, part, &lines),
                ..call.clone()
            })
            .collect();
        let at_once = budget.concurrency as usize;
        let mut told = |i, c| progress.told(&file, c, called[i], 0);
        let mut answers = world
            .harness_headless(dir, &calls, at_once, &mut told)
            .into_iter();
        let mut asked = vec![];
        for (part, unasked) in frontier.drain(..).zip(unasked) {
            let answered = match unasked {
                Some(_) => None,
                None => Some(answers.next().expect("an answer to each call")?),
            };
            let reason = unasked.unwrap_or("unreadable");
            asked.push(Asked {
                part,
                answered,
                reason,
                unread: false,
            });
        }
        for round in 1..=ROUNDS {
            let mut sent = vec![];
            for (i, a) in asked.iter_mut().enumerate() {
                let Some(answered) = &a.answered else {
                    continue;
                };
                let (_, mut failed) = checked(&a.part, &answered.text, &lines);
                if failed.is_empty() {
                    continue;
                }
                if calls_left == 0 {
                    a.reason = "budget";
                    continue;
                }
                calls_left -= 1;
                world.log(&format!(
                    "{}: {} claim(s) failed, sent back (round {round} of {ROUNDS}, call {} of {})",
                    a.part.trail,
                    failed.len(),
                    budget.calls - calls_left,
                    budget.calls
                ));
                if a.unread {
                    failed.insert(0, "your last reply: it is no JSON object of either shape, leaf or division, so the claims below are of the answer before it".into());
                }
                sent.push((
                    i,
                    Headless {
                        prompt: correction(&a.part, &failed),
                        ..headless(ctx, config, true, Some(&answered.session))?
                    },
                ));
            }
            if sent.is_empty() {
                break;
            }
            let (which, corrections): (Vec<usize>, Vec<Headless>) = sent.into_iter().unzip();
            let mut told = |j: usize, c| progress.told(&file, c, &asked[which[j]].part, round);
            let replies = world.harness_headless(dir, &corrections, at_once, &mut told);
            for (i, reply) in which.into_iter().zip(replies) {
                let (reply, a) = (reply?, &mut asked[i]);
                let answered = a.answered.as_mut().expect("sent back");
                // A reply that does not read leaves the last answer that did.
                a.unread = parsed(&reply.text).is_none() && parsed(&answered.text).is_some();
                if !a.unread {
                    answered.text = reply.text;
                }
            }
        }
        let mut next = vec![];
        for Asked {
            part,
            answered,
            reason,
            ..
        } in asked
        {
            let Some(answered) = answered else {
                world.log(&format!("{}: not asked ({reason}), a Gap", part.trail));
                components.push(gap(part, reason));
                progress.gaps += 1;
                progress.keep(&file);
                continue;
            };
            let trail = part.trail.clone();
            let (component, parts, dropped) = read(part, &answered.text, &lines, &mut ids, reason);
            if !component.gaps.is_empty() {
                progress.gaps += component.gaps.len();
                progress.keep(&file);
            }
            for why in &dropped {
                world.log(&format!("{trail}: dropped {why}"));
            }
            world.log(&format!("{trail}: {} part(s) under it", parts.len()));
            components.push(component);
            next.extend(parts);
        }
        frontier = next;
    }
    // Stable: the new ones after, in the order they were asked, each after its parent.
    components.sort_by_key(|c| places.get(&c.id).copied().unwrap_or(usize::MAX));
    Ok(Wiki {
        version: 1,
        target: Target::of(id),
        commit,
        built_at: state::iso(world.now()),
        files,
        components,
    })
}

/// What an Update makes of `previous`, the Wiki before it, now that the
/// code's files are `files`, top-down: a Component whose files kept their
/// blobs is copied with its parts; the part a file added or removed sits
/// under is asked again, its parts from scratch, as is a leaf whose files
/// changed; any other, a parent whose parts changed, is kept with its
/// claims. When `continuing` it, each part with a budget Gap is asked again
/// too, its parts from scratch. The Components it keeps, then the parts to ask.
fn updated(previous: Wiki, files: &[File], continuing: bool) -> (Vec<Component>, Vec<Part>) {
    let blobs = |files: &[File]| -> HashMap<String, String> {
        (files.iter())
            .map(|f| (f.path.clone(), f.blob.clone()))
            .collect()
    };
    let (was, now) = (blobs(&previous.files), blobs(files));
    let all = &previous.components;
    let at: HashMap<&str, usize> = (all.iter().enumerate())
        .map(|(i, c)| (c.id.as_str(), i))
        .collect();
    let parent = |i: usize| all[i].parent.as_deref().and_then(|p| at.get(p).copied());
    // A parent comes before its parts.
    let (mut depth, mut trail) = (vec![0u32; all.len()], vec![String::new(); all.len()]);
    for (i, c) in all.iter().enumerate() {
        (depth[i], trail[i]) = match parent(i) {
            Some(p) => (depth[p] + 1, format!("{} > {}", trail[p], c.name)),
            None => (0, c.name.clone()),
        };
    }
    // The first of the deepest that `holds`, or the top one.
    let deepest = |holds: &dyn Fn(&Component) -> bool| {
        (0..all.len())
            .filter(|&i| holds(&all[i]))
            .min_by_key(|&i| Reverse(depth[i]))
            .unwrap_or(0)
    };
    let unexplored = |i: &usize| continuing && all[*i].gaps.iter().any(|g| g.reason == "budget");
    let (mut asked, mut added): (HashSet<usize>, _) = (
        (0..all.len()).filter(unexplored).collect(),
        vec![vec![]; all.len()],
    );
    let mut new: Vec<&String> = now.keys().filter(|p| !was.contains_key(*p)).collect();
    new.sort();
    for path in new {
        // It sits under the deepest part holding every file of its nearest folder.
        // shortcut: a file new at the top, or in a folder split across parts, divides their
        // parent again from scratch; copy the new parts that keep an old one's files if that costs.
        let folders = (path.rmatch_indices('/'))
            .map(|(n, _)| &path[..=n])
            .chain([""]);
        let near: Vec<&String> = folders
            .map(|folder| {
                was.keys()
                    .filter(|p| p.starts_with(folder))
                    .collect::<Vec<_>>()
            })
            .find(|near| !near.is_empty())
            .unwrap_or_default();
        let home = deepest(&|c| near.iter().all(|p| c.files.contains(p)));
        asked.insert(home);
        let mut up = Some(home);
        while let Some(i) = up {
            added[i].push(path.clone());
            up = parent(i);
        }
    }
    let left = |i: usize| all[i].files.iter().any(|f| now.contains_key(f));
    for path in was.keys().filter(|p| !now.contains_key(*p)) {
        let holds = |i: usize| all[i].files.contains(path);
        // Each part it was in that no part of it holds, or the nearest above it with files left.
        let lowest = (0..all.len())
            .filter(|&i| holds(i) && !(0..all.len()).any(|j| parent(j) == Some(i) && holds(j)));
        for i in lowest {
            let mut up = Some(i);
            while let Some(j) = up.filter(|&j| !left(j)) {
                up = parent(j);
            }
            asked.insert(up.unwrap_or(0));
        }
    }
    #[derive(Clone, Copy, PartialEq)]
    enum Fate {
        Copied,
        Kept,
        Asked,
        Gone,
    }
    let mut fates: Vec<Fate> = vec![];
    let mut held = vec![];
    for (i, c) in all.iter().enumerate() {
        let files: Vec<String> = (c.files.iter())
            .filter(|f| now.contains_key(*f))
            .cloned()
            .chain(added[i].drain(..))
            .collect();
        let unchanged = files == c.files && c.files.iter().all(|f| was.get(f) == now.get(f));
        fates.push(match parent(i).map(|p| fates[p]) {
            Some(Fate::Asked | Fate::Gone) => Fate::Gone,
            // A budget Gap continued is asked under its parent copied.
            _ if asked.contains(&i) => Fate::Asked,
            Some(Fate::Copied) => Fate::Copied,
            _ if unchanged => Fate::Copied,
            _ if all.iter().any(|p| p.parent.as_ref() == Some(&c.id)) => Fate::Kept,
            _ => Fate::Asked,
        });
        held.push(files);
    }
    let (mut components, mut parts) = (vec![], vec![]);
    for (i, mut c) in previous.components.into_iter().enumerate() {
        let files = std::mem::take(&mut held[i]);
        match fates[i] {
            Fate::Gone => {}
            Fate::Asked => parts.push(Part {
                id: c.id,
                name: c.name,
                parent: c.parent,
                summary: c.overview,
                trail: std::mem::take(&mut trail[i]),
                files,
                depth: depth[i],
                relationships: c.relationships,
            }),
            Fate::Copied | Fate::Kept => {
                // Pinned where it changed: the blob each cited file had when written.
                let cited = (c.interpretations.iter()).flat_map(|i| &i.anchors);
                let pins = cited
                    .filter_map(|a| {
                        let written = c.blobs.get(&a.path).or(was.get(&a.path))?;
                        (now.get(&a.path) != Some(written))
                            .then(|| (a.path.clone(), written.clone()))
                    })
                    .collect();
                c.blobs = pins;
                c.files = files;
                components.push(c);
            }
        }
    }
    (components, parts)
}

/// Each file of the checkout in `dir`, under the folder `under` if one, by
/// its path from the checkout's root, with its blob and line count.
fn files(world: &dyn World, dir: &str, under: Option<&str>) -> WorldResult<Vec<File>> {
    let mut files = vec![];
    for (path, blob) in world.git_ls_tree_blobs(dir, "HEAD")? {
        if under.is_some_and(|under| !path.starts_with(&format!("{under}/"))) {
            continue;
        }
        let held = world
            .read_file(&format!("{dir}/{path}"))?
            .unwrap_or_default();
        // A last line without its newline counts.
        let lines = held.split(|b| *b == b'\n').count()
            - usize::from(held.is_empty() || held.ends_with(b"\n"));
        files.push(File { path, blob, lines });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// The tools a part's call may not use on opencode: every one that writes or
/// leaves its folder. `execute` reaches the user's own MCP servers, some of which write.
const WRITES: [&str; 7] = [
    "edit",
    "bash",
    "webfetch",
    "websearch",
    "task",
    "external_directory",
    "execute",
];

/// The Harnesses with a headless form, which a Wiki builds on.
pub const HEADLESS: [&str; 3] = ["claude", "codex", "opencode"];
const BUILDS_ON: &str = "a Wiki builds on claude, codex or opencode";

/// Where codex reads the answer's JSON schema from, in the config directory.
const SCHEMA_FILE: &str = "wiki/answer.schema.json";

/// The `[wiki]` launch's headless call, its prompt to fill in: one that
/// `reads` the code and answers a part in the Wiki's shape, or one with no
/// tools at all; continuing `session`, to correct its answer.
/// opencode's `run`, on a server of its own, so that the config denying its
/// tools is the one it runs on, with the shape in the prompt alone; claude's
/// `-p` and codex's `exec`, each given the shape as a JSON schema.
pub fn headless(
    ctx: &Context,
    config: &Config,
    reads: bool,
    session: Option<&str>,
) -> Result<Headless, Refusal> {
    let launch = &config.wiki.launch;
    let harness = &config.harnesses[&launch.harness];
    // The Harness's model and Effort arguments, as its launch fills them in.
    let filled = |args: &[String], value: &Option<String>, name: &str| -> Vec<String> {
        (value.iter())
            .flat_map(|value| args.iter().map(|arg| fill_in(arg, &[(name, value)])))
            .collect()
    };
    let chosen = [
        filled(&harness.model_args, &launch.model, "model"),
        filled(&harness.effort_args, &launch.effort, "effort"),
    ]
    .concat();
    let strings = |args: &[&str]| args.iter().map(|a| a.to_string()).collect::<Vec<_>>();
    let mut env = vec![];
    let args = match launch.harness.as_str() {
        "opencode" => {
            let mut args = strings(&["run", "--standalone"]);
            if let Some(model) = &launch.model {
                let model =
                    (launch.effort.as_ref()).map_or(model.clone(), |e| format!("{model}#{e}"));
                args.extend(["-m".into(), model]);
            }
            args.extend(strings(&["--format", "json"]));
            let denied: &[&str] = if reads { &WRITES } else { &["*"] };
            let permission: serde_json::Map<String, Value> = (denied.iter())
                .map(|tool| (tool.to_string(), json!("deny")))
                .collect();
            let config = json!({ "permission": permission }).to_string();
            env.push(("OPENCODE_CONFIG_CONTENT".into(), config));
            args.extend(session.into_iter().flat_map(|s| ["-s".into(), s.into()]));
            args
        }
        "claude" => {
            let mut args = strings(&["-p", "--output-format", "json"]);
            if reads {
                args.extend(["--json-schema".into(), schema().to_string()]);
            }
            // `=`: the list takes every word after it, the prompt too, otherwise.
            let tools = if reads { "Read,Grep,Glob" } else { "" };
            args.push(format!("--tools={tools}"));
            // No MCP server of the user's, some of which write.
            args.extend(strings(&[
                "--strict-mcp-config",
                "--permission-prompts",
                "none",
            ]));
            args.extend(chosen);
            args.extend(
                session
                    .into_iter()
                    .flat_map(|s| ["--resume".into(), s.into()]),
            );
            args
        }
        "codex" => {
            let mut args = strings(&["exec"]);
            args.extend(
                session
                    .into_iter()
                    .flat_map(|s| ["resume".into(), s.into()]),
            );
            // `exec resume` takes no `-s`, so the sandbox is set as config, for both.
            // Not the user's config.toml: its MCP servers and plugins, some of
            // which write, are not this call's. Its login is still read.
            // shortcut: codex keeps its read-only shell and its web search, even for `ask`; drop them if codex gains a flag for it.
            args.extend(strings(&[
                "--ignore-user-config",
                "-c",
                "sandbox_mode=\"read-only\"",
                "--skip-git-repo-check",
                "--json",
            ]));
            if reads {
                let file = ctx.config_dir.join(SCHEMA_FILE);
                let schema = state::text(&schema());
                state::update(&file, |_| Ok::<_, io::Error>((schema, ())))?;
                args.extend(["--output-schema".into(), file.display().to_string()]);
            }
            args.extend(chosen);
            args
        }
        name => {
            return Err(Refusal::new(
                format!("{name} has no headless form: {BUILDS_ON}"),
                vec!["Set [wiki] launch to one of them, on the Wiki view's settings or in config.toml".into()],
            ));
        }
    };
    let command = (harness.command.clone())
        .or_else(|| harness.kind.clone())
        .expect("config requires a command or a kind");
    Ok(Headless {
        command,
        args,
        env,
        prompt: String::new(),
    })
}

/// What every answer holds, a leaf or a division, as a JSON schema strict
/// enough for codex: every key required, one left out null.
fn schema() -> Value {
    let object = |properties: Value| {
        let required: Vec<&String> = properties.as_object().expect("an object").keys().collect();
        json!({ "type": "object", "additionalProperties": false, "required": required, "properties": properties })
    };
    let (string, number) = (json!({ "type": "string" }), json!({ "type": "integer" }));
    let list = |items: Value| json!({ "type": "array", "items": items });
    let one_of = |kinds: &[&str]| json!({ "type": "string", "enum": kinds });
    let or_null = |value: Value| json!({ "anyOf": [{ "type": "null" }, value] });
    let anchors = list(object(
        json!({ "path": string, "start": number, "end": number }),
    ));
    object(json!({
        "kind": one_of(&["leaf", "division"]),
        "overview": string,
        "components": list(object(json!({ "name": string, "summary": string, "files": list(string.clone()) }))),
        "relationships": list(object(json!({
            "from": string, "to": string, "kind": one_of(&RELATIONSHIPS), "description": string,
        }))),
        "interpretations": list(object(json!({ "kind": one_of(&KINDS), "text": string, "anchors": anchors }))),
        "explainer": or_null(object(json!({
            "title": string,
            "steps": list(object(json!({
                "n": number, "caption": string, "anchors": anchors, "lane": or_null(string.clone()),
            }))),
            "arrows": list(object(json!({ "from": number, "to": number, "label": or_null(string.clone()) }))),
        }))),
    }))
}

const PROMPT: &str = r#"You are writing one part of the Wiki of {repo}: what its code does, each claim citing the lines it rests on. You may read, grep, glob and list the files in this folder, and nothing else.

## The part: {trail}

Its files, by repo-relative path, with their line counts:

{files}
{context}Read the files you need, then answer whether this part is one unit (a leaf) or divides into Components (a division).

What the Wiki covers:

- The root, the whole repo, decides what the repo is for, and every Component is about that. Everything else is left out of every Component, and never asked about.
- In a code repo, that leaves out its docs, agent instructions and skills, fixtures and config. In a repo of skills or plugins, they are what it is for, so each skill or plugin is a Component.
- Tests go in the Component of the unit they test, when they test one, and are never a Component of their own.

Where to divide:

- A part divides only along the units the repo declares, and the folders that hold them:
  - a package or crate, declared by its own manifest (a workspace member's package.json, a Cargo.toml)
  - a module, declared by the language or the package (a Rust mod, a Compact module, a package.json exports subpath)
  - a skill, declared by its SKILL.md, or a plugin, declared by its manifest
- A division's Components are the part's units, or the folders that group them, at the first folder level where its units split apart: a folder holding all of them is no Component of its own, and one holding several is a Component, its units under it.
- A part that is one declared unit, declaring none inside it, is a leaf, however big it is.
- A division's Components share out the part's files, each listed file in at most one; a file in none is left out. A Component's summary is one or two sentences.
- A Relationship goes from one Component of your division to another, named as you named them, of one kind: uses, calls, reads or writes.

How much to write: each limit below is the most, not a target. Write less whenever less is enough.

- Spend your reads on code: its invariants, contracts, effects and control flow. Lockfiles and generated files need only a glance.
- Read only files from the list, and read a file before claiming anything about it. Write each path exactly as listed.
- An overview is plain prose of at most 3 sentences: what the part is for, and where to start reading it. The root's names its units and how they work together.
- An Interpretation is one plain sentence of at most 25 words, claiming one thing, of one kind: invariant, precondition, postcondition, effect or role. It is not a list of identifiers joined by semicolons or dashes. It cites at least one Anchor.
- A leaf has at most 5 Interpretations: the ones a newcomer most needs, or would most likely get wrong.
- A division has at most 3 Interpretations, each about how its Components work together. One whose Anchors all fall in the files of one Component is about that Component, and fails.
- An Anchor is lines of a listed file, 1-based and inclusive: start <= end <= the file's line count.
- Most leaves have no Explainer. A leaf has one only for a flow, in order, that its Interpretations don't already state, and its steps don't restate them: a title, at most 8 steps numbered from 1, each a one-sentence caption citing at least one Anchor, with an optional lane naming where the step happens, and arrows from step to step by number, each with an optional label.

Answer with one JSON object and nothing else, in one of two shapes:

{"kind": "leaf", "overview": "...", "interpretations": [{"kind": "role", "text": "...", "anchors": [{"path": "...", "start": 1, "end": 2}]}], "explainer": null}

{"kind": "division", "overview": "...", "components": [{"name": "...", "summary": "...", "files": ["..."]}], "relationships": [{"from": "...", "to": "...", "kind": "uses", "description": "..."}], "interpretations": [{"kind": "invariant", "text": "...", "anchors": [{"path": "...", "start": 1, "end": 2}]}]}

A leaf that has an Explainer gives it in place of null: {"title": "...", "steps": [{"n": 1, "caption": "...", "anchors": [{"path": "...", "start": 1, "end": 2}], "lane": "..."}], "arrows": [{"from": 1, "to": 2, "label": "..."}]}
"#;

/// What the model is asked of `part`.
fn prompt(slug: &str, part: &Part, lines: &HashMap<&str, usize>) -> String {
    let files: String = (part.files.iter())
        .map(|f| format!("- {f} ({} lines)\n", lines[f.as_str()]))
        .collect();
    let context = match part.trail.rsplit_once(" > ") {
        Some((above, _)) => format!(
            "This part is the Component \"{}\" of {above}, described as: {}\n\n",
            part.name, part.summary
        ),
        None => format!("This part is the root: the whole of {slug}.\n\n"),
    };
    // The files last: a path is never taken for a placeholder.
    let values = [
        ("repo", slug),
        ("trail", &part.trail),
        ("context", &context),
        ("files", &files),
    ];
    fill_in(PROMPT, &values)
}

/// What the model is asked to correct of its answer about `part`: each
/// claim that `failed`, by its id, with what failed.
fn correction(part: &Part, failed: &[String]) -> String {
    let failed: String = failed.iter().map(|why| format!("- {why}\n")).collect();
    format!(
        "## Corrections to the part: {}\n\nThese claims of your last answer failed their checks, each by its id:\n\n{failed}\nCorrect each one, reading again the lines it cites, and answer again with the whole JSON object in the same shape, every other claim as it was.",
        part.trail
    )
}

/// The Component `part` makes of the model's `answer`, the parts its
/// division opens, each named by an id not in `ids`, and why each claim that
/// failed a check was dropped: the part is then a Gap for `reason`.
fn read(
    part: Part,
    answer: &str,
    lines: &HashMap<&str, usize>,
    ids: &mut HashSet<String>,
    reason: &'static str,
) -> (Component, Vec<Part>, Vec<String>) {
    let (checked, dropped) = checked(&part, answer, lines);
    let Some(Checked {
        overview,
        mut interpretations,
        named,
        said,
        explainer,
    }) = checked
    else {
        return (gap(part, reason), vec![], dropped);
    };
    for (n, interpretation) in interpretations.iter_mut().enumerate() {
        interpretation.id = n + 1;
    }
    let mut parts: Vec<Part> = (named.into_iter())
        .map(|c| Part {
            id: unique(&part.id, &c.name, ids),
            parent: Some(part.id.clone()),
            trail: format!("{} > {}", part.trail, c.name),
            name: c.name,
            summary: c.summary,
            files: c.files,
            depth: part.depth + 1,
            relationships: vec![],
        })
        .collect();
    for r in said {
        let to = parts.iter().find(|p| p.name == r.to).map(|p| p.id.clone());
        if let (Some(from), Some(to)) = (parts.iter_mut().find(|p| p.name == r.from), to) {
            let (kind, description) = (r.kind, r.description);
            from.relationships.push(Relationship {
                to,
                kind,
                description,
            });
        }
    }
    let gaps = match dropped.is_empty() {
        true => vec![],
        false => vec![Gap {
            paths: part.files.clone(),
            reason: reason.into(),
        }],
    };
    let component = Component {
        id: part.id,
        name: part.name,
        parent: part.parent,
        overview,
        files: part.files,
        interpretations,
        relationships: part.relationships,
        explainer,
        gaps,
        blobs: BTreeMap::new(),
    };
    (component, parts, dropped)
}

/// The claims of the model's `answer` about `part` that pass every check,
/// none when it is no answer of either shape, and why each other one
/// failed, by its id.
fn checked(
    part: &Part,
    answer: &str,
    lines: &HashMap<&str, usize>,
) -> (Option<Checked>, Vec<String>) {
    let Some(answer) = parsed(answer) else {
        let why = "the answer: it is no JSON object of either shape, leaf or division";
        return (None, vec![why.into()]);
    };
    let in_part: HashSet<&str> = part.files.iter().map(String::as_str).collect();
    let (division, explainer) = match answer.kind.as_str() {
        "division" => (&answer.components[..], &[][..]),
        _ => (&[][..], answer.explainer.as_slice()),
    };
    // Read before the Interpretations, which a division's are held to; listed after them.
    let mut dropped_components = vec![];
    let named = claims(
        "component",
        division,
        &mut dropped_components,
        |c: &Named| {
            let outside = c.files.iter().find(|f| !in_part.contains(f.as_str()));
            match (c.files.is_empty(), outside) {
                (true, _) => Some("it has no files".into()),
                (_, Some(f)) => Some(format!("{f} is not one of the part's files")),
                _ => None,
            }
        },
    );
    let mut dropped = vec![];
    let interpretations = claims(
        "interpretation",
        &answer.interpretations,
        &mut dropped,
        |i: &Interpretation| {
            if !KINDS.contains(&i.kind.as_str()) {
                return Some(format!(
                    "its kind `{}` is not one of {}",
                    i.kind,
                    KINDS.join(", ")
                ));
            }
            unanchored(&i.anchors, lines).or_else(|| {
                let within = |c: &&Named| (i.anchors.iter()).all(|a| c.files.contains(&a.path));
                named.iter().find(within).map(|c| {
                    format!(
                        "its Anchors all fall in the files of {}, so it is about that Component, not how the division's Components work together",
                        c.name
                    )
                })
            })
        },
    );
    let explainer = claims("explainer", explainer, &mut dropped, |e: &Explainer| {
        let steps = e.steps.len();
        if steps == 0 || steps > MOST_STEPS {
            return Some(format!("it has {steps} steps, not 1 to {MOST_STEPS}"));
        }
        if (e.steps.iter().enumerate()).any(|(i, s)| s.n != i + 1) {
            return Some(format!("its steps are not numbered 1 to {steps} in order"));
        }
        if let Some(why) = (e.steps.iter())
            .find_map(|s| unanchored(&s.anchors, lines).map(|why| format!("step {}: {why}", s.n)))
        {
            return Some(why);
        }
        (e.arrows.iter())
            .find(|a| ![a.from, a.to].iter().all(|n| (1..=steps).contains(n)))
            .map(|a| {
                format!(
                    "its arrow {} to {} is not between two of its steps",
                    a.from, a.to
                )
            })
    })
    .pop();
    dropped.append(&mut dropped_components);
    let said = claims(
        "relationship",
        &answer.relationships,
        &mut dropped,
        |r: &Said| {
            if !RELATIONSHIPS.contains(&r.kind.as_str()) {
                let kinds = RELATIONSHIPS.join(", ");
                return Some(format!("its kind `{}` is not one of {kinds}", r.kind));
            }
            [&r.from, &r.to]
                .into_iter()
                .find(|name| !named.iter().any(|c| c.name == **name))
                .map(|name| format!("{name} is not a Component of the division"))
        },
    );
    let checked = Checked {
        overview: answer.overview,
        interpretations,
        named,
        said,
        explainer,
    };
    (Some(checked), dropped)
}

/// The id of the Component `name` under `parent`'s: their names' slugs
/// joined by `/`, numbered on when another Component has it.
fn unique(parent: &str, name: &str, ids: &mut HashSet<String>) -> String {
    let slug: String = (name
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric()))
    .filter(|word| !word.is_empty())
    .collect::<Vec<_>>()
    .join("-");
    let slug = if slug.is_empty() { "part".into() } else { slug };
    let id = match parent {
        INDEX => slug,
        _ => format!("{parent}/{slug}"),
    };
    let id = (1..)
        .map(|n| {
            if n == 1 {
                id.clone()
            } else {
                format!("{id}-{n}")
            }
        })
        .find(|id| !ids.contains(id))
        .expect("some number is free");
    ids.insert(id.clone());
    id
}

/// Why a claim citing `anchors` rests on no real lines: it cites none, or
/// one not inside a file of the Wiki, as `lines` counts them.
fn unanchored(anchors: &[Anchor], lines: &HashMap<&str, usize>) -> Option<String> {
    if anchors.is_empty() {
        return Some("it cites no Anchor".into());
    }
    (anchors.iter()).find_map(|a| match lines.get(a.path.as_str()) {
        Some(&n) => (a.start < 1 || a.start > a.end || a.end > n).then(|| {
            format!(
                "lines {}-{} are not inside {} ({n} lines)",
                a.start, a.end, a.path
            )
        }),
        None => Some(format!("{} is not one of the Wiki's files", a.path)),
    })
}

/// The answer in `text`, its one JSON object, fenced or not.
fn parsed(text: &str) -> Option<Answer> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    let answer: Answer = serde_json::from_str(text.get(start..=end)?).ok()?;
    ["leaf", "division"]
        .contains(&answer.kind.as_str())
        .then_some(answer)
}

/// Each claim of `raw` that reads as a `T` and passes `check`, which says
/// what is wrong with one; why each other one was dropped, onto `dropped`,
/// by its id: `name` and its place among them, from 1.
fn claims<T: DeserializeOwned>(
    name: &str,
    raw: &[Value],
    dropped: &mut Vec<String>,
    check: impl Fn(&T) -> Option<String>,
) -> Vec<T> {
    (raw.iter().enumerate())
        .filter_map(|(n, claim)| {
            let problem = match serde_json::from_value::<T>(claim.clone()) {
                Ok(read) => match check(&read) {
                    None => return Some(read),
                    Some(problem) => problem,
                },
                Err(e) => format!("it does not read: {e}"),
            };
            dropped.push(format!("{name} {} {claim}: {problem}", n + 1));
            None
        })
        .collect()
}

/// `part` as a Component no answer described, a Gap for `reason`: what its
/// parent's division said of it is all there is.
fn gap(part: Part, reason: &'static str) -> Component {
    Component {
        gaps: vec![Gap {
            paths: part.files.clone(),
            reason: reason.into(),
        }],
        blobs: BTreeMap::new(),
        id: part.id,
        name: part.name,
        parent: part.parent,
        overview: part.summary,
        files: part.files,
        interpretations: vec![],
        relationships: part.relationships,
        explainer: None,
    }
}

/// Each Wiki's last build, by its id.
fn load(config_dir: &Path) -> io::Result<BTreeMap<String, Outcome>> {
    state::load(&config_dir.join(FILE))
}

/// Change the queue under its lock.
fn update_queue<T>(config_dir: &Path, change: impl FnOnce(&mut Queue) -> T) -> io::Result<T> {
    let file = config_dir.join(QUEUE);
    state::update(&file, |text| {
        let mut queue = state::parse(&file, text)?;
        let out = change(&mut queue);
        Ok::<_, io::Error>((state::text(&queue), out))
    })
}

/// Keep `outcome` as the last build of the Wiki `id`.
fn keep(config_dir: &Path, id: &str, outcome: &Outcome) -> io::Result<()> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: BTreeMap<String, Outcome> = state::parse(&file, text)?;
        let mut outcome = outcome.clone();
        if let Outcome::Failed { built, .. } = &mut outcome {
            *built = all.get(id).and_then(Outcome::wiki).cloned();
        }
        all.insert(id.into(), outcome);
        Ok::<_, io::Error>((state::text(&all), ()))
    })
}
