//! A Repo's Source read into `issues/<repo>.json`, one issue shape for GitHub
//! and Linear, and what of it is Ready or Stackable.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Linear, Repo};
use crate::dispatch::Dispatch;
use crate::install::{self, Install};
use crate::pause;
use crate::stage::{self, Prs};
use crate::state;
use crate::world::{
    GitHubIssue, IssueState, LinearIssue, PrState, PullRequest, READY_LABEL, World, WorldError,
    WorldResult,
};

/// What a Repo's Source last said, and when.
#[derive(Debug, Serialize, Deserialize)]
pub struct Read {
    pub read_at: String,
    /// The user on each Source read: a GitHub login, a Linear user id.
    pub user: Vec<String>,
    pub issues: Vec<Issue>,
    /// The Repo's slug while its `mine` Switch is on, as [`settle`] reads the
    /// config: then an issue assigned to no one is not Ready.
    #[serde(skip)]
    pub mine: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Issue {
    /// `owner/repo#N` or a Linear identifier.
    pub key: String,
    pub title: String,
    pub url: String,
    /// The branch its Dispatch works on.
    pub branch: String,
    pub created_at: String,
    pub open: bool,
    pub labels: Vec<String>,
    /// A GitHub login or a Linear user id each, as compared with the user.
    pub assignees: Vec<String>,
    /// Each assignee's name where it is not its id: a Linear display name.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assignee_names: Vec<String>,
    pub has_sub_issues: bool,
    pub blockers: Vec<Blocker>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Blocker {
    pub key: String,
    /// Unknown in a cache read before Blockers had titles.
    #[serde(default)]
    pub title: Option<String>,
    /// Closed, as cached; as loaded, also installed when it is in another
    /// Repo of the Project with an Install (see [`settle`]).
    pub resolved: bool,
    /// When it closed, as its Source says; unknown in a cache read before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    /// Closed, the Repo of the Project whose Install it waits on.
    #[serde(skip)]
    pub installing: Option<String>,
    /// Its open PRs in this Repo with a head branch here, asked only while it
    /// is unresolved and blocks an issue the loop could start; none for one
    /// in another Repo of the Project.
    pub prs: Vec<BlockerPr>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockerPr {
    pub number: u64,
    pub url: String,
    pub head_branch: String,
}

/// Who an issue is assigned to, as the Board shows it.
#[derive(Debug, Serialize)]
pub struct Assignee {
    pub name: String,
    /// Whether it is the user.
    pub you: bool,
}

/// An issue the loop may start, as `status` lists it.
#[derive(Debug, Serialize)]
pub struct Row {
    pub key: String,
    pub title: String,
    pub url: String,
    /// `code`, or `research` for a Research issue.
    pub kind: &'static str,
    pub assignees: Vec<Assignee>,
    /// For a Stackable issue, the branch its Dispatch starts from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// For an issue that waits, why.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Default)]
pub struct Readiness {
    pub ready: Vec<Row>,
    pub stackable: Vec<Row>,
    /// Ready Gardening issues, kept out of `ready`.
    pub gardening: Vec<Row>,
    /// Waiting on its Blockers to close or be installed, or Stackable but
    /// for their open PRs sitting on several branches or its being a
    /// Gardening issue, or still open though its last Dispatch's PR merged or
    /// was closed unmerged.
    pub waiting: Vec<Row>,
}

/// The branch a GitHub issue's Dispatch works on.
pub fn github_branch(slug: &str, number: u64) -> String {
    let name = slug.split_once('/').map_or(slug, |(_, name)| name);
    format!("agent/{name}-{number}")
}

/// The issues of the Repo `slug`, [`settle`]d: its cache while younger than
/// `max_age`, else read from the Source and cached. A failed read, or one a
/// rate limit pauses, keeps the cache, and says why.
pub fn issues(
    world: &dyn World,
    config_dir: &Path,
    config: &Config,
    slug: &str,
    max_age: Duration,
) -> io::Result<(Option<Read>, Option<WorldError>)> {
    let (read, error) = fresh(world, config_dir, slug, &config.repos[slug], max_age)?;
    Ok((settled(read, config_dir, config, slug)?, error))
}

/// What the Repo `slug`'s Source last said, however old, [`settle`]d.
pub fn cached(config_dir: &Path, config: &Config, slug: &str) -> io::Result<Option<Read>> {
    settled(cache(config_dir, slug), config_dir, config, slug)
}

fn settled(
    read: Option<Read>,
    config_dir: &Path,
    config: &Config,
    slug: &str,
) -> io::Result<Option<Read>> {
    let installs = install::load(config_dir)?;
    Ok(read.map(|mut read| {
        settle(&mut read, config, slug, &installs);
        read
    }))
}

/// Hold each closed Blocker of `read`, the Repo `slug`'s, that is in another
/// Repo of its Project with an Install, until that Repo's last Install ran ok
/// at or after the close. None in another Repo is stacked on.
fn settle(read: &mut Read, config: &Config, slug: &str, installs: &BTreeMap<String, Install>) {
    read.mine = config.repos[slug].switches.mine.then(|| slug.to_string());
    for blocker in read.issues.iter_mut().flat_map(|i| &mut i.blockers) {
        let Some(other) = repo_in(config, slug, &blocker.key).filter(|s| *s != slug) else {
            continue;
        };
        blocker.prs.clear();
        let last = installs.get(other).and_then(|i| i.last.as_ref());
        let installed = last.is_some_and(|l| l.ok && Some(&l.at) >= blocker.closed_at.as_ref());
        if blocker.resolved && config.repos[other].install.is_some() && !installed {
            blocker.resolved = false;
            blocker.installing = Some(other.clone());
        }
    }
}

/// The Repo of the Project of `slug`, `slug` first, that the issue `key` is
/// in: a GitHub one by its slug, a Linear one by its identifier's team key
/// against the Repos' `linear.team`.
pub fn repo_in<'c>(config: &'c Config, slug: &str, key: &str) -> Option<&'c String> {
    let (own, repo) = config.repos.get_key_value(slug)?;
    let project = repo.project_name(own);
    let others = (config.repos.iter()).filter(|(s, r)| *s != own && r.project_name(s) == project);
    let mut repos = std::iter::once((own, repo)).chain(others);
    let (found, _) = match github_ref(key) {
        Some((of, _)) => repos.find(|(s, _)| s.eq_ignore_ascii_case(of)),
        None => {
            // shortcut: a Repo whose `linear.team` is the team's name or id places
            // none; match those too once a Repo is set so.
            let (team, _) = key.rsplit_once('-')?;
            repos.find(|(_, r)| r.linear.as_ref().is_some_and(|l| l.team == team))
        }
    }?;
    Some(found)
}

fn fresh(
    world: &dyn World,
    config_dir: &Path,
    slug: &str,
    repo: &Repo,
    max_age: Duration,
) -> io::Result<(Option<Read>, Option<WorldError>)> {
    let file = config_dir.join("issues").join(format!("{slug}.json"));
    let cached = cache(config_dir, slug);
    let oldest = state::iso(world.now() - max_age);
    if cached.as_ref().is_some_and(|c| c.read_at > oldest) {
        return Ok((cached, None));
    }
    // A read needs each of its Sources: none is asked while one is paused.
    let linear = repo.linear.as_ref().map(|_| "Linear");
    for source in ["GitHub"].into_iter().chain(linear) {
        if let Some(paused) = pause::of(world, config_dir, source)? {
            return Ok((cached, Some(paused)));
        }
    }
    match read(world, slug, repo) {
        Err(e) => Ok((cached, Some(e))),
        Ok(read) => {
            state::update(&file, |_| Ok::<_, io::Error>((state::text(&read), ())))?;
            Ok((Some(read), None))
        }
    }
}

fn cache(config_dir: &Path, slug: &str) -> Option<Read> {
    let file = config_dir.join("issues").join(format!("{slug}.json"));
    // A cache that doesn't parse is no cache: the Source is the truth.
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

/// `POST /api/assign {issue}`: assign the issue `key`, as a Repo's kept read
/// holds it, to the user on its Source, unless it is someone else's; then
/// keep the user among its assignees in that read, so the Board shows it
/// before the next read. A refusal changes nothing here.
pub fn assign(ctx: &Context, key: &str) -> Result<Value, Refusal> {
    let config = config::load(&ctx.config_dir)?;
    let found = (config.repos.keys()).find_map(|slug| {
        let read = cache(&ctx.config_dir, slug)?;
        let at = read.issues.iter().position(|i| i.key == key)?;
        Some((slug, read, at))
    });
    let Some((slug, read, at)) = found else {
        return Err(Refusal::new(
            format!("{key} is in no Repo's last read of its Source"),
            vec!["Assign an issue the map shows, or Refresh to read the Sources again".into()],
        ));
    };
    if let Some(theirs) = why_not_yours(&read.issues[at], &read.user, None) {
        // Linear's assign replaces the assignee: taking an issue is the user's call.
        return Err(Refusal::new(
            theirs,
            vec!["Take it from them on GitHub or Linear: nico-agent assigns you only an issue no one has".into()],
        ));
    }
    // The user each Source read: GitHub's first, then Linear's.
    let (asked, user) = match github_ref(key) {
        Some((repo, number)) => (ctx.world.github_assign_self(repo, number), &read.user[0]),
        None => (
            ctx.world.linear_assign_self(key),
            read.user.last().expect("a read of Linear asked its viewer"),
        ),
    };
    asked.map_err(|e| {
        Refusal::new(
            format!("could not assign {key} to you: {}", e.0),
            vec!["Assign it to yourself on GitHub or Linear, or try again once it answers".into()],
        )
    })?;
    let file = ctx.config_dir.join("issues").join(format!("{slug}.json"));
    state::update(&file, |text| {
        let mut read: Read = serde_json::from_str(text).map_err(io::Error::other)?;
        if let Some(issue) = read.issues.iter_mut().find(|i| i.key == key)
            && !issue.assignees.contains(user)
        {
            issue.assignees.push(user.clone());
        }
        Ok::<_, io::Error>((state::text(&read), ()))
    })?;
    Ok(json!({ "assigned": key }))
}

fn read(world: &dyn World, slug: &str, repo: &Repo) -> WorldResult<Read> {
    let read_at = state::iso(world.now());
    let mut user = vec![world.github_viewer()?];
    let mut issues: Vec<Issue> = world
        .github_issues(slug)?
        .iter()
        .map(|i| from_github(slug, i))
        .collect();
    if let Some(selector) = &repo.linear {
        user.push(world.linear_viewer()?);
        let team = world.linear_issues(&selector.team)?;
        issues.extend(team.iter().filter(|i| claims(selector, i)).map(from_linear));
    }
    let mut asked: HashMap<String, Vec<BlockerPr>> = HashMap::new();
    // `mine` aside, so turning it off needs no new read.
    for issue in issues.iter_mut().filter(|i| can_start(i, &user, None)) {
        for blocker in issue.blockers.iter_mut().filter(|b| !b.resolved) {
            if !asked.contains_key(&blocker.key) {
                asked.insert(blocker.key.clone(), open_prs(world, slug, &blocker.key)?);
            }
            blocker.prs = asked[&blocker.key].clone();
        }
    }
    Ok(Read {
        read_at,
        user,
        issues,
        mine: None,
    })
}

/// The open PRs in `repo` a Blocker's work could be stacked on: for GitHub,
/// those that close it and those from its Dispatch branch; for Linear, its
/// PR attachments. A fork's head isn't here.
fn open_prs(world: &dyn World, repo: &str, key: &str) -> WorldResult<Vec<BlockerPr>> {
    let mut prs = vec![];
    if let Some((slug, number)) = github_ref(key) {
        prs = world.github_linked_pull_requests(slug, number)?;
        prs.extend(world.github_branch_pull_requests(repo, &github_branch(slug, number))?);
    } else {
        for url in world.linear_attachment_urls(key)? {
            if let Some(number) = pr_number(&url, repo) {
                prs.extend(world.github_pull_request(repo, number)?);
            }
        }
    }
    let mut open: Vec<BlockerPr> = vec![];
    for pr in prs {
        let PullRequest {
            number,
            url,
            state: PrState::Open,
            head_branch: Some(head_branch),
            ..
        } = pr
        else {
            continue;
        };
        if pr.repo.eq_ignore_ascii_case(repo) && !open.iter().any(|o| o.url == url) {
            open.push(BlockerPr {
                number,
                url,
                head_branch,
            });
        }
    }
    Ok(open)
}

/// Which of `read`'s issues with no live Dispatch the loop may start, oldest first.
pub fn readiness(read: &Read, dispatches: &[Dispatch], prs: &Prs) -> Readiness {
    // Oldest first, so each issue's last Dispatch wins.
    let last: HashMap<&str, &Dispatch> =
        (dispatches.iter()).map(|d| (d.issue.as_str(), d)).collect();
    let mut issues: Vec<&Issue> = read
        .issues
        .iter()
        .filter(|i| {
            can_start(i, &read.user, read.mine.as_deref())
                && (last.get(i.key.as_str())).is_none_or(|d| d.closed_at.is_some())
        })
        .collect();
    issues.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let mut readiness = Readiness::default();
    for issue in issues {
        let kind = if issue.labels.iter().any(|l| l == "research") {
            "research"
        } else {
            "code"
        };
        let row = Row {
            key: issue.key.clone(),
            title: issue.title.clone(),
            url: issue.url.clone(),
            kind,
            assignees: assignees(issue, &read.user),
            base: None,
            reason: None,
        };
        let ended = (last.get(issue.key.as_str()))
            .and_then(|d| stage::pr_of(prs, d))
            .map(|(url, pr)| (url, pr.state));
        let key = &issue.key;
        let held = match ended {
            Some((url, PrState::Merged)) => Some(format!(
                "{key} is still open though its PR {url} merged; close it, or dispatch it by hand to work it again"
            )),
            // Rejected by the user: not worked again overnight on the same branch.
            Some((url, PrState::Closed)) => Some(format!(
                "{key}'s PR {url} was closed unmerged; dispatch it by hand to work it again"
            )),
            _ => None,
        };
        if let Some(reason) = held {
            readiness.waiting.push(Row {
                reason: Some(reason),
                ..row
            });
            continue;
        }
        let gardening = issue.labels.iter().any(|l| l == "gardening");
        match start(issue) {
            Start::Ready if gardening => readiness.gardening.push(row),
            Start::Ready => readiness.ready.push(row),
            // Only a Ready Gardening issue is the loop's to start.
            Start::Stacked(pr) if gardening => readiness.waiting.push(Row {
                reason: Some(format!(
                    "{key} waits for its Blockers' open PR {} to merge; a Gardening issue is never stacked",
                    pr.url
                )),
                ..row
            }),
            Start::Stacked(pr) => readiness.stackable.push(Row {
                base: Some(pr.head_branch.clone()),
                ..row
            }),
            Start::Waits(reason) => readiness.waiting.push(Row {
                reason: Some(reason),
                ..row
            }),
        }
    }
    readiness
}

/// Where an issue's work may start, by its unresolved Blockers.
pub enum Start<'a> {
    /// None unresolved: from the Repo's Base.
    Ready,
    /// On the one branch its unresolved Blockers' open PRs sit on: Stackable.
    Stacked(&'a BlockerPr),
    /// An unresolved Blocker has no open PR here, or their open PRs sit on
    /// several branches: why it waits.
    Waits(String),
}

pub fn start(issue: &Issue) -> Start<'_> {
    let unresolved: Vec<&Blocker> = issue.blockers.iter().filter(|b| !b.resolved).collect();
    if unresolved.is_empty() {
        return Start::Ready;
    }
    if unresolved.iter().any(|b| b.prs.is_empty()) {
        let on: Vec<String> = (unresolved.iter())
            .map(|b| match &b.installing {
                Some(repo) => format!("{} to be installed in {repo}", b.key),
                None => format!("{} to close", b.key),
            })
            .collect();
        return Start::Waits(format!("{} waits on {}", issue.key, on.join(", and on ")));
    }
    let mut prs: Vec<&BlockerPr> = vec![];
    for pr in unresolved.iter().flat_map(|b| &b.prs) {
        if !prs.iter().any(|p| p.url == pr.url) {
            prs.push(pr);
        }
    }
    if prs.iter().all(|p| p.head_branch == prs[0].head_branch) {
        return Start::Stacked(prs[0]);
    }
    let urls: Vec<&str> = prs.iter().map(|p| p.url.as_str()).collect();
    Start::Waits(format!(
        "{} waits for its Blockers' open PRs {} to merge down to one; they sit on different branches",
        issue.key,
        urls.join(", ")
    ))
}

/// Ready but for its Blockers, in the Repo `mine` names while its `mine` Switch is on.
fn can_start(issue: &Issue, user: &[String], mine: Option<&str>) -> bool {
    why_not_startable(issue, user, mine).is_none()
}

/// Why the issue may not start, its Blockers aside; `None` when it may.
fn why_not_startable(issue: &Issue, user: &[String], mine: Option<&str>) -> Option<String> {
    let key = &issue.key;
    if !issue.open {
        Some(format!("{key} is closed or already started"))
    } else if !issue.labels.iter().any(|l| l == READY_LABEL) {
        Some(format!("{key} is not labelled {READY_LABEL}"))
    } else if issue.has_sub_issues {
        Some(format!(
            "{key} is a parent issue; dispatch its sub-issues instead"
        ))
    } else {
        why_not_yours(issue, user, mine)
    }
}

/// Why who the issue is assigned to keeps it from starting: someone else, or
/// no one in the Repo `mine` names while its `mine` Switch is on; `None` when
/// that does not.
pub fn why_not_yours(issue: &Issue, user: &[String], mine: Option<&str>) -> Option<String> {
    let key = &issue.key;
    let others: Vec<String> = (assignees(issue, user).into_iter())
        .filter(|a| !a.you)
        .map(|a| a.name)
        .collect();
    if !others.is_empty() {
        return Some(format!("{key} is assigned to {}", others.join(", ")));
    }
    (mine.filter(|_| issue.assignees.is_empty())).map(|repo| not_yours(key, repo))
}

/// Each of `issue`'s assignees by name, the one who is the `user` marked.
pub fn assignees(issue: &Issue, user: &[String]) -> Vec<Assignee> {
    (issue.assignees.iter().enumerate())
        .map(|(i, id)| Assignee {
            name: issue.assignee_names.get(i).unwrap_or(id).clone(),
            you: user.iter().any(|u| u.eq_ignore_ascii_case(id)),
        })
        .collect()
}

/// Why the unassigned issue `key` of the Repo `repo`, its `mine` Switch on, is not Ready.
pub fn not_yours(key: &str, repo: &str) -> String {
    format!("{key} is not assigned to you, and {repo} takes only issues assigned to you")
}

/// Why the issue `key` of `read` is neither Ready nor Stackable, In flight
/// aside; `None` when it is.
pub fn why_not_ready(read: &Read, key: &str) -> Option<String> {
    let Some(issue) = read.issues.iter().find(|i| i.key == key) else {
        return Some(format!(
            "{key} was not an open issue labelled {READY_LABEL} when its Source was read, at {}",
            read.read_at
        ));
    };
    why_not_startable(issue, &read.user, read.mine.as_deref()).or_else(|| match start(issue) {
        Start::Ready | Start::Stacked(_) => None,
        Start::Waits(reason) => Some(reason),
    })
}

fn from_github(slug: &str, issue: &GitHubIssue) -> Issue {
    Issue {
        key: github_key(slug, slug, issue.number),
        title: issue.title.clone(),
        url: issue.url.clone(),
        branch: github_branch(slug, issue.number),
        created_at: issue.created_at.clone(),
        open: issue.state == IssueState::Open,
        labels: issue.labels.clone(),
        assignees: issue.assignees.clone(),
        assignee_names: vec![],
        has_sub_issues: issue.has_sub_issues,
        blockers: issue
            .blockers
            .iter()
            .map(|b| Blocker {
                key: github_key(slug, &b.slug, b.number),
                title: Some(b.title.clone()),
                resolved: b.state == IssueState::Closed,
                closed_at: b.closed_at.clone(),
                installing: None,
                prs: vec![],
            })
            .collect(),
    }
}

/// The number of a GitHub PR's URL in `repo`.
fn pr_number(url: &str, repo: &str) -> Option<u64> {
    let path = url.strip_prefix("https://github.com/")?;
    let mut parts = path.splitn(4, '/');
    let (owner, name, pull, rest) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    let number = rest.split(['/', '?', '#']).next()?.parse().ok()?;
    (pull == "pull" && format!("{owner}/{name}").eq_ignore_ascii_case(repo)).then_some(number)
}

/// Whether a Repo's Linear selector claims the issue.
fn claims(selector: &Linear, issue: &LinearIssue) -> bool {
    let team = &issue.team;
    [&team.id, &team.key, &team.name].contains(&&selector.team)
        && selector.project.as_ref().is_none_or(|p| {
            (issue.project.as_ref()).is_some_and(|ip| [&ip.id, &ip.name].contains(&p))
        })
        && (selector.label.as_ref()).is_none_or(|l| issue.labels.contains(l))
}

fn from_linear(issue: &LinearIssue) -> Issue {
    let closed = |state: &str| ["completed", "canceled"].contains(&state);
    Issue {
        key: issue.identifier.clone(),
        title: issue.title.clone(),
        url: issue.url.clone(),
        // Linear's own, which its GitHub integration links the PR by.
        branch: issue.branch_name.clone(),
        created_at: issue.created_at.clone(),
        // A started issue is someone's work, not the loop's.
        open: ["backlog", "unstarted"].contains(&issue.state.as_str()),
        labels: issue.labels.clone(),
        assignees: issue.assignee.iter().cloned().collect(),
        assignee_names: issue.assignee_name.iter().cloned().collect(),
        has_sub_issues: issue.has_sub_issues,
        blockers: issue
            .blockers
            .iter()
            .map(|b| Blocker {
                key: b.identifier.clone(),
                title: Some(b.title.clone()),
                resolved: closed(&b.state),
                closed_at: b.closed_at.clone(),
                installing: None,
                prs: vec![],
            })
            .collect(),
    }
}

/// The slug and number of the GitHub issue `key`; `None` for a Linear identifier.
pub fn github_ref(key: &str) -> Option<(&str, u64)> {
    let (slug, number) = key.rsplit_once('#')?;
    Some((
        slug,
        number.parse().expect("a GitHub key ends in its number"),
    ))
}

/// `owner/repo#N`, in the Repo's own casing for its own issues.
fn github_key(repo: &str, slug: &str, number: u64) -> String {
    let slug = if slug.eq_ignore_ascii_case(repo) {
        repo
    } else {
        slug
    };
    format!("{slug}#{number}")
}
