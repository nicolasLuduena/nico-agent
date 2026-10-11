//! `repo add|rm|list`: which Repos the loop works, kept in `config.toml`.

use serde_json::{Value, json};
use toml_edit::{InlineTable, Item, Table, value};

use crate::args::Args;
use crate::bucket;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config::{self, Linear, Switches};
use crate::dispatch;

pub fn add(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    const ADD: &str = "repo add";
    let flags = [
        "--path",
        "--linear-team",
        "--linear-project",
        "--linear-label",
    ];
    let args = Args::parse(ADD, args, &flags)?;
    let slug = args.positionals(&["<owner/name>"])?[0];
    if !is_slug(slug) {
        return Err(bad_invocation(
            format!("`{slug}` is not an owner/name slug"),
            ADD,
        ));
    }
    let path = args
        .flag("--path")
        .ok_or_else(|| bad_invocation("missing required flag --path".into(), ADD))?;
    let path = std::path::absolute(path)?.display().to_string();
    let linear = match (
        args.flag("--linear-team"),
        args.flag("--linear-project"),
        args.flag("--linear-label"),
    ) {
        (None, None, None) => None,
        (Some(team), project, label) => Some(Linear {
            team: team.into(),
            project: project.map(Into::into),
            label: label.map(Into::into),
        }),
        _ => {
            let error = "--linear-project and --linear-label need --linear-team".into();
            return Err(bad_invocation(error, ADD));
        }
    };

    let Some(remotes) = ctx.world.git_remotes(&path)? else {
        return Err(Refusal::new(
            format!("{path} is not a git clone"),
            vec![format!(
                "Run `git clone https://github.com/{slug} {path}` first, or pass the path of an existing clone"
            )],
        ));
    };
    let of_slug =
        |remote: &String| remote_slug(remote).is_some_and(|s| s.eq_ignore_ascii_case(slug));
    if !remotes.iter().any(of_slug) {
        return Err(Refusal::new(
            format!(
                "{path} is not a clone of {slug} (its remotes: {})",
                remotes.join(", ")
            ),
            vec![format!(
                "Run `nico-agent repo add <owner/name> --path {path}` with the slug its remote points at"
            )],
        ));
    }
    bucket::create(ctx, &config::load(&ctx.config_dir)?)?;

    config::edit(&ctx.config_dir, |config, doc| {
        let (slug, done) = match config.repo(slug) {
            Some((slug, repo))
                if repo.path == path && (linear.is_none() || repo.linear == linear) =>
            {
                return json!({ "repo": format!("{slug} already added (no-op)"), "path": path });
            }
            Some((slug, _)) => (slug.clone(), "updated"),
            None => (slug.to_string(), "added"),
        };
        let repos = doc
            .entry("repos")
            .or_insert_with(|| {
                let mut repos = Table::new();
                repos.set_implicit(true);
                Item::Table(repos)
            })
            .as_table_like_mut()
            .expect("load read repos as a table");
        if repos.get(&slug).is_none() {
            repos.insert(&slug, Item::Table(Table::new()));
        }
        let repo = repos
            .get_mut(&slug)
            .and_then(Item::as_table_like_mut)
            .expect("load read each Repo as a table");
        repo.insert("path", value(&path));
        if let Some(linear) = &linear {
            let mut selector = InlineTable::new();
            selector.insert("team", linear.team.as_str().into());
            for (key, set) in [("project", &linear.project), ("label", &linear.label)] {
                if let Some(set) = set {
                    selector.insert(key, set.as_str().into());
                }
            }
            repo.insert("linear", value(selector));
        }
        json!({ "repo": format!("{slug} {done}"), "path": path })
    })
}

pub fn rm(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let args = Args::parse("repo rm", args, &[])?;
    let slug = args.positionals(&["<owner/name>"])?[0];
    let dispatches = dispatch::load(&ctx.config_dir)?;
    config::edit(&ctx.config_dir, |config, doc| {
        let Some((slug, repo)) = config.repo(slug) else {
            return json!({ "repo": format!("{slug} not configured (no-op)") });
        };
        doc["repos"]
            .as_table_like_mut()
            .expect("load read repos as a table")
            .remove(slug);
        let in_flight = (dispatches.iter())
            .filter(|d| d.repo == *slug && d.closed_at.is_none())
            .map(|d| format!("{}, In flight till it is Closed", d.issue));
        let stays: Vec<String> = [format!("the clone at {}", repo.path)]
            .into_iter()
            .chain(in_flight)
            .collect();
        json!({ "repo": format!("{slug} removed"), "stays": stays })
    })
}

