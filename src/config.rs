//! `config.toml` in the config directory: the Repos, Harnesses, prompt
//! templates and loop settings, edited by hand and by `repo` commands. It is
//! read with every default filled in, and a bad value is refused naming its
//! key and line.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_path_to_error::Segment;
use toml_edit::{Document, DocumentMut, Item, TableLike};

use crate::cli::Refusal;
use crate::dispatch::Dispatch;
use crate::repo;
use crate::state;

pub const FILE: &str = "config.toml";

/// What a config leaves out, filled in under it before it is read.
const DEFAULTS: &str = r#"
tick_minutes = 10
stall_minutes = 20
max_restarts_per_reason = 2
# Where serve answers the app and the Bucket, on 127.0.0.1.
port = 42069
repos = {}
# Each Project's defaults, by name, which its Repos take where they set none:
# any Repo key but path, linear, project and install.
projects = {}

# Where Evidence is kept, one commit per PR head, Verdict and Close. With
# `url` unset, links to it are serve's own; set it to the tunnel's, which the
# PR bodies then link.
[bucket]
path = "/mnt/agents-land/nico-agent-bucket"

# When each Repo with its quality_scan switch on is scanned, weekly, local time.
[quality_scan]
weekday = "sunday"
hour = 3

# When the morning agent writes morning.md, daily, local time; it runs on
# `launch` when set, else on the first Repo's implementer.
[morning]
enabled = true
hour = 7

# Wiki builds, one at a time, outside every room. The loop checks the Wiki of
# each Repo with its wiki switch on once the switch turns on, then daily from
# `hour`, local time, and builds it when it has none or its Base moved from its
# commit. Each part of the code is one headless, read-only call of `launch`: at
# most `calls` of them a build, `concurrency` at once, dividing the code at
# most `depth` deep. `ask` finds what a question is about by the embeddings of
# `embed_model`, from the Ollama answering at `ollama`. Each Library version a
# Repo's `libraries` links, or `libraries` here adds, as
# `{ repo = "owner/name", tag = "...", path = "sub/folder" }` (`path` optional),
# is built once, when it has no Wiki, fetched from https://github.com/<owner/name>.git
# with git's own credentials: a private one needs a credential helper for it.
[wiki]
hour = 2
launch = { harness = "opencode", model = "opencode-go/deepseek-v4.1-flash" }
calls = 48
depth = 7
concurrency = 4
embed_model = "nomic-embed-text"
ollama = "http://127.0.0.1:11434"
libraries = []

[prompts]
implement = "{sigil}implement {issueUrl} as draft PR against {baseBranch}, saving its Evidence under {evidenceFolder}/ in the worktree and linking it to {bucketUrl}"
research = "{sigil}research {issueUrl}; write the findings with sources to one Markdown file under docs/research/ and open it as a draft PR against {baseBranch}"
faux_nico = '{sigil}faux-nico {issueUrl}: the Implementer asks "{question}". Read PRODUCT.md, the issue and its parent. Answer with nico-agent answer {issue} --text "..." --by faux-nico only when they settle it; otherwise end your turn without answering.'
review = "{sigil}verdict {prUrl} for {issueUrl}: re-run the repo's verification skill under .agents/skills/verify-*/ against the PR's head, saving its Evidence under {evidenceFolder}/, and record the result with nico-agent verdict {issue} pass|fail --sha {headSha} --findings <file>"
quality_scan = "{sigil}quality-scan {repoSlug}"
morning = "{sigil}morning: the night is in nico-agent status --json --since {lastMorningAt}. Write the summary to {configDir}/morning.md, with one line on the Wikis its `wikis` lists built or failed since then."
# Appended to implement and research, as is, when the GitHub App is installed on the Repo.
bot_suffix = ", opened with `ghbot pr create` (not `gh`); end every commit message with the trailer `Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>`"

