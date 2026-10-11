//! `dispatch`: start an Implementer on a Ready issue through the steps claim,
//! fetch, worktree, tab, agent start, agent ready and prompt. Each is recorded
//! on the issue's Dispatch in `dispatches.json` as it completes, so the same
//! command continues a Dispatch from the step that failed.

use std::io;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::asking::Asking;
use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Harness, Launch, Repo, fill_in};
use crate::launch::{self, AgentLaunch};
use crate::restart::{self, Reason, Restart};
use crate::review::Reviewer;
use crate::source::{self, BlockerPr, Read, Start};
use crate::stage;
use crate::state;
use crate::verdict;
use crate::world::{self, PrState, READY_LABEL, World};

pub const FILE: &str = "dispatches.json";

/// A Dispatch's steps, in order.
pub const STEPS: [&str; 7] = [
    "claim",
    "fetch",
    "worktree",
    "tab",
    "agent start",
    "agent ready",
    "prompt",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Dispatch {
    /// `owner/repo#N` or a Linear identifier.
    pub issue: String,
    pub title: String,
    pub url: String,
    /// The Repo's slug.
    pub repo: String,
    /// The Repo's clone it was dispatched from, worked in after the Repo is removed.
    #[serde(default)]
    pub repo_path: String,
    pub branch: String,
    /// The branch the worktree starts from and the PR targets, without `origin/`.
    pub base: String,
    /// For a Stacked Dispatch, its Blocker's open PR, whose head branch was its Base.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stacked_on: Option<BlockerPr>,
    /// Set by the worktree step.
    pub worktree: Option<String>,
    pub workspace: Option<String>,
    /// The URL of its PR, once found on its branch; `prs.json` says what GitHub last said of it.
    pub pr: Option<String>,
    pub implementer: AgentLaunch,
    /// Set once a Reviewer is started on its PR.
    pub reviewer: Option<Reviewer>,
    pub research: bool,
    /// While its Implementer waits on the user.
    pub asking: Option<Asking>,
    /// The steps done, in order.
    pub completed: Vec<String>,
    /// The step that failed last, until it is done.
    pub failure: Option<Failure>,
    /// Whether the Claim assigned the issue to the user.
    pub claimed: bool,
    pub warnings: Vec<String>,
    /// Each restart of its Implementer, oldest first.
    #[serde(default)]
    pub restarts: Vec<Restart>,
    /// When herdr was first seen saying its Implementer is idle or done, with
    /// no PR, until it says otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle_since: Option<String>,
    /// Restarted to rebase (conflict or retarget) since its PR was last seen
    /// mergeable: a conflict meanwhile is not restarted for again.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rebasing: bool,
    /// The head its PR was flipped to ready at, by its passing Verdict.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flipped: Option<String>,
    /// The process running its steps, while one does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runner: Option<u32>,
    /// The boot its runner ran in: a pid from an earlier one is another process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner_boot: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Failure {
    pub step: String,
    pub error: String,
    /// The restart reason it failed on, when a restart failed or used it up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<Reason>,
}

/// The launch flags given; each unset one comes from the Repo's implementer launch.
#[derive(Debug, Clone, Copy, Default)]
pub struct Flags<'a> {
    pub harness: Option<&'a str>,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

/// Every Dispatch, live and Closed, oldest first.
pub fn load(config_dir: &Path) -> io::Result<Vec<Dispatch>> {
    state::load(&config_dir.join(FILE))
}

pub fn dispatch(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let args = Args::parse("dispatch", args, &["--harness", "--model", "--effort"])?;
    let refs = args.many("<issue>")?;
    let flags = Flags {
        harness: args.flag("--harness"),
        model: args.flag("--model"),
        effort: args.flag("--effort"),
    };
    let config = config::load(&ctx.config_dir)?;
    let dispatches = load(&ctx.config_dir)?;
    let keys = (refs.iter())
        .map(|text| key(&config, &dispatches, text))
        .collect::<Result<Vec<_>, _>>()?;
    // One at a time: issues of a Repo share its clone.
    let mut outcomes: Vec<_> = (keys.iter())
        .map(|key| (key, issue(ctx, &config, key, flags)))
        .collect();
    if outcomes.len() == 1 {
        return outcomes.remove(0).1;
    }
    let (mut dispatched, mut refused) = (vec![], vec![]);
    for (key, outcome) in outcomes {
        match outcome {
            Ok(answer) => dispatched.push(answer),
            Err(no) => refused.push((key, no)),
        }
    }
    if refused.is_empty() {
        return Ok(json!({ "dispatched": dispatched }));
    }
    let error = format!("{} of {} issues not dispatched", refused.len(), keys.len());
    let exit_code = refused
        .iter()
        .map(|(_, no)| no.exit_code)
        .max()
        .unwrap_or(1);
    let help = (refused.into_iter())
        .flat_map(|(key, no)| [format!("{key}: {}", no.error)].into_iter().chain(no.help))
        .collect();
    Err(Refusal {
        error,
        help,
        exit_code,
    })
}

/// Dispatch the issue `key` on the launch `flags` ask for, or continue its
/// failed Dispatch; one In flight with nothing left to do is a no-op.
pub fn issue(ctx: &Context, config: &Config, key: &str, flags: Flags) -> Result<Value, Refusal> {
    let live = load(&ctx.config_dir)?.into_iter().find(|d| is_live(d, key));
    if let Some(existing) = live {
        return pick_up(ctx, config, existing, flags);
    }
    let (slug, repo, read) = source_of(ctx, config, key)?;
    let launch = launch_of(config, repo, flags)?;
    if let Some(why) = source::why_not_ready(&read, key) {
        return Err(Refusal::new(
            format!("{key} is not Ready"),
            vec![
                why,
                "Run `nico-agent status` to see the Ready issues".into(),
            ],
        ));
    }
    let issue = read.issues.iter().find(|i| i.key == key).expect("Ready");
    let stacked_on = match source::start(issue) {
        Start::Stacked(pr) => Some(pr.clone()),
        _ => None,
    };
    let base = match (&stacked_on, &repo.base) {
        (Some(below), _) => below.head_branch.clone(),
        (None, Some(base)) => base.clone(),
        (None, None) => ctx.world.git_default_branch(&repo.path)?,
    };
    let now = state::iso(ctx.world.now());
    let record = Dispatch {
        issue: key.into(),
        title: issue.title.clone(),
        url: issue.url.clone(),
        repo: slug.clone(),
        repo_path: repo.path.clone(),
        branch: issue.branch.clone(),
        base,
        stacked_on,
        worktree: None,
        workspace: None,
        pr: None,
        implementer: AgentLaunch {
            agent: launch::agent_name("impl", slug, key),
            harness: launch.harness,
            model: launch.model,
            effort: launch.effort,
            tab: None,
            pane: None,
        },
        reviewer: None,
        research: issue.labels.iter().any(|l| l == "research"),
        asking: None,
        completed: vec![],
        failure: None,
        claimed: false,
        warnings: vec![],
        restarts: vec![],
        idle_since: None,
        rebasing: false,
        flipped: None,
        runner: Some(ctx.world.process_id()),
        runner_boot: Some(ctx.world.boot_id()),
        created_at: now.clone(),
        updated_at: now,
        closed_at: None,
    };
    // Recorded before any side effect, so a dispatch of the issue meanwhile finds it.
    let added = update(&ctx.config_dir, |all| {
        let free = !all.iter().any(|d| is_live(d, key));
        if free {
            all.push(record.clone());
        }
        free
    })?;
    if !added {
        return self::issue(ctx, config, key, flags);
    }
    run(ctx, config, repo, record, key.into())
}

/// Continue the Dispatch from its first step not done, unless another process
/// runs it or nothing is left: then a no-op.
fn pick_up(
    ctx: &Context,
    config: &Config,
    existing: Dispatch,
    flags: Flags,
) -> Result<Value, Refusal> {
    let key = &existing.issue;
    let had = &existing.implementer;
    let asked = [
        (flags.harness, Some(&had.harness)),
        (flags.model, had.model.as_ref()),
        (flags.effort, had.effort.as_ref()),
    ];
    if (asked.iter()).any(|(flag, had)| flag.is_some_and(|f| had.is_none_or(|h| h != f))) {
        let launch = [Some(&had.harness), had.model.as_ref(), had.effort.as_ref()];
        let launch: Vec<&str> = launch.into_iter().flatten().map(String::as_str).collect();
        return Err(Refusal::new(
            format!("{key} is already In flight with {}", launch.join(" ")),
            vec![SEE_STATUS.into()],
        ));
    }
    let repo = config.repo_of(&existing);
    if !config.harnesses.contains_key(&had.harness) {
        return Err(Refusal::new(
            format!(
                "{key} runs on {}, which is no longer a Harness",
                had.harness
            ),
            vec![format!("Add harnesses.{} back to config.toml", had.harness)],
        ));
    }
    let Some(leased) = lease(ctx, key)? else {
        let started = existing.completed.len() == STEPS.len();
        let agent = &existing.implementer.agent;
        if started && world::agent_state(&ctx.world.herdr_agents()?, agent).is_none() {
            return restart_by_hand(ctx, config, existing);
        }
        return answer(ctx, &existing, format!("{key} already In flight (no-op)"));
    };
    let step = leased.next_step().expect("a lease leaves steps to do");
    run(
        ctx,
        config,
        &repo,
        leased,
        format!("{key} (continued from {step})"),
    )
}

/// Restart the Implementer whose agent is gone, as the user: never counted
/// toward the cap, and a Failed Dispatch is given another go.
fn restart_by_hand(ctx: &Context, config: &Config, mut record: Dispatch) -> Result<Value, Refusal> {
    // shortcut: no lease, so a tick restarting the same agent meanwhile races this; lease restarts if that shows up.
    restart::restart(ctx, config, &mut record, Reason::Manual, "user")?.map_err(|mut no| {
        no.help.push(SEE_STATUS.into());
        no
    })?;
    answer(ctx, &record, format!("{} (restarted)", record.issue))
}

/// Run the steps `record` has not done, as the process holding its lease,
/// saving it after each; a failed one is kept on it.
fn run(
    ctx: &Context,
    config: &Config,
    repo: &Repo,
    mut record: Dispatch,
    said: String,
) -> Result<Value, Refusal> {
    let harness = &config.harnesses[&record.implementer.harness];
    // Known only when this run started the agent.
    let mut ready = false;
    for step in STEPS {
        if record.completed.iter().any(|done| done == step) {
            continue;
        }
        if let Err(no) = run_step(ctx, config, repo, harness, &mut record, step, &mut ready) {
            record.failure = Some(Failure {
                step: step.into(),
                error: no.error.clone(),
                reason: None,
            });
            (record.runner, record.runner_boot) = (None, None);
            save(ctx, &mut record)?;
            let mut help = no.help;
            help.push(SEE_STATUS.into());
            help.push(format!(
                "Run the same `nico-agent dispatch` again to continue from {step}"
            ));
            let error = format!("{} failed at {step}: {}", record.issue, no.error);
            return Err(Refusal::new(error, help));
        }
        record.completed.push(step.into());
        record.failure = None;
        save(ctx, &mut record)?;
    }
    (record.runner, record.runner_boot) = (None, None);
    save(ctx, &mut record)?;
    answer(ctx, &record, said)
}

fn run_step(
    ctx: &Context,
    config: &Config,
    repo: &Repo,
    harness: &Harness,
    record: &mut Dispatch,
    step: &str,
    ready: &mut bool,
) -> Result<(), Refusal> {
    let world = ctx.world;
    let made = "the worktree step made it";
    match step {
        "claim" => claim(ctx, record),
        "fetch" => {
            let below = record.stacked_on.as_ref();
            world.git_fetch(&repo.path, below.map(|pr| pr.head_branch.as_str()))?
        }
        "worktree" => {
            let base = format!("origin/{}", record.base);
            let made =
                world.herdr_worktree_create(&repo.path, &record.branch, &base, &label(record))?;
            record.worktree = Some(made.path);
            record.workspace = Some(made.workspace);
        }
        "tab" => {
            let (workspace, worktree) = (
                record.workspace.as_ref().expect(made),
                record.worktree.as_ref().expect(made),
            );
            launch::open_tab(
                world,
                &mut record.implementer,
                workspace,
                worktree,
                "implementer",
            )?;
        }
        "agent start" => *ready = launch::start(world, harness, &record.implementer, &repo.path)?,
        "agent ready" => {
            let worktree = record.worktree.as_ref().expect(made);
            launch::get_ready(world, harness, &record.implementer, worktree, *ready)?;
        }
        "prompt" => {
            let text = implement_prompt(ctx, config, harness, record);
            launch::prompt(world, &record.implementer.agent, &text)?;
        }
        _ => unreachable!("not a step: {step}"),
    }
    Ok(())
}

/// Assign the issue to the user; a failure is only a warning.
fn claim(ctx: &Context, record: &mut Dispatch) {
    let claimed = match source::github_ref(&record.issue) {
        Some((slug, number)) => ctx.world.github_assign_self(slug, number),
        None => ctx.world.linear_assign_self(&record.issue),
    };
    match claimed {
        Ok(()) => record.claimed = true,
        Err(e) => record.warnings.push(format!(
            "could not Claim {}: {e}; assign it to yourself by hand",
            record.issue
        )),
    }
}

/// The implement prompt, or research for a Research issue, with the bot
/// suffix when the GitHub App is installed on the Repo, asked each time.
fn implement_prompt(
    ctx: &Context,
    config: &Config,
    harness: &Harness,
    record: &mut Dispatch,
) -> String {
    let prompts = &config.prompts;
    let template = if record.research {
        &prompts.research
    } else {
        &prompts.implement
    };
    let values = [
        ("sigil", harness.sigil.as_str()),
        ("issueUrl", &record.url),
        ("baseBranch", &record.base),
    ];
    let text = fill_in(template, &values);
    match ctx.world.github_app_repos() {
        Ok(repos) if repos.iter().any(|r| r.eq_ignore_ascii_case(&record.repo)) => {
            text + &fill_in(&prompts.bot_suffix, &values)
        }
        Ok(_) => text,
        Err(e) => {
            record.warnings.push(format!(
                "could not check the GitHub App on {}, so the prompt has no bot suffix: {e}",
                record.repo
            ));
            text
        }
    }
}

const SEE_STATUS: &str = "Run `nico-agent status` to see the Dispatch";

/// What `dispatch` says of one issue.
fn answer(ctx: &Context, record: &Dispatch, said: String) -> Result<Value, Refusal> {
    let prs = stage::load(&ctx.config_dir)?;
    let pr = stage::pr_of(&prs, record).map(|(_, pr)| pr);
    let verdict = verdict::load(&ctx.config_dir, &record.issue)?;
    let mut answer = json!({
        "dispatched": said,
        "stage": stage::of(record, pr, verdict.as_ref()),
        "workspace": record.workspace,
        "agent": record.implementer.agent,
    });
    if !record.warnings.is_empty() {
        answer["warnings"] = json!(record.warnings);
    }
    Ok(answer)
}

/// The Dispatch key of an issue reference: `owner/repo#N` of a configured
/// Repo, in its casing, or of one of `dispatches` In flight; or a Linear identifier.
pub fn key(config: &Config, dispatches: &[Dispatch], text: &str) -> Result<String, Refusal> {
    let is_number = |n: &str| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit());
    if let Some((slug, number)) = text.rsplit_once('#')
        && slug.contains('/')
        && is_number(number)
    {
        let number: u64 = number.parse().map_err(|_| not_a_reference(text))?;
        let configured = config.repos.keys().find(|s| s.eq_ignore_ascii_case(slug));
        // Its Repo removed, an issue In flight there is still worked till Closed.
        let in_flight = (dispatches.iter())
            .find(|d| {
                d.closed_at.is_none() && d.issue.eq_ignore_ascii_case(&format!("{slug}#{number}"))
            })
            .map(|d| &d.issue);
        return match (configured, in_flight) {
            (Some(slug), _) => Ok(format!("{slug}#{number}")),
            (None, Some(issue)) => Ok(issue.clone()),
            (None, None) => Err(Refusal::new(
                format!("{slug} is not a configured Repo"),
                vec![format!(
                    "Run `nico-agent repo add {slug} --path <clone>` first"
                )],
            )),
        };
    }
    let linear = text.split_once('-').is_some_and(|(team, number)| {
        team.starts_with(|c: char| c.is_ascii_alphabetic())
            && team.chars().all(|c| c.is_ascii_alphanumeric())
            && is_number(number)
    });
    if linear {
        return Ok(text.to_uppercase());
    }
    Err(not_a_reference(text))
}

