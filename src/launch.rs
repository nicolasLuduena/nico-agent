//! Starting an agent in a new herdr tab of a Dispatch's workspace, up to the
//! prompt it works on: the steps tab, agent start, agent ready and prompt,
//! for an Implementer as for a Reviewer or a restart.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::cli::Refusal;
use crate::config::{Harness, LaunchMode, fill_in};
use crate::world::{World, WorldResult};

/// How long herdr may take to see a pane-command agent, or an agent to settle
/// once its trust question is answered.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// How long an agent past its startup questions may take to settle.
const SETTLE_TIMEOUT: Duration = Duration::from_secs(5);

/// A Harness still drawing its UI drops a prompt without an error, so it is sent again.
const PROMPT_ATTEMPTS: usize = 3;

/// herdr's limit on an agent name, `[a-z][a-z0-9_-]{0,31}`.
const MAX_AGENT_NAME: usize = 32;

/// An agent as its Dispatch keeps it: its herdr name and place, and what it runs on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLaunch {
    pub agent: String,
    pub harness: String,
    /// The Harness's own default when unset.
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Set once its tab is open.
    pub tab: Option<String>,
    pub pane: Option<String>,
}

/// `<role>-<repo name>-<n>` for issue `owner/repo#n`, `-<ble-12>` for Linear's
/// `BLE-12`: within herdr's limit, the Repo's name cut to keep the issue's part.
pub fn agent_name(role: &str, slug: &str, issue: &str) -> String {
    let issue = issue.rsplit_once('#').map_or(issue, |(_, number)| number);
    let suffix = format!("-{}", issue.to_lowercase());
    let room = MAX_AGENT_NAME.saturating_sub(role.len() + 1 + suffix.len());
    let name = slug.split_once('/').map_or(slug, |(_, name)| name);
    let repo: String = (name.to_lowercase().chars())
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '_' | '-' => c,
            _ => '-',
        })
        .take(room)
        .collect();
    let mut full = format!("{role}-{repo}{suffix}");
    full.truncate(MAX_AGENT_NAME);
    full
}

/// Open the agent's tab, labelled `label`, in `workspace`, working in `cwd`.
pub fn open_tab(
    world: &dyn World,
    launch: &mut AgentLaunch,
    workspace: &str,
    cwd: &str,
    label: &str,
) -> WorldResult<()> {
    let tab = world.herdr_tab_create(workspace, cwd, label)?;
    launch.tab = Some(tab.tab);
    launch.pane = Some(tab.pane);
    Ok(())
}

/// Start the Harness in the agent's pane, trusting `repo_path` (the clone):
/// whether herdr found it ready for its prompt.
pub fn start(
    world: &dyn World,
    harness: &Harness,
    launch: &AgentLaunch,
    repo_path: &str,
) -> WorldResult<bool> {
    let pane = launch
        .pane
        .as_deref()
        .expect("the tab step opened its pane");
    let args = args(harness, launch, repo_path);
    match harness.launch_mode {
        LaunchMode::HerdrKind => {
            let kind = harness.kind.as_deref().expect("config requires a kind");
            world.herdr_agent_start(&launch.agent, kind, pane, &args)
        }
        LaunchMode::PaneCommand => {
            if let (Some(file), Some(model)) = (&harness.variant_file, &launch.model) {
                world.opencode_save_variant(file, model, launch.effort.as_deref())?;
            }
            world.herdr_pane_run(pane, &pane_command(harness, launch, &args))?;
            Ok(false)
        }
    }
}

/// Get a started agent ready for its prompt. A pane-command one is named once
/// herdr sees it. One not `ready` is answered yes when it asks only its
/// Harness's trust question for `cwd`, the worktree nico-agent made; any
/// other question is the user's.
pub fn get_ready(
    world: &dyn World,
    harness: &Harness,
    launch: &AgentLaunch,
    cwd: &str,
    ready: bool,
) -> Result<(), Refusal> {
    let agent = &launch.agent;
    if harness.launch_mode == LaunchMode::PaneCommand {
        let pane = launch
            .pane
            .as_deref()
            .expect("the tab step opened its pane");
        world.herdr_agent_detect(pane, STARTUP_TIMEOUT)?;
        world.herdr_agent_rename(pane, agent)?;
    }
    if ready {
        return Ok(());
    }
    let settled = ["idle".to_string(), "done".to_string()];
    let screen = world.herdr_agent_read(agent)?;
    // Long paths wrap in the pane.
    let flat = |text: &str| text.split_whitespace().collect::<String>();
    if let Some(trust) = &harness.trust_prompt
        && screen.contains(&trust.text)
        && flat(&screen).contains(&flat(cwd))
    {
        world.herdr_agent_send_keys(agent, &trust.keys)?;
        return Ok(world.herdr_agent_wait(agent, &settled, STARTUP_TIMEOUT)?);
    }
    world
        .herdr_agent_wait(agent, &settled, SETTLE_TIMEOUT)
        .map_err(|_| {
            Refusal::new(
                format!("{agent} is blocked during startup"),
                vec![format!(
                    "Run `herdr agent read {agent}` to see what it is asking, and answer it in herdr"
                )],
            )
        })
}

/// Prompt the agent until it starts working on `text`.
pub fn prompt(world: &dyn World, agent: &str, text: &str) -> Result<(), Refusal> {
    for _ in 0..PROMPT_ATTEMPTS {
        if world.herdr_agent_prompt(agent, text)? {
            return Ok(());
        }
    }
    Err(Refusal::new(
        format!("{agent} did not start working on its prompt"),
        vec![format!(
            "Run `herdr agent read {agent}` to see its screen, and send the prompt by hand"
        )],
    ))
}

/// The model and Effort arguments of those set, then the trust and extra ones, filled in.
fn args(harness: &Harness, launch: &AgentLaunch, repo_path: &str) -> Vec<String> {
    let (model, effort) = (&launch.model, &launch.effort);
    let values = [
        ("model", model.as_deref().unwrap_or_default()),
        ("effort", effort.as_deref().unwrap_or_default()),
        ("repoPath", repo_path),
    ];
    let set = |args: &[String], is_set: bool| if is_set { args.to_vec() } else { vec![] };
    [
        set(&harness.model_args, model.is_some()),
        set(&harness.effort_args, effort.is_some()),
        harness.trust_args.clone(),
        harness.extra_args.clone(),
    ]
    .concat()
    .iter()
    .map(|arg| fill_in(arg, &values))
    .collect()
}

/// opencode's command line, as on `main`: the model with the Effort as its
/// variant in `OPENCODE_CONFIG_CONTENT`, for the build agent too (which keeps
/// its own otherwise), then its own private server and `args`.
fn pane_command(harness: &Harness, launch: &AgentLaunch, args: &[String]) -> String {
    let command = harness
        .command
        .as_deref()
        .expect("config requires a command");
    let mut words: Vec<String> = [command, "--standalone"]
        .into_iter()
        .chain(args.iter().map(String::as_str))
        .map(shell_word)
        .collect();
    if let Some(model) = &launch.model {
        let model = launch
            .effort
            .as_ref()
            .map_or(model.clone(), |effort| format!("{model}#{effort}"));
        let config = json!({ "model": model, "agents": { "build": { "model": model } } });
        words.insert(
            0,
            format!(
                "env OPENCODE_CONFIG_CONTENT={}",
                shell_word(&config.to_string())
            ),
        );
    }
    words.join(" ")
}

/// `word` as one POSIX shell word: as is when plain, else single-quoted.
fn shell_word(word: &str) -> String {
    let plain = !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c));
    if plain {
        word.into()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}
