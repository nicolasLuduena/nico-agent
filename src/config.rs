//! `config.toml` in the config directory: the Repos, Harnesses, prompt
//! templates and loop settings, edited by hand and by `repo` commands. It is
//! read with every default filled in, and a bad value is refused naming its
//! key and line.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Deserializer, Serialize};
use serde_path_to_error::Segment;
use toml_edit::{Document, DocumentMut, Item, TableLike};

use crate::cli::Refusal;
use crate::dispatch::Dispatch;
use crate::state;

pub const FILE: &str = "config.toml";

/// What a config leaves out, filled in under it before it is read.
const DEFAULTS: &str = r#"
tick_minutes = 10
stall_minutes = 20
max_restarts_per_reason = 2
repos = {}

[prompts]
implement = "{sigil}implement {issueUrl} as draft PR against {baseBranch}"
research = "{sigil}research {issueUrl}; write the findings with sources to one Markdown file under docs/research/ and open it as a draft PR against {baseBranch}"
review = "{sigil}verdict {prUrl} for {issueUrl}: re-run the repo's verification skill under .agents/skills/verify-*/ against the PR's head, and record the result with nico-agent verdict {issue} pass|fail --sha {headSha} --findings <file>"
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

[harnesses.codex]
launch_mode = "herdr-kind"
kind = "codex"
sigil = "$"
model_args = ["-m", "{model}"]
effort_args = ["-c", "model_reasoning_effort={effort}"]
# codex asks to trust the clone (not the worktree) even when herdr reports it
# ready; this answers it for the session without writing ~/.codex/config.toml.
trust_args = ["-c", 'projects={"{repoPath}"={trust_level="trusted"}}']

# Its TUI takes no model or Effort flag: the model goes in
# OPENCODE_CONFIG_CONTENT and the Effort in its variant file.
[harnesses.opencode]
launch_mode = "pane-command"
command = "opencode2"
variant_file = "~/.local/state/opencode/model.json"
sigil = "@"
model_args = []
effort_args = []
"#;

/// What a Repo leaves out, filled in under each `repos.<slug>`.
const REPO_DEFAULTS: &str = r#"
room = 3
implementer = { harness = "claude" }
switches = { dispatch = true, stack = true, review = true, restart = true, flip = true, answer = false, gardening = false, quality_scan = false }
"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// By slug, as first added.
    pub repos: BTreeMap<String, Repo>,
    /// The built-in ones (claude, codex, opencode) under the config's settings.
    pub harnesses: BTreeMap<String, Harness>,
    pub prompts: Prompts,
    #[serde(deserialize_with = "positive")]
    pub tick_minutes: u32,
    #[serde(deserialize_with = "positive")]
    pub stall_minutes: u32,
    #[serde(deserialize_with = "positive")]
    pub max_restarts_per_reason: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Repo {
    pub path: String,
    pub linear: Option<Linear>,
    #[serde(deserialize_with = "positive")]
    pub room: u32,
    /// The Base a Dispatch starts from unless stacked; origin's default branch when unset.
    pub base: Option<String>,
    pub implementer: Launch,
    /// As set; [`Config::reviewer`] fills in the default.
    pub reviewer: Option<Launch>,
    pub switches: Switches,
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
    pub review: String,
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
    let repo_defaults = defaults(REPO_DEFAULTS);
    if let Some(repos) = doc.get_mut("repos").and_then(Item::as_table_like_mut) {
        for (_, repo) in repos.iter_mut() {
            if let Some(repo) = repo.as_table_like_mut() {
                fill(repo, repo_defaults.as_table());
            }
        }
    }
    let line_of = |keys: &[&str]| line_of(&spanned, keys);

    let config: Config = serde_path_to_error::deserialize(toml_edit::de::Deserializer::from(doc))
        .map_err(|e| {
        let keys: Vec<&str> = e
            .path()
            .iter()
            .map_while(|segment| match segment {
                Segment::Map { key } => Some(key.as_str()),
                _ => None,
            })
            .collect();
        invalid(
            file,
            line_of(&keys),
            &e.path().to_string(),
            e.inner().message(),
        )
    })?;

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
    for (slug, repo) in &config.repos {
        for (role, launch) in [
            ("implementer", Some(&repo.implementer)),
            ("reviewer", repo.reviewer.as_ref()),
        ] {
            let Some(Launch { harness, .. }) = launch else {
                continue;
            };
            if !config.harnesses.contains_key(harness) {
                let key = format!("repos.{slug}.{role}.harness");
                let mut refusal = invalid(
                    file,
                    line_of(&["repos", slug, role, "harness"]),
                    &key,
                    &format!("`{harness}` is not a Harness"),
                );
                let names: Vec<&str> = config.harnesses.keys().map(String::as_str).collect();
                refusal
                    .help
                    .push(format!("Harnesses: {}", names.join(", ")));
                return Err(refusal);
            }
        }
    }
    Ok(config)
}

fn defaults(text: &str) -> DocumentMut {
    text.parse().expect("the defaults are valid TOML")
}

/// Put each key of `defaults` that `table` lacks into it, table by table.
fn fill(table: &mut dyn TableLike, defaults: &dyn TableLike) {
    for (key, default) in defaults.iter() {
        match (table.get_mut(key), default.as_table_like()) {
            (None, _) => {
                table.insert(key, default.clone());
            }
            (Some(item), Some(defaults)) => {
                if let Some(table) = item.as_table_like_mut() {
                    fill(table, defaults);
                }
            }
            (Some(_), None) => {}
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