fn not_a_reference(text: &str) -> Refusal {
    Refusal {
        error: format!("`{text}` is not an issue reference"),
        help: vec!["Pass `owner/repo#N`, or a Linear identifier such as `BLE-12`".into()],
        exit_code: 2,
    }
}

/// The Repo an issue is dispatched into, with its Source read: a GitHub
/// issue's own; for a Linear one, the first Repo whose read has it.
fn source_of<'c>(
    ctx: &Context,
    config: &'c Config,
    key: &str,
) -> Result<(&'c String, &'c Repo, Read), Refusal> {
    let read = |slug: &str, repo: &Repo| match source::issues(
        ctx.world,
        &ctx.config_dir,
        slug,
        repo,
        config.tick(),
    )? {
        (Some(read), _) => Ok(read),
        (None, error) => Err(Refusal::new(
            format!(
                "could not read the issues of {slug}: {}",
                error.map(|e| e.0).unwrap_or_default()
            ),
            vec!["Run the same `nico-agent dispatch` again once the Source answers".into()],
        )),
    };
    if let Some((slug, _)) = source::github_ref(key) {
        let (slug, repo) = config
            .repos
            .get_key_value(slug)
            .expect("key() found its Repo");
        return Ok((slug, repo, read(slug, repo)?));
    }
    // shortcut: a Linear issue two Repos claim goes to the first; add `--repo` if that happens.
    for (slug, repo) in config.repos.iter().filter(|(_, r)| r.linear.is_some()) {
        let read = read(slug, repo)?;
        if read.issues.iter().any(|i| i.key == key) {
            return Ok((slug, repo, read));
        }
    }
    Err(Refusal::new(
        format!("{key} is not Ready"),
        vec![
            format!(
                "{key} is not an unstarted issue labelled {READY_LABEL} that a Repo's Linear selector claims"
            ),
            "Run `nico-agent status` to see the Ready issues".into(),
        ],
    ))
}