[prompts.restart]
prefix = "You are continuing {issueUrl} on branch {branch} in this worktree. Read git status, git log and the PR {prUrl} first."
rebooted = "The machine restarted. Continue where the branch left off."
stalled = "You stopped with no PR open. Continue to a draft PR."
conflict = "The PR conflicts with {baseBranch}. Rebase onto it, resolve, run the tests and the verification, push."
retarget = "The PR below yours merged. Retarget the PR onto {baseBranch}, rebase, push."
verdict = "The Reviewer failed the PR at {sha}. Its findings are in {findingsPath}. Address each, run the verification, push."

[harnesses.claude]
launch_mode = "herdr-kind"
kind = "claude"
sigil = "/"
model_args = ["--model", "{model}"]
effort_args = ["--effort", "{effort}"]
models = ["fable", "opus", "sonnet", "haiku"]
efforts = ["low", "medium", "high", "xhigh", "max"]
trust_prompt = { text = "Yes, I trust this folder", keys = ["down", "enter"] }
skill_dirs = ["~/.claude/skills", ".claude/skills"]

[harnesses.codex]
launch_mode = "herdr-kind"
kind = "codex"
sigil = "$"
model_args = ["-m", "{model}"]
effort_args = ["-c", "model_reasoning_effort={effort}"]
# codex asks to trust the clone (not the worktree) even when herdr reports it
# ready; this answers it for the session without writing ~/.codex/config.toml.
trust_args = ["-c", 'projects={"{repoPath}"={trust_level="trusted"}}']
# Its review of new or changed hooks, which herdr reports ready (#279), takes
# a prompt's Enter: the user's to answer, so no prompt is sent into it again.
startup_questions = ["Hooks need review", "review before"]
# ~/.codex/skills is where its skill installer still puts them.
skill_dirs = ["~/.codex/skills", "~/.agents/skills", ".agents/skills"]

# Its TUI takes no model or Effort flag: the model goes in
# OPENCODE_CONFIG_CONTENT and the Effort in its variant file.
[harnesses.opencode]
launch_mode = "pane-command"
command = "opencode2"
variant_file = "~/.local/state/opencode/model.json"
sigil = "@"
model_args = []
effort_args = []
skill_dirs = [
  "~/.config/opencode/skills", "~/.claude/skills", "~/.agents/skills",
  ".opencode/skills", ".claude/skills", ".agents/skills",
]
"#;

/// What a Repo leaves out, filled in under each `repos.<slug>` after its Project's.
const REPO_DEFAULTS: &str = r#"
room = 3
implementer = { harness = "claude" }
switches = { dispatch = true, stack = true, review = true, restart = true, flip = true, answer = false, gardening = false, quality_scan = false, wiki = false }
libraries = []
"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// By slug, as first added.
    pub repos: BTreeMap<String, Repo>,
    /// Each Project's defaults, by name, as written.
    pub projects: BTreeMap<String, Settings>,
    /// The built-in ones (claude, codex, opencode) under the config's settings.
    pub harnesses: BTreeMap<String, Harness>,
    pub bucket: Bucket,
    pub quality_scan: QualityScan,
    pub morning: Morning,
    pub wiki: Wiki,
    pub prompts: Prompts,
    #[serde(deserialize_with = "positive")]
    pub tick_minutes: u32,
    #[serde(deserialize_with = "positive")]
    pub stall_minutes: u32,
    #[serde(deserialize_with = "positive")]
    pub max_restarts_per_reason: u32,
    #[serde(deserialize_with = "positive_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Repo {
    pub path: String,
    pub linear: Option<Linear>,
    /// The Project it belongs to; its own, named by its slug, when unset.
    pub project: Option<String>,
    /// The command its Install runs in its clone after a merge into its Base.
    pub install: Option<String>,
    #[serde(deserialize_with = "positive")]
    pub room: u32,
    /// The Base a Dispatch starts from unless stacked; origin's default branch when unset.
    pub base: Option<String>,
    pub implementer: Launch,
    /// As set; [`Config::reviewer`] fills in the default.
    pub reviewer: Option<Launch>,
    /// The quality-scan's launch; the implementer's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_scan: Option<Launch>,
    /// faux-nico's launch; the implementer's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub faux_nico: Option<Launch>,
    pub switches: Switches,
    /// The Library versions it uses, whose Wikis its agents ask about.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub libraries: Vec<Library>,
    /// What it sets itself, of what it shows above.
    #[serde(skip)]
    pub own: Settings,
}

