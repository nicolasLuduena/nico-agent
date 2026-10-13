//! A Repo's Wiki, built from scratch by `wiki build`. Its code at
//! `origin/<base>` is divided top-down, as know-the-map's hermeneut does:
//! each part is one headless, read-only call of the `[wiki]` launch, and
//! code checks every answer, sending each claim that fails back to the
//! model in the same session, up to 3 rounds, then dropping it and recording
//! its part as a Gap. The Wiki lands in the Bucket in one commit, then its
//! records are embedded for `ask`; the build's outcome in `wikis.json`, last.
//!
//! The loop runs each build as a Run in a herdr pane, one at a time across
//! every Repo and outside every room, the others waiting in `wiki-queue.json`.

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
use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Repo, fill_in};
use crate::launch;
use crate::repo;
use crate::state;
use crate::world::{Answered, Headless, World, WorldResult};

/// Each Wiki's last build, by its id: a Repo's slug.
pub const FILE: &str = "wikis.json";

/// The Wikis waiting for a build, and when each Repo's was last checked.
const QUEUE: &str = "wiki-queue.json";

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
    /// When each Repo's Wiki was last checked against its Base, by slug.
    #[serde(default)]
    checked: BTreeMap<String, String>,
}

/// Close the wiki Run whose build ended; check the Wiki of each Repo with
/// its `wiki` switch on, once a day from the wiki hour and at once when the
/// switch turns on, queueing it when it has none or its `origin/<base>`
/// moved from its commit; then start the first queued while no wiki Run is
/// open. A check that fails is said and tried again next tick. What it said.
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
        let on = |id: &String| config.repos.get(id).is_some_and(|r| r.switches.wiki);
        queue.waiting.retain(on);
        queue.checked.retain(|id, _| on(id));
        for (slug, why) in queued {
            queue.waiting.push(slug.clone());
            said.push(format!("{slug}: wiki queued, {why}"));
        }
        for slug in checked {
            queue.checked.insert(slug.clone(), now.clone());
        }
        (open.is_none() && !queue.waiting.is_empty()).then(|| queue.waiting.remove(0))
    })?;
    if let Some(slug) = next {
        let repo = &config.repos[&slug];
        let start = |run: &mut Run| {
            let workspace = (run.workspace).insert(
                ctx.world
                    .herdr_workspace_create(&repo.path, &run.launch.agent)?,
            );
            let label = run.trigger.label();
            launch::open_tab(ctx.world, &mut run.launch, workspace, &repo.path, label)?;
            let pane = run.launch.pane.as_deref().expect("its tab is open");
            // Its shell exits with it, so a pane gone is a build ended.
            let command = format!("nico-agent wiki build {slug}; exit");
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
    let base = match &repo.base {
        Some(base) => base.clone(),
        None => world.git_default_branch(&repo.path)?,
    };
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Wiki {
    version: u32,
    target: Target,
    commit: String,
    built_at: String,
    files: Vec<File>,
    components: Vec<Component>,
}

#[derive(Serialize)]
struct Target {
    repo: String,
}

#[derive(Serialize)]
struct File {
    path: String,
    blob: String,
    lines: usize,
}

#[derive(Serialize)]
struct Component {
    id: String,
    name: String,
    parent: Option<String>,
    overview: String,
    files: Vec<String>,
    interpretations: Vec<Interpretation>,
    relationships: Vec<Relationship>,
    #[serde(skip_serializing_if = "Option::is_none")]
    explainer: Option<Explainer>,
    gaps: Vec<Gap>,
}

#[derive(Serialize, Deserialize)]
struct Interpretation {
    /// Its place among its Component's, from 1.
    #[serde(skip_deserializing)]
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

#[derive(Serialize)]
struct Relationship {
    to: String,
    kind: String,
    description: String,
}

#[derive(Serialize)]
struct Gap {
    paths: Vec<String>,
    reason: &'static str,
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

/// `wiki build <owner/name>`: build the Repo's Wiki from scratch and keep it
/// in the Bucket, writing how it went to `wikis.json` as the last act.
pub fn build(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let args = Args::parse("wiki build", args, &[])?;
    let slug = args.positionals(&["<owner/name>"])?[0];
    let config = config::load(&ctx.config_dir)?;
    let (slug, repo) = config
        .repo(slug)
        .ok_or_else(|| repo::not_configured(slug))?;
    let built = built(ctx, &config, slug, repo);
    let at = state::iso(ctx.world.now());
    let outcome = match &built {
        Ok(wiki) => {
            let mut gaps = BTreeMap::new();
            for gap in wiki.components.iter().flat_map(|c| &c.gaps) {
                *gaps.entry(gap.reason.to_string()).or_default() += 1;
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

/// `GET /api/wikis`: each Repo's Wiki the Bucket holds, by its id, with the
/// commit it describes, when it was built and how many Gaps it has.
pub fn list(ctx: &Context) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let mut wikis = vec![];
    for slug in config.repos.keys() {
        let Some(wiki) = kept(ctx, &config, slug)? else {
            continue;
        };
        let gaps: usize = (wiki["components"].as_array().into_iter().flatten())
            .filter_map(|c| c["gaps"].as_array().map(Vec::len))
            .sum();
        wikis.push(json!({
            "id": slug,
            "target": wiki["target"],
            "commit": wiki["commit"],
            "builtAt": wiki["builtAt"],
            "gaps": gaps,
        }));
    }
    Ok(json!(wikis))
}

/// `GET /api/wiki/<id>`: the Wiki `id` names, as the Bucket holds it; none
/// for an id no Repo has, or a Repo whose Wiki was never built.
pub fn get(ctx: &Context, id: &str) -> Result<Option<Value>, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    match config.repo(id) {
        Some((slug, _)) => kept(ctx, &config, slug),
        None => Ok(None),
    }
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
/// after, and kept in the Bucket.
fn built(ctx: &Context, config: &Config, slug: &str, repo: &Repo) -> Result<Wiki, Refusal> {
    let (world, call) = (ctx.world, headless(config, &WRITES)?);
    let base = match &repo.base {
        Some(base) => base.clone(),
        None => world.git_default_branch(&repo.path)?,
    };
    world.git_fetch(&repo.path, None)?;
    let folder = ctx.config_dir.join("wiki").join(slug);
    // One build of a Wiki at a time: another would remove its checkout.
    let _building = state::lock(&folder.join("build"))?;
    let dir = folder.join("checkout").display().to_string();
    // One a build that died left behind.
    world.git_worktree_remove(&repo.path, &dir)?;
    world.git_worktree_add(&repo.path, &dir, &format!("origin/{base}"))?;
    let wiki = described(ctx, config, slug, &dir, &call);
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
/// a depth at a time, each answer's failing claims sent back in rounds.
// shortcut: a slow part holds up the next depth's; pipeline the calls if builds run long.
fn described(
    ctx: &Context,
    config: &Config,
    slug: &str,
    dir: &str,
    call: &Headless,
) -> Result<Wiki, Refusal> {
    let (world, budget) = (ctx.world, &config.wiki);
    let commit = world.git_rev(dir, "HEAD")?;
    let files = files(world, dir)?;
    let lines: HashMap<&str, usize> = (files.iter()).map(|f| (f.path.as_str(), f.lines)).collect();
    world.log(&format!(
        "building the Wiki of {slug} at {commit}: {} calls, {} deep, {} at once",
        budget.calls, budget.depth, budget.concurrency
    ));
    let mut frontier = vec![Part {
        id: INDEX.into(),
        name: slug.into(),
        parent: None,
        summary: String::new(),
        trail: slug.into(),
        files: files.iter().map(|f| f.path.clone()).collect(),
        depth: 0,
        relationships: vec![],
    }];
    let (mut components, mut ids) = (vec![], HashSet::from([INDEX.to_string()]));
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
    Ok(Wiki {
        version: 1,
        target: Target { repo: slug.into() },
        commit,
        built_at: state::iso(world.now()),
        files,
        components,
    })
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
            reason,
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
            reason,
        }],
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