/// The launch `flags` ask for, each one unset taken from the Repo's
/// implementer launch when on its Harness; refused unless the Harness takes it.
fn launch_of(config: &Config, repo: &Repo, flags: Flags) -> Result<Launch, Refusal> {
    let default = &repo.implementer;
    let name = flags.harness.unwrap_or(&default.harness);
    let own = name == default.harness;
    let pick = |flag: Option<&str>, default: &Option<String>| {
        flag.map(String::from)
            .or_else(|| default.clone().filter(|_| own))
    };
    let launch = Launch {
        harness: name.into(),
        model: pick(flags.model, &default.model),
        effort: pick(flags.effort, &default.effort),
    };
    let bad = |error: String, help: String| Refusal {
        error,
        help: vec![help],
        exit_code: 2,
    };
    let Some(harness) = config.harnesses.get(name) else {
        let names: Vec<&str> = config.harnesses.keys().map(String::as_str).collect();
        return Err(bad(
            format!("unknown Harness `{name}`"),
            format!("Valid Harnesses: {}", names.join(", ")),
        ));
    };
    let choices = [
        ("model", &launch.model, &harness.models),
        ("Effort", &launch.effort, &harness.efforts),
    ];
    for (what, chosen, valid) in choices {
        if let (Some(chosen), Some(valid)) = (chosen, valid)
            && !valid.contains(chosen)
        {
            return Err(bad(
                format!("unknown {what} `{chosen}` for {name}"),
                format!("Valid {what}s for {name}: {}", valid.join(", ")),
            ));
        }
    }
    Ok(launch)
}