/// The settings a Project holds for its Repos, or a Repo sets itself: any
/// key of a Repo but `path`, `linear`, `project` and `install`, each unset till set.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room: Option<std::num::NonZeroU32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementer: Option<Launch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewer: Option<Launch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_scan: Option<Launch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub faux_nico: Option<Launch>,
    /// Each of [`SWITCHES`] it sets.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub switches: BTreeMap<String, bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub libraries: Option<Vec<Library>>,
}

impl Repo {
    /// The name of its Project: the one it names, else its own, named by its `slug`.
    pub fn project_name<'a>(&'a self, slug: &'a str) -> &'a str {
        self.project.as_deref().unwrap_or(slug)
    }

    /// `launch`, one of this Repo's, as set; the implementer's when unset.
    pub fn or_implementer(&self, launch: &Option<Launch>) -> Launch {
        launch.clone().unwrap_or_else(|| self.implementer.clone())
    }
}

/// Where Evidence is kept and what serves it.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bucket {
    pub path: String,
    /// What serves the Bucket under `/bucket/`, e.g. the tunnel's
    /// `https://host`; serve's own when unset.
    pub url: Option<String>,
}

/// When a quality-scan runs: weekly, at `hour` on `weekday`, local time.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QualityScan {
    pub weekday: Weekday,
    #[serde(deserialize_with = "hour")]
    pub hour: u32,
}

/// When the morning agent runs: daily at `hour`, local time, while `enabled`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Morning {
    pub enabled: bool,
    #[serde(deserialize_with = "hour")]
    pub hour: u32,
    /// The first Repo's implementer when unset.
    pub launch: Option<Launch>,
}

/// How Wikis are built (when, on what, and each build's budget) and searched.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wiki {
    /// When Repos' Wikis are updated, daily, local time.
    #[serde(deserialize_with = "hour")]
    pub hour: u32,
    /// What answers each part, headless and read-only.
    pub launch: Launch,
    /// Model calls a build may make.
    #[serde(deserialize_with = "positive")]
    pub calls: u32,
    /// How deep a build divides the code: the deepest division's parts are Gaps.
    #[serde(deserialize_with = "positive")]
    pub depth: u32,
    /// Calls a build makes at once.
    #[serde(deserialize_with = "positive")]
    pub concurrency: u32,
    /// The Ollama model that embeds overviews, Interpretations and questions.
    pub embed_model: String,
    /// Where Ollama answers.
    pub ollama: String,
    /// The Library versions no Repo links, added for the user's own sessions.
    pub libraries: Vec<Library>,
}

/// A Library version: a GitHub repository at a tag, its Wiki covering only
/// the subfolder `path`, when set.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Library {
    #[serde(deserialize_with = "slug")]
    pub repo: String,
    #[serde(deserialize_with = "tag")]
    pub tag: String,
    #[serde(
        default,
        deserialize_with = "subfolder",
        skip_serializing_if = "Option::is_none"
    )]
    pub path: Option<String>,
}

impl Library {
    /// Its Wiki's id: `<owner/name>@<tag>`, then `:<path>` when it has one.
    /// A slug holds no `@` and a tag no `:`, so the id reads back one way.
    pub fn id(&self) -> String {
        let path = self
            .path
            .as_ref()
            .map_or(String::new(), |p| format!(":{p}"));
        format!("{}@{}{path}", self.repo, self.tag)
    }
}

/// In the order `as` numbers them: Sunday is 0.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Weekday {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

/// Which Linear issues a Repo claims.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Linear {
    pub team: String,
    pub project: Option<String>,
    pub label: Option<String>,
}

/// A Harness with its model and Effort; the Harness's own default for one unset.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Launch {
    pub harness: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// The switches the app shows and sets.
