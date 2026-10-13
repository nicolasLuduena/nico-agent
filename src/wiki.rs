//! A Repo's Wiki, built by `wiki build` from scratch, with `--update` from
//! the Wiki before it, asking only about what changed, or with `--continue`
//! asking only about the parts its budget left Gaps. Its code at
//! `origin/<base>` is divided top-down, as know-the-map's hermeneut does:
//! each part is one headless, read-only call of the `[wiki]` launch, and
//! code checks every answer, sending each claim that fails back to the
//! model in the same session, up to 3 rounds, then dropping it and recording
//! its part as a Gap. The Wiki lands in the Bucket in one commit, then its
//! records are embedded for `ask`; the build's outcome in `wikis.json`, last.
//!
//! The loop runs each build as a Run in a herdr pane, one at a time across
//! every Repo and outside every room, the others waiting in `wiki-queue.json`;
//! the Board's buttons queue theirs first.
//!
//! Between builds, whoever serves a Wiki marks Stale each Interpretation
//! citing a file whose blob at `origin/<base>` is not the one it was written
//! against.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::ask;
use crate::away::{self, Run, Trigger};
use crate::bucket;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config::{self, Config, Repo, fill_in};
use crate::install::base;
use crate::launch;
use crate::repo;
use crate::state;
use crate::world::{Answered, Headless, World, WorldResult};

/// Each Wiki's last build, by its id: a Repo's slug.
pub const FILE: &str = "wikis.json";

/// The Wikis waiting for a build, and when each Repo's was last checked.
const QUEUE: &str = "wiki-queue.json";

/// How a build may be asked for, besides from scratch: `--update`,
/// `--rebuild` (from scratch) or `--continue`.
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

#[derive(Default, Serialize, Deserialize)]
struct Queue {
    /// By id, in the order they start.
    waiting: Vec<String>,
    /// How each the user asked for is built, by id: one of [`BUILDS`].
    #[serde(default)]
    asked: BTreeMap<String, String>,
    /// When each Repo's Wiki was last checked against its Base, by slug.
    #[serde(default)]
    checked: BTreeMap<String, String>,
}