/// Its workspace's label: `<repo name>#<n>`, or `<repo name>:<BLE-12>` for Linear.
fn label(record: &Dispatch) -> String {
    let name = record
        .repo
        .split_once('/')
        .map_or(&*record.repo, |(_, name)| name);
    match source::github_ref(&record.issue) {
        Some((_, number)) => format!("{name}#{number}"),
        None => format!("{name}:{}", record.issue),
    }
}

pub fn is_live(dispatch: &Dispatch, key: &str) -> bool {
    dispatch.issue == key && dispatch.closed_at.is_none()
}

impl Dispatch {
    /// Its first step not done, while one is left.
    pub fn next_step(&self) -> Option<&'static str> {
        (STEPS.into_iter()).find(|s| !self.completed.iter().any(|c| c == s))
    }

    /// Whether a live process runs its steps: its runner, in this boot.
    pub fn running(&self, world: &dyn World) -> bool {
        self.runner.is_some_and(|pid| world.process_alive(pid))
            && self.runner_boot.as_deref() == Some(&world.boot_id())
    }
}

/// Take over the live Dispatch of `key` to run its steps, when steps are left
/// and no live process runs them.
fn lease(ctx: &Context, key: &str) -> io::Result<Option<Dispatch>> {
    update(&ctx.config_dir, |all| {
        let dispatch = all.iter_mut().find(|d| is_live(d, key))?;
        if dispatch.running(ctx.world) || dispatch.next_step().is_none() {
            return None;
        }
        dispatch.runner = Some(ctx.world.process_id());
        dispatch.runner_boot = Some(ctx.world.boot_id());
        Some(dispatch.clone())
    })
}