pub const SWITCHES: [&str; 9] = [
    "dispatch",
    "stack",
    "review",
    "restart",
    "flip",
    "answer",
    "gardening",
    "quality_scan",
    "wiki",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Switches {
    pub dispatch: bool,
    pub stack: bool,
    pub review: bool,
    pub restart: bool,
    pub flip: bool,
    /// Reserved for spec 3: faux-nico answers, gardening, quality-scan.
    pub answer: bool,
    pub gardening: bool,
    pub quality_scan: bool,
    /// The loop builds its Wiki; off, the Wiki stays readable and is built no more.
    pub wiki: bool,
}

/// How a Harness is launched, as on `main` (ADR-0005).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Harness {
    pub launch_mode: LaunchMode,
    /// herdr's agent kind, which `herdr-kind` starts.
    pub kind: Option<String>,
    /// The binary `pane-command` runs in the pane.
    pub command: Option<String>,
    /// Where opencode keeps the Effort of each model; `~/` is the home directory.
    pub variant_file: Option<String>,
    /// What a skill call starts with in its prompts.
    pub sigil: String,
    /// Each with `{model}`, `{effort}` or `{repoPath}` (the clone) filled in at launch.
    pub model_args: Vec<String>,
    pub effort_args: Vec<String>,
    #[serde(default)]
    pub trust_args: Vec<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// The models and Efforts it takes; unset, any.
    pub models: Option<Vec<String>>,
    pub efforts: Option<Vec<String>>,
    /// The question it asks before working in a new folder, and the keys that answer yes.
    pub trust_prompt: Option<TrustPrompt>,
    /// Text on a screen it asks the user a question on while herdr reports it ready.
    #[serde(default)]
    pub startup_questions: Vec<String>,
    /// Where it reads skills from, each `<name>/SKILL.md`: `~/` the home
    /// directory, a relative one the Repo's clone.
    #[serde(default)]
    pub skill_dirs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LaunchMode {
    /// herdr starts the agent by its kind.
    HerdrKind,
    /// The command runs in the pane and the agent is named once herdr detects it.
    PaneCommand,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustPrompt {
    pub text: String,
    pub keys: Vec<String>,
}

/// The prompt templates, with `{placeholder}`s filled in when sent.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Prompts {
    pub implement: String,
    pub research: String,
    pub faux_nico: String,
    pub review: String,
    pub quality_scan: String,
    pub morning: String,
    pub bot_suffix: String,
    pub restart: RestartPrompts,
}

/// `prefix`, then the restart reason's own text.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestartPrompts {
    pub prefix: String,
    pub rebooted: String,
    pub stalled: String,
    pub conflict: String,
    pub retarget: String,
    pub verdict: String,
}

/// `template` with each `{name}` of `values` replaced; any other `{...}` is left as is.
pub fn fill_in(template: &str, values: &[(&str, &str)]) -> String {
    values
        .iter()
        .fold(template.to_string(), |text, (name, value)| {
            text.replace(&format!("{{{name}}}"), value)
        })
}

impl Config {
    /// How long a tick lasts, and so how old a Source read may be.
    pub fn tick(&self) -> Duration {
        Duration::from_secs(u64::from(self.tick_minutes) * 60)
    }

    /// Each Library version a Repo links or `[wiki]` adds, once, by its id.
    pub fn libraries(&self) -> BTreeMap<String, &Library> {
        let linked = self.repos.values().flat_map(|r| &r.libraries);
        (linked.chain(&self.wiki.libraries))
            .map(|l| (l.id(), l))
            .collect()
    }

    /// The Repo `slug` names, in any casing, by its slug as configured.
    pub fn repo(&self, slug: &str) -> Option<(&String, &Repo)> {
        (self.repos.iter()).find(|(s, _)| s.eq_ignore_ascii_case(slug))
    }

