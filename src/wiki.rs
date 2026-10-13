//! A Repo's Wiki, built from scratch by `wiki build`. Its code at
//! `origin/<base>` is divided top-down, as know-the-map's hermeneut does:
//! each part is one headless, read-only call of the `[wiki]` launch, and
//! code checks every answer, dropping each claim that fails and recording
//! its part as a Gap. The Wiki lands in the Bucket in one commit; the
//! build's outcome in `wikis.json`, last.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::bucket;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Repo, fill_in};
use crate::repo;
use crate::state;
use crate::world::{Headless, World, WorldResult};

/// Each Wiki's last build, by its id: a Repo's slug.
pub const FILE: &str = "wikis.json";

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

/// How a build ended, as `wikis.json` keeps it: `"outcome": "built"`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum Outcome {
    Built {
        at: String,
        commit: String,
        components: usize,
        /// How many Gaps of each reason it left.
        gaps: BTreeMap<String, usize>,
    },
    Failed {
        at: String,
        why: String,
    },
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
struct Anchor {
    path: String,
    start: usize,
    end: usize,
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
            Outcome::Built {
                at,
                commit: wiki.commit.clone(),
                components: wiki.components.len(),
                gaps,
            }
        }
        Err(no) => Outcome::Failed {
            at,
            why: no.error.clone(),
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

/// The Wiki of the Repo `slug`, built on a checkout of its Base, removed
/// after, and kept in the Bucket.
fn built(ctx: &Context, config: &Config, slug: &str, repo: &Repo) -> Result<Wiki, Refusal> {
    let (world, call) = (ctx.world, headless(config)?);
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
    Ok(wiki)
}

/// The Wiki of the code checked out in `dir`, its parts asked by `call`
/// a depth at a time.
// shortcut: a slow part holds up the next depth's; pipeline the calls if builds run long.
fn described(
    ctx: &Context,
    config: &Config,
    slug: &str,
    dir: &str,
    call: &Headless,
) -> Result<Wiki, Refusal> {
    let (world, budget) = (ctx.world, &config.wiki);
    let commit = world.git_head(dir)?;
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
        let mut next = vec![];
        for (part, unasked) in frontier.drain(..).zip(unasked) {
            if let Some(reason) = unasked {
                world.log(&format!("{}: not asked ({reason}), a Gap", part.trail));
                components.push(gap(part, reason));
                continue;
            }
            let answer = answers.next().expect("an answer to each call")?;
            let trail = part.trail.clone();
            let (component, parts, dropped) = read(part, &answer, &lines, &mut ids);
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

/// The `[wiki]` launch's headless, read-only call, its prompt to fill in:
/// opencode's `run`, on a server of its own, so that the config denying
/// every write is the one it runs on.
fn headless(config: &Config) -> Result<Headless, Refusal> {
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
    // `execute` reaches the user's own MCP servers, some of which write.
    let denied = [
        "edit",
        "bash",
        "webfetch",
        "websearch",
        "task",
        "external_directory",
        "execute",
    ];
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

Answer with one JSON object and nothing else, in one of two shapes:

{"kind": "leaf", "overview": "...", "interpretations": [{"kind": "role", "text": "...", "anchors": [{"path": "...", "start": 1, "end": 2}]}]}

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

/// The Component `part` makes of the model's `answer`, the parts its
/// division opens, each named by an id not in `ids`, and why each claim that
/// failed a check was dropped: the part is then a Gap, unreadable.
fn read(
    part: Part,
    answer: &str,
    lines: &HashMap<&str, usize>,
    ids: &mut HashSet<String>,
) -> (Component, Vec<Part>, Vec<String>) {
    let Some(answer) = parsed(answer) else {
        return (gap(part, "unreadable"), vec![], vec!["its answer".into()]);
    };
    let in_part: HashSet<&str> = part.files.iter().map(String::as_str).collect();
    let mut dropped = vec![];
    let mut interpretations = claims(
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
            if i.anchors.is_empty() {
                return Some("it cites no Anchor".into());
            }
            (i.anchors.iter()).find_map(|a| match lines.get(a.path.as_str()) {
                Some(&n) => (a.start < 1 || a.start > a.end || a.end > n).then(|| {
                    format!(
                        "lines {}-{} are not inside {} ({n} lines)",
                        a.start, a.end, a.path
                    )
                }),
                None => Some(format!("{} is not a file of the Repo", a.path)),
            })
        },
    );
    for (n, interpretation) in interpretations.iter_mut().enumerate() {
        interpretation.id = n + 1;
    }
    let division = match answer.kind.as_str() {
        "division" => &answer.components[..],
        _ => &[],
    };
    let named = claims(division, &mut dropped, |c: &Named| {
        let outside = c.files.iter().find(|f| !in_part.contains(f.as_str()));
        match (c.files.is_empty(), outside) {
            (true, _) => Some("it has no files".into()),
            (_, Some(f)) => Some(format!("{f} is not one of the part's files")),
            _ => None,
        }
    });
    let said = claims(&answer.relationships, &mut dropped, |r: &Said| {
        if !RELATIONSHIPS.contains(&r.kind.as_str()) {
            let kinds = RELATIONSHIPS.join(", ");
            return Some(format!("its kind `{}` is not one of {kinds}", r.kind));
        }
        [&r.from, &r.to]
            .into_iter()
            .find(|name| !named.iter().any(|c| c.name == **name))
            .map(|name| format!("{name} is not a Component of the division"))
    });
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
            reason: "unreadable",
        }],
    };
    let component = Component {
        id: part.id,
        name: part.name,
        parent: part.parent,
        overview: answer.overview,
        files: part.files,
        interpretations,
        relationships: part.relationships,
        gaps,
    };
    (component, parts, dropped)
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

/// The answer in `text`, its one JSON object, fenced or not.
fn parsed(text: &str) -> Option<Answer> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    let answer: Answer = serde_json::from_str(text.get(start..=end)?).ok()?;
    ["leaf", "division"]
        .contains(&answer.kind.as_str())
        .then_some(answer)
}

/// Each claim of `raw` that reads as a `T` and passes `check`, which says
/// what is wrong with one; why each other one was dropped, onto `dropped`.
fn claims<T: DeserializeOwned>(
    raw: &[Value],
    dropped: &mut Vec<String>,
    check: impl Fn(&T) -> Option<String>,
) -> Vec<T> {
    (raw.iter())
        .filter_map(|claim| {
            let problem = match serde_json::from_value::<T>(claim.clone()) {
                Ok(read) => match check(&read) {
                    None => return Some(read),
                    Some(problem) => problem,
                },
                Err(e) => format!("it does not read: {e}"),
            };
            dropped.push(format!("{claim}: {problem}"));
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
    }
}

/// Keep `outcome` as the last build of the Wiki `id`.
fn keep(config_dir: &Path, id: &str, outcome: &Outcome) -> io::Result<()> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all: BTreeMap<String, Outcome> = state::parse(&file, text)?;
        all.insert(id.into(), outcome.clone());
        Ok::<_, io::Error>((state::text(&all), ()))
    })
}