/// Close the wiki Run whose build ended; check the Wiki of each Repo with
/// its `wiki` switch on, once a day from the wiki hour and at once when the
/// switch turns on, queueing it when it has none or its `origin/<base>`
/// moved from its commit; then start the first queued while no wiki Run is
/// open, an Update once the Repo has a Wiki. A check that fails is said and
/// tried again next tick. What it said.
pub fn step(ctx: &Context, config: &Config) -> Result<Vec<String>, Refusal> {
    let mut said = close(ctx)?;
    let outcomes = load(&ctx.config_dir)?;
    let runs = away::load(&ctx.config_dir)?;
    let open = open_run(&runs).and_then(|r| r.repo.as_ref());
    let queue: Queue = state::load(&ctx.config_dir.join(QUEUE))?;
    let slot = state::iso(away::last_slot(ctx, None, config.wiki.hour));
    let (mut queued, mut checked) = (vec![], vec![]);
    for (slug, repo) in config.repos.iter().filter(|(_, r)| r.switches.wiki) {
        let due = queue.checked.get(slug).is_none_or(|at| *at < slot);
        let why = match outcomes.get(slug).and_then(Outcome::wiki) {
            // Checked today, or its build in hand is today's.
            _ if !due || queue.waiting.contains(slug) || open == Some(slug) => None,
            None => Some("it has none".into()),
            Some(Built { commit, .. }) => match base_head(ctx.world, repo) {
                Err(e) => {
                    said.push(format!("could not check {slug}'s Base for its Wiki: {e}"));
                    continue;
                }
                Ok((_, head)) if head == *commit => None,
                Ok((base, head)) => Some(format!("origin/{base} moved from {commit} to {head}")),
            },
        };
        queued.extend(why.map(|why| (slug, why)));
        if due {
            checked.push(slug);
        }
    }
    let now = state::iso(ctx.world.now());
    let next = update_queue(&ctx.config_dir, |queue| {
        // Off, a Repo's Wiki is built no more: one waiting waits no longer,
        // and its check is forgotten, so it is checked once the switch is on.
        // One the user asked for is built all the same, while its Repo is.
        let on = |id: &String| config.repos.get(id).is_some_and(|r| r.switches.wiki);
        queue.asked.retain(|id, _| config.repos.contains_key(id));
        queue
            .waiting
            .retain(|id| on(id) || queue.asked.contains_key(id));
        queue.checked.retain(|id, _| on(id));
        for (slug, why) in queued {
            // Not one a button queued since the queue was read.
            if queue.waiting.contains(slug) {
                continue;
            }
            queue.waiting.push(slug.clone());
            said.push(format!("{slug}: wiki queued, {why}"));
        }
        for slug in checked {
            queue.checked.insert(slug.clone(), now.clone());
        }
        (open.is_none() && !queue.waiting.is_empty()).then(|| {
            let slug = queue.waiting.remove(0);
            let how = queue.asked.remove(&slug);
            (slug, how)
        })
    })?;
    if let Some((slug, how)) = next {
        let repo = &config.repos[&slug];
        // Once it has a Wiki, a Repo's is updated from it, unless asked otherwise.
        let has = outcomes.get(&slug).and_then(Outcome::wiki);
        let how = how.or_else(|| has.map(|_| "update".into()));
        let update = how.map_or(String::new(), |how| format!(" --{how}"));
        let start = |run: &mut Run| {
            let workspace = (run.workspace).insert(
                ctx.world
                    .herdr_workspace_create(&repo.path, &run.launch.agent)?,
            );
            let label = run.trigger.label();
            launch::open_tab(ctx.world, &mut run.launch, workspace, &repo.path, label)?;
            let pane = run.launch.pane.as_deref().expect("its tab is open");
            // Its shell exits with it, so a pane gone is a build ended.
            let command = format!("nico-agent wiki build {slug}{update}; exit");
            Ok(ctx.world.herdr_pane_run(pane, &command)?)
        };
        let chosen = config.wiki.launch.clone();
        said.push(away::start_run(
            ctx,
            Trigger::Wiki,
            Some(&slug),
            chosen,
            start,
        )?);
    }
    Ok(said)
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
    let id = run.repo.as_deref().expect("a wiki Run is of a Repo");
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
/// state, the commit, time and Gaps of the build that built it, and why
/// its last build failed if it did.
pub fn shown(config_dir: &Path, runs: &[Run]) -> io::Result<Vec<Value>> {
    let outcomes = load(config_dir)?;
    let queue: Queue = state::load(&config_dir.join(QUEUE))?;
    let open = open_run(runs);
    let mut ids: Vec<&String> = outcomes.keys().chain(&queue.waiting).collect();
    ids.extend(open.and_then(|r| r.repo.as_ref()));
    ids.sort();
    ids.dedup();
    Ok((ids.into_iter())
        .map(|id| {
            let building = open.filter(|r| r.repo.as_ref() == Some(id));
            let outcome = outcomes.get(id);
            let state = match outcome {
                _ if building.is_some() => "building",
                _ if queue.waiting.contains(id) => "queued",
                Some(Outcome::Built(_)) => "built",
                _ => "failed",
            };
            let mut shown = json!({
                "wiki": id,
                "target": { "repo": id },
                "state": state,
                "commit": null,
                "built_at": null,
                "gaps": null,
                "pane": building.and_then(|r| r.launch.pane.clone()),
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
            shown
        })
        .collect())
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

#[derive(Serialize, Deserialize)]
struct Target {
    repo: String,
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

/// `wiki build <owner/name> [--update|--rebuild|--continue]`: build the
/// Repo's Wiki from scratch (`--rebuild` too), with `--update` from the one
/// the Bucket holds, or with `--continue` fill in its budget Gaps, and keep
/// it in the Bucket, writing how it went to `wikis.json` as the last act.
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
    let slug = args.positionals(&["<owner/name>"])?[0];
    let config = config::load(&ctx.config_dir)?;
    let (slug, repo) = config
        .repo(slug)
        .ok_or_else(|| repo::not_configured(slug))?;
    let built = built(ctx, &config, slug, repo, how.first().map(|how| &how[2..]));
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
    keep(&ctx.config_dir, slug, &outcome)?;
    let mut said = serde_json::to_value(&outcome).expect("an outcome is plain data");
    said["wiki"] = json!(slug);
    built.map(|_| said).map_err(|no| Refusal {
        error: format!("could not build the Wiki of {slug}: {}", no.error),
        ..no
    })
}

/// `POST /api/wiki/<id>/<how>`: queue the build of the Wiki `id` first, to
/// be built `how`, one of [`BUILDS`]; a `continue` only of a Wiki with
/// budget Gaps. The queue after.
pub fn queue(ctx: &Context, id: &str, how: &str) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let (slug, _) = config.repo(id).ok_or_else(|| repo::not_configured(id))?;
    if how == "continue" {
        let wiki = kept(ctx, &config, slug)?.ok_or_else(|| uncontinued(slug))?;
        if gaps(&wiki).filter(|g| g["reason"] == "budget").count() == 0 {
            return Err(Refusal::new(
                format!("the Wiki of {slug} has no budget Gaps to continue"),
                vec!["Update it, or Rebuild it from nothing".into()],
            ));
        }
    }
    let waiting = update_queue(&ctx.config_dir, |queue| {
        queue.waiting.retain(|id| id != slug);
        queue.waiting.insert(0, slug.clone());
        queue.asked.insert(slug.clone(), how.into());
        queue.waiting.clone()
    })?;
    Ok(json!({ "wiki": slug, "build": how, "waiting": waiting }))
}

/// The refusal of a `continue` of `slug`, which has no Wiki.
fn uncontinued(slug: &str) -> Refusal {
    Refusal::new(
        format!("{slug} has no Wiki to continue"),
        vec![format!("Build it first: nico-agent wiki build {slug}")],
    )
}

/// Each Gap of each Component of `wiki`, as the Bucket holds it.
fn gaps(wiki: &Value) -> impl Iterator<Item = &Value> {
    (wiki["components"].as_array().into_iter().flatten())
        .flat_map(|c| c["gaps"].as_array().into_iter().flatten())
}

/// `GET /api/wikis`: each Repo's Wiki the Bucket holds, by its id, with the
/// commit it describes, when it was built, how many Gaps it has and how many
/// of them `continue` asks about with its `calls`, and the `state` of its
/// build as `status` shows it, with the open Run's pane, or why it failed.
pub fn list(ctx: &Context) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let builds = shown(&ctx.config_dir, &away::load(&ctx.config_dir)?)?;
    let mut wikis = vec![];
    for slug in config.repos.keys() {
        let Some(wiki) = kept(ctx, &config, slug)? else {
            continue;
        };
        // One the Bucket holds that no build of this machine's made is built.
        let build = builds.iter().find(|b| b["wiki"] == **slug);
        let build = build.cloned().unwrap_or(json!({ "state": "built" }));
        wikis.push(json!({
            "id": slug,
            "target": wiki["target"],
            "commit": wiki["commit"],
            "builtAt": wiki["builtAt"],
            "gaps": gaps(&wiki).count(),
            "budget": gaps(&wiki).filter(|g| g["reason"] == "budget").count(),
            "calls": config.wiki.calls,
            "state": build["state"],
            "pane": build["pane"],
            "why": build["why"],
        }));
    }
    Ok(json!(wikis))
}

/// `GET /api/wiki/<id>`: the Wiki `id` names, as the Bucket holds it,
/// marked against its Base; none for an id no Repo has, or a Repo whose
/// Wiki was never built.
pub fn get(ctx: &Context, id: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let Some((slug, repo)) = config.repo(id) else {
        return Ok(None);
    };
    let Some(mut wiki) = kept(ctx, &config, slug)? else {
        return Ok(None);
    };
    marked(ctx.world, repo, &mut wiki)?;
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

/// The Wiki of the Repo `slug` the Bucket holds.
fn kept(ctx: &Context, config: &Config, slug: &str) -> Result<Option<Value>, Refusal> {
    let Some(text) = bucket::wiki(ctx.world, config, slug)? else {
        return Ok(None);
    };
    let wiki = serde_json::from_slice(&text).map_err(|e| {
        Refusal::new(
            format!("the Wiki of {slug} in the Bucket is not JSON: {e}"),
            vec![format!("Build it again: nico-agent wiki build {slug}")],
        )
    })?;
    Ok(Some(wiki))
}

/// The Wiki of the Repo `slug`, built on a checkout of its Base, removed
/// after, and kept in the Bucket: built `how` it was asked, from the one the
/// Bucket holds for an `update` if it holds one; for a `continue`, from it
/// on a checkout of the commit it describes.
fn built(
    ctx: &Context,
    config: &Config,
    slug: &str,
    repo: &Repo,
    how: Option<&str>,
) -> Result<Wiki, Refusal> {
    let (world, call) = (ctx.world, headless(config, &WRITES)?);
    let continuing = how == Some("continue");
    let previous = match how {
        Some("update" | "continue") => kept(ctx, config, slug)?.map(serde_json::from_value::<Wiki>),
        _ => None,
    };
    let previous = previous.transpose().map_err(|e| {
        Refusal::new(
            format!("the Wiki of {slug} in the Bucket does not read: {e}"),
            vec![format!(
                "Build it from scratch: nico-agent wiki build {slug}"
            )],
        )
    })?;
    if continuing && previous.is_none() {
        return Err(uncontinued(slug));
    }
    let base = base(world, repo)?;
    world.git_fetch(&repo.path, None)?;
    let folder = ctx.config_dir.join("wiki").join(slug);
    // One build of a Wiki at a time: another would remove its checkout.
    let _building = state::lock(&folder.join("build"))?;
    let dir = folder.join("checkout").display().to_string();
    // One a build that died left behind.
    world.git_worktree_remove(&repo.path, &dir)?;
    let at = match &previous {
        // Filled in at its own commit, the Wiki still describes one.
        Some(wiki) if continuing => wiki.commit.clone(),
        _ => format!("origin/{base}"),
    };
    world.git_worktree_add(&repo.path, &dir, &at)?;
    let wiki = described(ctx, config, slug, &dir, &call, previous, continuing);
    let removed = world.git_worktree_remove(&repo.path, &dir);
    let wiki = wiki?;
    removed?;
    let message = format!("wiki {slug} {}", wiki.commit);
    bucket::keep_wiki(ctx, config, slug, &state::text(&wiki), &message)?;
    let kept = serde_json::to_value(&wiki).expect("a Wiki is plain data");
    if let Err(no) = ask::embedded(ctx, config, slug, &kept) {
        let why = no.error;
        world.log(&format!(
            "could not embed the Wiki of {slug}, so ask embeds it first: {why}"
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
    slug: &str,
    dir: &str,
    call: &Headless,
    previous: Option<Wiki>,
    continuing: bool,
) -> Result<Wiki, Refusal> {
    let (world, budget) = (ctx.world, &config.wiki);
    let commit = world.git_rev(dir, "HEAD")?;
    let files = files(world, dir)?;
    let lines: HashMap<&str, usize> = (files.iter()).map(|f| (f.path.as_str(), f.lines)).collect();
    world.log(&format!(
        "building the Wiki of {slug} at {commit}: {} calls, {} deep, {} at once",
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
                name: slug.into(),
                parent: None,
                summary: String::new(),
                trail: slug.into(),
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
        let calls: Vec<Headless> = (frontier.iter().zip(&unasked))
            .filter(|(_, unasked)| unasked.is_none())
            .map(|(part, _)| Headless {
                prompt: prompt(slug, part, &lines),
                ..call.clone()
            })
            .collect();
        let at_once = budget.concurrency as usize;
        let mut answers = world.harness_headless(dir, &calls, at_once).into_iter();
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
                let resumed = ["-s".into(), answered.session.clone()];
                sent.push((
                    i,
                    Headless {
                        args: [&call.args[..], &resumed].concat(),
                        prompt: correction(&a.part, &failed),
                        ..call.clone()
                    },
                ));
            }
            if sent.is_empty() {
                break;
            }
            let (which, corrections): (Vec<usize>, Vec<Headless>) = sent.into_iter().unzip();
            let replies = world.harness_headless(dir, &corrections, at_once);
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
                continue;
            };
            let trail = part.trail.clone();
            let (component, parts, dropped) = read(part, &answered.text, &lines, &mut ids, reason);
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
        target: Target { repo: slug.into() },
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
    let budget = |i: &usize| continuing && all[*i].gaps.iter().any(|g| g.reason == "budget");
    let (mut asked, mut added): (HashSet<usize>, _) = (
        (0..all.len()).filter(budget).collect(),
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

/// Each file of the checkout in `dir`, by path, with its blob and line count.
fn files(world: &dyn World, dir: &str) -> WorldResult<Vec<File>> {
    let mut files = vec![];
    for (path, blob) in world.git_ls_tree_blobs(dir, "HEAD")? {
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

/// The tools a part's call may not use: every one that writes or leaves its
/// folder. `execute` reaches the user's own MCP servers, some of which write.
const WRITES: [&str; 7] = [
    "edit",
    "bash",
    "webfetch",
    "websearch",
    "task",
    "external_directory",
    "execute",
];

/// The `[wiki]` launch's headless call, its prompt to fill in, with the
/// tools `denied` (`*` for every one): opencode's `run`, on a server of its
/// own, so that the config denying them is the one it runs on.
pub fn headless(config: &Config, denied: &[&str]) -> Result<Headless, Refusal> {
    let launch = &config.wiki.launch;
    let command = (launch.harness == "opencode")
        .then(|| config.harnesses[&launch.harness].command.clone())
        .flatten()
        .ok_or_else(|| {
            Refusal::new(
                format!(
                    "{} has no headless form: only opencode builds a Wiki",
                    launch.harness
                ),
                vec!["Set [wiki] launch to an opencode one in config.toml".into()],
            )
        })?;
    let mut args = vec!["run".to_string(), "--standalone".into()];
    if let Some(model) = &launch.model {
        let model = (launch.effort.as_ref()).map_or(model.clone(), |e| format!("{model}#{e}"));
        args.extend(["-m".into(), model]);
    }
    args.extend(["--format".into(), "json".into()]);
    let permission: serde_json::Map<String, Value> = (denied.iter())
        .map(|tool| (tool.to_string(), json!("deny")))
        .collect();
    let config = json!({ "permission": permission }).to_string();
    Ok(Headless {
        command,
        args,
        env: vec![("OPENCODE_CONFIG_CONTENT".into(), config)],
        prompt: String::new(),
    })
}

const PROMPT: &str = r#"You are writing one part of the Wiki of {repo}: what its code does, each claim citing the lines it rests on. You may read, grep, glob and list the files in this folder, and nothing else.

## The part: {trail}

Its files, by repo-relative path, with their line counts:

{files}
{context}Read the files you need, then answer whether this part is one piece of code (a leaf) or divides into Components (a division).

- Spend your reads on code: its invariants, contracts, effects and control flow. Docs, assets, lockfiles and generated files need only a glance.
- Read only files from the list, and read a file before claiming anything about it. Write each path exactly as listed.
- An overview is plain prose of at most 5 sentences on what the part is for and how it works.
- An Interpretation is one sentence claiming one thing, of one kind: invariant, precondition, postcondition, effect or role. It cites at least one Anchor.
- An Anchor is lines of a listed file, 1-based and inclusive: start <= end <= the file's line count.
- A division's Components share out the part's files, each listed file in at most one; a Component's summary is one or two sentences. When docs or assets force a division, group them into one Component.
- A Relationship goes from one Component of your division to another, named as you named them, of one kind: uses, calls, reads or writes.
- A leaf may carry one Explainer, when how something in it works is best walked through in order: a title, at most 8 steps numbered from 1, each a one-sentence caption citing at least one Anchor, with an optional lane naming where the step happens, and arrows from step to step by number, each with an optional label. Leave it out otherwise.

Answer with one JSON object and nothing else, in one of two shapes:

{"kind": "leaf", "overview": "...", "interpretations": [{"kind": "role", "text": "...", "anchors": [{"path": "...", "start": 1, "end": 2}]}], "explainer": {"title": "...", "steps": [{"n": 1, "caption": "...", "anchors": [{"path": "...", "start": 1, "end": 2}], "lane": "..."}], "arrows": [{"from": 1, "to": 2, "label": "..."}]}}

{"kind": "division", "overview": "...", "components": [{"name": "...", "summary": "...", "files": ["..."]}], "relationships": [{"from": "...", "to": "...", "kind": "uses", "description": "..."}], "interpretations": [{"kind": "invariant", "text": "...", "anchors": [{"path": "...", "start": 1, "end": 2}]}]}
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
        None => String::new(),
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
            unanchored(&i.anchors, lines)
        },
    );
    let (division, explainer) = match answer.kind.as_str() {
        "division" => (&answer.components[..], &[][..]),
        _ => (&[][..], answer.explainer.as_slice()),
    };
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
    let named = claims("component", division, &mut dropped, |c: &Named| {
        let outside = c.files.iter().find(|f| !in_part.contains(f.as_str()));
        match (c.files.is_empty(), outside) {
            (true, _) => Some("it has no files".into()),
            (_, Some(f)) => Some(format!("{f} is not one of the part's files")),
            _ => None,
        }
    });
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
/// one not inside a file of the Repo, as `lines` counts them.
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
        None => Some(format!("{} is not a file of the Repo", a.path)),
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