/// Save `record` over the live Dispatch of its issue, stamped now.
pub fn save(ctx: &Context, record: &mut Dispatch) -> io::Result<()> {
    record.updated_at = state::iso(ctx.world.now());
    update(&ctx.config_dir, |all| {
        if let Some(saved) = all.iter_mut().find(|d| is_live(d, &record.issue)) {
            *saved = record.clone();
        }
    })
}

/// Close every live Dispatch whose PR is final: remove its worktree and
/// close its workspace, keeping the record, the branch and the PR. One that
/// fails stays live and is tried again next time. Says what it did.
pub fn close_final(ctx: &Context) -> io::Result<Vec<String>> {
    let prs = stage::load(&ctx.config_dir)?;
    let mut said = vec![];
    for d in load(&ctx.config_dir)?
        .into_iter()
        .filter(|d| d.closed_at.is_none())
    {
        let Some((url, pr)) = stage::pr_of(&prs, &d).filter(|(_, pr)| pr.r#final) else {
            continue;
        };
        let freed = d.workspace.as_ref().map_or(Ok(()), |workspace| {
            (ctx.world.herdr_worktree_remove(workspace))
                .and_then(|()| ctx.world.herdr_workspace_close(workspace))
        });
        if let Err(e) = freed {
            said.push(format!("could not Close {}: {e}", d.issue));
            continue;
        }
        let now = state::iso(ctx.world.now());
        update(&ctx.config_dir, |all| {
            if let Some(live) = all.iter_mut().find(|live| is_live(live, &d.issue)) {
                live.closed_at = Some(now.clone());
                live.asking = None;
                live.updated_at = now.clone();
            }
        })?;
        let state = match pr.state {
            PrState::Merged => "merged",
            _ => "closed",
        };
        said.push(format!("{} Closed: its PR {url} {state}", d.issue));
    }
    let oldest = state::iso(ctx.world.now() - KEEP_CLOSED);
    update(&ctx.config_dir, |all| {
        all.retain(|d| d.closed_at.as_ref().is_none_or(|at| *at >= oldest))
    })?;
    Ok(said)
}

/// How long a Closed Dispatch is kept.
const KEEP_CLOSED: Duration = Duration::from_secs(30 * 86_400);

/// Make `url` the PR of the live Dispatch of `issue`.
pub fn link_pr(config_dir: &Path, issue: &str, url: &str) -> io::Result<()> {
    update(config_dir, |all| {
        if let Some(live) = all.iter_mut().find(|d| is_live(d, issue)) {
            live.pr = Some(url.into());
        }
    })
}

/// Change the Dispatches under the file's lock.
pub fn update<T>(config_dir: &Path, change: impl FnOnce(&mut Vec<Dispatch>) -> T) -> io::Result<T> {
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut all = state::parse(&file, text)?;
        let out = change(&mut all);
        Ok((state::text(&all), out))
    })
}