    /// The Repo `d` was dispatched into; once removed, the Repo's defaults on
    /// the clone `d` was dispatched from, so its work In flight goes on till Closed.
    pub fn repo_of(&self, d: &Dispatch) -> Repo {
        self.repos.get(&d.repo).cloned().unwrap_or_else(|| {
            let mut repo = defaults(REPO_DEFAULTS);
            repo["path"] = toml_edit::value(&d.repo_path);
            Repo::deserialize(toml_edit::de::Deserializer::from(repo))
                .expect("the Repo defaults are a Repo")
        })
    }

    /// What a Repo of the Project `name` takes where it sets nothing: the
    /// Project's defaults over the Repos'.
    pub fn project(&self, name: &str) -> Repo {
        let project = self.projects.get(name).cloned().unwrap_or_default();
        let mut repo =
            toml_edit::ser::to_document(&project).expect("a Project's defaults are TOML");
        layer(repo.as_table_mut(), defaults(REPO_DEFAULTS).as_table());
        repo["path"] = toml_edit::value("");
        repo["project"] = toml_edit::value(name);
        Repo::deserialize(toml_edit::de::Deserializer::from(repo))
            .expect("a Project's defaults over the Repo defaults are a Repo")
    }

    /// The Repo's reviewer launch for an Implementer on the Harness
    /// `implementer`; unset, a Harness other than that one, if there is one.
    pub fn reviewer(&self, repo: &Repo, implementer: &str) -> Launch {
        let other = self.harnesses.keys().find(|name| *name != implementer);
        repo.reviewer.clone().unwrap_or_else(|| Launch {
            harness: other.map_or(implementer, String::as_str).into(),
            model: None,
            effort: None,
        })
    }
}

/// The config in `dir`; no file is no Repos and every default.
pub fn load(dir: &Path) -> Result<Config, Refusal> {
    let file = dir.join(FILE);
    let text = match fs::read_to_string(&file) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
        read => read.map_err(|e| Refusal::new(format!("{}: {e}", file.display()), vec![]))?,
    };
    parse(&file, &text)
}

/// Change the config under its lock, keeping everything the user wrote
/// around the change; a config that doesn't load is refused, not rewritten.
pub fn edit<T>(
    dir: &Path,
    change: impl FnOnce(&Config, &mut DocumentMut) -> T,
) -> Result<T, Refusal> {
    let file = dir.join(FILE);
    state::update(&file, |text| {
        let config = parse(&file, text)?;
        let mut doc: DocumentMut = text.parse().expect("parse read it");
        let out = change(&config, &mut doc);
        Ok((doc.to_string(), out))
    })
}