pub fn list(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("repo list", args, &[])?.positionals(&[])?;
    let config = config::load(&ctx.config_dir)?;
    let repos: Vec<Value> = config
        .repos
        .iter()
        .map(|(slug, repo)| {
            let mut shown = serde_json::to_value(repo).expect("a Repo is plain data");
            shown["slug"] = json!(slug);
            shown["reviewer"] = json!(config.reviewer(repo, &repo.implementer.harness));
            shown
        })
        .collect();
    Ok(json!({ "repos": repos }))
}

/// The switches the app shows and sets.
const SWITCHES: [&str; 8] = [
    "dispatch",
    "stack",
    "review",
    "restart",
    "flip",
    "answer",
    "gardening",
    "quality_scan",
];

/// Write `set`, `{name: bool}`, to the switches of the Repo `slug` in the
/// config, keeping the rest as written; the Repo's switches after.
pub fn switches(ctx: &Context, slug: &str, set: &Value) -> Result<Value, Refusal> {
    let bad = |error: String| Refusal {
        error,
        help: vec![format!("Switches: {}", SWITCHES.join(", "))],
        exit_code: 2,
    };
    let set =
        (set.as_object()).ok_or_else(|| bad(format!("{set} is not an object of switches")))?;
    for (name, on) in set {
        if !SWITCHES.contains(&name.as_str()) {
            return Err(bad(format!("`{name}` is not a switch")));
        }
        if !on.is_boolean() {
            return Err(bad(format!("{name} is true or false, not {on}")));
        }
    }
    config::edit(&ctx.config_dir, |config, doc| {
        let Some((slug, repo)) = config.repo(slug) else {
            return Err(Refusal::new(
                format!("{slug} is not a configured Repo"),
                vec![format!(
                    "Run `nico-agent repo add {slug} --path <clone>` first"
                )],
            ));
        };
        let switches = doc["repos"][slug.as_str()]
            .as_table_like_mut()
            .expect("load read each Repo as a table")
            .entry("switches")
            .or_insert(value(InlineTable::new()))
            .as_table_like_mut()
            .expect("load read switches as a table");
        let mut shown = shown(&repo.switches);
        for (name, on) in set {
            shown[name] = on.clone();
            let mut on = toml_edit::Value::from(on.as_bool().expect("checked above"));
            match switches.get_mut(name).and_then(Item::as_value_mut) {
                // With the spacing and comment it was written with.
                Some(was) => {
                    *on.decor_mut() = was.decor().clone();
                    *was = on;
                }
                None => {
                    switches.insert(name, Item::Value(on));
                }
            }
        }
        Ok(json!({ "switches": shown }))
    })?
}

/// `switches` as the app shows them.
pub fn shown(switches: &Switches) -> Value {
    let all = serde_json::to_value(switches).expect("switches are plain data");
    (SWITCHES.iter())
        .map(|name| (*name, all[name].clone()))
        .collect()
}

/// `owner/name`, each part letters, digits, `_`, `.` or `-`.
fn is_slug(text: &str) -> bool {
    let part = |p: &str| {
        !p.is_empty()
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c))
    };
    text.split_once('/')
        .is_some_and(|(owner, name)| part(owner) && part(name))
}

/// The `owner/name` a GitHub remote URL (https or ssh) points at, lowercased.
fn remote_slug(url: &str) -> Option<String> {
    let url = url.trim().to_ascii_lowercase();
    let path = match url.strip_prefix("https://").or(url.strip_prefix("http://")) {
        Some(rest) => {
            let host = rest.split_once('@').filter(|(user, _)| !user.contains('/'));
            host.map_or(rest, |(_, host)| host)
                .strip_prefix("github.com/")?
        }
        None => {
            let rest = url.strip_prefix("ssh://").unwrap_or(&url);
            let rest = rest.strip_prefix("git@github.com")?;
            rest.strip_prefix(':').or(rest.strip_prefix('/'))?
        }
    };
    let path = path.strip_suffix('/').unwrap_or(path);
    let path = path.strip_suffix(".git").unwrap_or(path);
    is_slug(path).then(|| path.to_string())
}