fn parse(file: &Path, text: &str) -> Result<Config, Refusal> {
    let spanned = Document::parse(text)
        .map_err(|e| invalid(file, e.span().map(|s| line(text, s.start)), "", e.message()))?;
    let mut doc = spanned.clone().into_mut();
    fill(doc.as_table_mut(), defaults(DEFAULTS).as_table());
    let line_of = |keys: &[&str]| line_of(&spanned, keys);

    // Read before its Repos take its keys, so a bad one is refused at its own line.
    #[derive(Deserialize)]
    struct Projects {
        projects: BTreeMap<String, Settings>,
    }
    let mut projects = DocumentMut::new();
    projects.insert("projects", doc["projects"].clone());
    let Projects { projects } = deserialize(file, &spanned, projects)?;
    for (name, project) in &projects {
        if let Some(switch) = (project.switches.keys()).find(|s| !SWITCHES.contains(&s.as_str())) {
            let expected: Vec<String> = SWITCHES.iter().map(|s| format!("`{s}`")).collect();
            let problem = format!(
                "unknown field `{switch}`, expected one of {}",
                expected.join(", ")
            );
            let keys = ["projects", name, "switches", switch];
            return Err(invalid(file, line_of(&keys), &keys.join("."), &problem));
        }
    }

    let written_repos = doc["repos"].clone();
    let written_projects = doc["projects"].clone();
    let repo_defaults = defaults(REPO_DEFAULTS);
    if let Some(repos) = doc["repos"].as_table_like_mut() {
        for (slug, repo) in repos.iter_mut() {
            let Some(repo) = repo.as_table_like_mut() else {
                continue;
            };
            // Repo::project_name, on the TOML; a Project with no table has no defaults.
            let name = repo.get("project").and_then(Item::as_str).unwrap_or(&slug);
            if let Some(project) = written_projects.get(name).and_then(Item::as_table_like) {
                layer(repo, project);
            }
            layer(repo, repo_defaults.as_table());
        }
    }

    let mut config: Config = deserialize(file, &spanned, doc)?;
    for (slug, repo) in &mut config.repos {
        let mut own = DocumentMut::new();
        for (key, item) in written_repos[slug.as_str()]
            .as_table_like()
            .into_iter()
            .flat_map(|t| t.iter())
        {
            if !["path", "linear", "project", "install"].contains(&key) {
                own.insert(key, item.clone());
            }
        }
        repo.own = deserialize(file, &spanned, own)
            .unwrap_or_else(|_| unreachable!("read as a Repo just now"));
    }

    for (name, harness) in &config.harnesses {
        let (mode, needs, has) = match harness.launch_mode {
            LaunchMode::HerdrKind => ("herdr-kind", "kind", &harness.kind),
            LaunchMode::PaneCommand => ("pane-command", "command", &harness.command),
        };
        if has.is_none() {
            let problem = format!("a {mode} Harness needs {needs}");
            return Err(invalid(
                file,
                line_of(&["harnesses", name]),
                &format!("harnesses.{name}"),
                &problem,
            ));
        }
    }
    let not_a_harness = |keys: &[&str], harness: &str| {
        let keys = [keys, &["harness"]].concat();
        let problem = format!("`{harness}` is not a Harness");
        let mut refusal = invalid(file, line_of(&keys), &keys.join("."), &problem);
        let names: Vec<&str> = config.harnesses.keys().map(String::as_str).collect();
        refusal
            .help
            .push(format!("Harnesses: {}", names.join(", ")));
        refusal
    };
    // A Repo takes its other launches from its Project's, or the defaults'.
    let written = (config.projects.iter())
        .map(|(name, project)| (["projects", name.as_str()], project))
        .chain((config.repos.iter()).map(|(slug, repo)| (["repos", slug.as_str()], &repo.own)));
    for (keys, settings) in written {
        for (role, launch) in [
            ("implementer", &settings.implementer),
            ("reviewer", &settings.reviewer),
            ("quality_scan", &settings.quality_scan),
            ("faux_nico", &settings.faux_nico),
        ] {
            let Some(Launch { harness, .. }) = launch else {
                continue;
            };
            if !config.harnesses.contains_key(harness) {
                return Err(not_a_harness(&[keys[0], keys[1], role], harness));
            }
        }
    }
    if let Some(Launch { harness, .. }) = &config.morning.launch
        && !config.harnesses.contains_key(harness)
    {
        return Err(not_a_harness(&["morning", "launch"], harness));
    }
    if !config.harnesses.contains_key(&config.wiki.launch.harness) {
        return Err(not_a_harness(
            &["wiki", "launch"],
            &config.wiki.launch.harness,
        ));
    }
    Ok(config)
}

fn defaults(text: &str) -> DocumentMut {
    text.parse().expect("the defaults are valid TOML")
}

/// `doc` read as a `T`, a bad value refused naming its key and its line in `spanned`.
fn deserialize<T: DeserializeOwned>(
    file: &Path,
    spanned: &Document<&str>,
    doc: DocumentMut,
) -> Result<T, Refusal> {
    serde_path_to_error::deserialize(toml_edit::de::Deserializer::from(doc)).map_err(|e| {
        let keys: Vec<&str> = (e.path().iter())
            .map_while(|segment| match segment {
                Segment::Map { key } => Some(key.as_str()),
                _ => None,
            })
            .collect();
        let line = line_of(spanned, &keys);
        invalid(file, line, &e.path().to_string(), e.inner().message())
    })
}

/// Put each setting of `lower` that `repo` lacks into it: the switches one
/// by one, any other whole, a launch included.
fn layer(repo: &mut dyn TableLike, lower: &dyn TableLike) {
    for (key, setting) in lower.iter() {
        match (repo.get_mut(key), setting.as_table_like()) {
            (None, _) => {
                repo.insert(key, setting.clone());
            }
            (Some(switches), Some(lower)) if key == "switches" => {
                if let Some(switches) = switches.as_table_like_mut() {
                    fill(switches, lower);
                }
            }
            (Some(_), _) => {}
        }
    }
}

/// Put each key of `defaults` that `table` lacks into it, table by table; a
/// launch whole, as a default model is its default Harness's.
fn fill(table: &mut dyn TableLike, defaults: &dyn TableLike) {
    for (key, default) in defaults.iter() {
        match (table.get_mut(key), default.as_table_like()) {
            (None, _) => {
                table.insert(key, default.clone());
            }
            (Some(item), Some(defaults)) if key != "launch" => {
                if let Some(table) = item.as_table_like_mut() {
                    fill(table, defaults);
                }
            }
            (Some(_), _) => {}
        }
    }
}

/// The line of the deepest of `keys` the user's file holds.
fn line_of(doc: &Document<&str>, keys: &[&str]) -> Option<usize> {
    let mut item = doc.as_item();
    let mut span = None;
    for key in keys {
        let Some(next) = item.get(key) else { break };
        item = next;
        span = item.span().or(span);
    }
    span.map(|s| line(doc.raw(), s.start))
}

fn line(text: &str, offset: usize) -> usize {
    text[..offset].matches('\n').count() + 1
}

fn invalid(file: &Path, line: Option<usize>, key: &str, problem: &str) -> Refusal {
    let file = file.display();
    let place = line.map_or_else(|| file.to_string(), |n| format!("{file} line {n}"));
    let what = if key.is_empty() {
        problem.to_string()
    } else {
        format!("{key}: {problem}")
    };
    Refusal::new(
        format!("{place}: {what}"),
        vec![format!("Fix it in {file} and run the command again")],
    )
}

fn positive<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    std::num::NonZeroU32::deserialize(d).map(u32::from)
}

fn positive_port<'de, D: Deserializer<'de>>(d: D) -> Result<u16, D::Error> {
    std::num::NonZeroU16::deserialize(d).map(u16::from)
}

/// A GitHub repository's `<owner>/<name>`, neither a way out of its folder.
fn slug<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let slug = String::deserialize(d)?;
    if !repo::is_slug(&slug) || !plain(&slug) {
        return Err(serde::de::Error::invalid_value(
            serde::de::Unexpected::Str(&slug),
            &"a GitHub repository's owner/name",
        ));
    }
    Ok(slug)
}

/// A tag: no `:`, which a Library version's id ends it with, and no part
/// of it a way out of its folder.
fn tag<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let tag = String::deserialize(d)?;
    if tag.contains(':') || !plain(&tag) {
        return Err(serde::de::Error::invalid_value(
            serde::de::Unexpected::Str(&tag),
            &"a git tag",
        ));
    }
    Ok(tag)
}

/// A subfolder of a repository, from its root: `packages/effect`; null, none.
fn subfolder<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let Some(path) = Option::<String>::deserialize(d)? else {
        return Ok(None);
    };
    if !plain(&path) {
        return Err(serde::de::Error::invalid_value(
            serde::de::Unexpected::Str(&path),
            &"a folder's path from the repository's root, such as packages/effect",
        ));
    }
    Ok(Some(path))
}

/// Whether each `/`-part of `path` names something: none empty, `.` or `..`.
fn plain(path: &str) -> bool {
    path.split('/').all(|part| !["", ".", ".."].contains(&part))
}

fn hour<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let hour = u32::deserialize(d)?;
    if hour > 23 {
        let got = serde::de::Unexpected::Unsigned(hour.into());
        return Err(serde::de::Error::invalid_value(
            got,
            &"an hour from 0 to 23",
        ));
    }
    Ok(hour)
}
