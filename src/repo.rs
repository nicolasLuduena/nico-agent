//! `repo add|rm|list`: which Repos the loop works, kept in `config.toml`;
//! and the settings the page writes there, a Repo's own and a Project's.

use serde_json::{Map, Value, json};
use toml_edit::{InlineTable, Item, Table, TableLike, value};

use crate::args::Args;
use crate::bucket;
use crate::checks;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config::{self, Config, Launch, Linear, SWITCHES, Switches};
use crate::dispatch;
use crate::status;
use crate::world::World;

pub fn add(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    const ADD: &str = "repo add";
    let flags = [
        "--path",
        "--project",
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
    let project = args.flag("--project");
    if let Some(project) = project.filter(|p| !is_name(p)) {
        return Err(bad_invocation(
            format!("`{project}` is not a Project's name"),
            ADD,
        ));
    }
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

    clone_of(ctx.world, slug, &path)?;
    bucket::create(ctx, &config::load(&ctx.config_dir)?)?;

    config::edit(&ctx.config_dir, |config, doc| {
        let (slug, done) = match config.repo(slug) {
            Some((slug, repo))
                if repo.path == path
                    && (linear.is_none() || repo.linear == linear)
                    && (project.is_none() || repo.project.as_deref() == project) =>
            {
                return json!({ "repo": format!("{slug} already added (no-op)"), "path": path });
            }
            Some((slug, _)) => (slug.clone(), "updated"),
            None => (slug.to_string(), "added"),
        };
        let repo = table_at(table_at(doc.as_table_mut(), "repos"), &slug);
        repo.insert("path", value(&path));
        if let Some(project) = project {
            repo.insert("project", value(project));
        }
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

/// Whether `path` is a clone with a remote for `slug`; refused saying why.
pub fn clone_of(world: &dyn World, slug: &str, path: &str) -> Result<(), Refusal> {
    let Some(remotes) = world.git_remotes(path)? else {
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
    Ok(())
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

/// `repo rm <slug>` as the page asks it: refused while the Repo has a
/// Dispatch In flight, where the command keeps it In flight till Closed.
pub fn rm_idle(ctx: &Context, slug: &str) -> Result<Value, Refusal> {
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let in_flight: Vec<&str> = (dispatches.iter())
        .filter(|d| d.closed_at.is_none() && d.repo.eq_ignore_ascii_case(slug))
        .map(|d| d.issue.as_str())
        .collect();
    if !in_flight.is_empty() {
        return Err(Refusal::new(
            format!("{slug} has a Dispatch In flight: {}", in_flight.join(", ")),
            vec![format!(
                "Remove it once each is Closed, or run `nico-agent repo rm {slug}`, which keeps them In flight till they are Closed"
            )],
        ));
    }
    rm(&[slug], ctx)
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
            shown["project"] = json!(repo.project_name(slug));
            shown["reviewer"] = json!(config.reviewer(repo, &repo.implementer.harness));
            shown
        })
        .collect();
    Ok(json!({ "repos": repos }))
}

/// What `PATCH /api/repo/<slug>` sets; null takes the Project's or the default.
const SETTINGS: [&str; 7] = [
    "implementer",
    "reviewer",
    "room",
    "base",
    "project",
    "install",
    "switches",
];
/// What `PATCH /api/project/<name>` sets: a Repo's, but `project` and `install`.
const PROJECT_SETTINGS: [&str; 5] = ["implementer", "reviewer", "room", "base", "switches"];

/// Write `set`, `{name: bool}`, to the switches of the Repo `slug` as
/// [`set`] does; the Repo's switches after.
pub fn switches(ctx: &Context, slug: &str, set: &Value) -> Result<Value, Refusal> {
    let shown = self::set(ctx, slug, &json!({ "switches": set }))?;
    let switches: Map<String, Value> = (shown["switches"].as_object().into_iter().flatten())
        .map(|(name, setting)| (name.clone(), setting["value"].clone()))
        .collect();
    Ok(json!({ "switches": switches }))
}

/// Write `set`, `{setting: value}` of [`SETTINGS`], to the Repo `slug` in the
/// config, keeping the rest as written; null removes the Repo's own value,
/// a switch's its own switch; then the Repo's Readiness checks run. The
/// Repo's slug and settings after, as `status` shows them.
pub fn set(ctx: &Context, slug: &str, set: &Value) -> Result<Value, Refusal> {
    let slug = config::edit(&ctx.config_dir, |config, doc| {
        let Some((slug, _)) = config.repo(slug) else {
            return Err(not_configured(slug));
        };
        let set = checked(config, set, &SETTINGS)?;
        let repo = doc["repos"][slug.as_str()]
            .as_table_like_mut()
            .expect("load read each Repo as a table");
        write(repo, set);
        Ok(slug.clone())
    })??;
    let config = config::load(&ctx.config_dir)?;
    let (slug, repo) = config.repo(&slug).ok_or_else(|| not_configured(&slug))?;
    checks::run(ctx, &config, |checked, _| checked == slug)?;
    let mut shown = json!({ "slug": slug });
    status::settings(&mut shown, &config, slug, repo);
    Ok(shown)
}

/// Write `set`, `{setting: value}` of [`PROJECT_SETTINGS`], to the defaults
/// of the Project `name`, as [`set`] does a Repo's, then check its Repos;
/// its name, defaults and settings after, as `status` shows them.
pub fn set_project(ctx: &Context, name: &str, set: &Value) -> Result<Value, Refusal> {
    config::edit(&ctx.config_dir, |config, doc| {
        let mut names: Vec<&str> = config.projects.keys().map(String::as_str).collect();
        names.extend((config.repos.iter()).map(|(slug, repo)| repo.project_name(slug)));
        if !names.contains(&name) {
            names.sort();
            names.dedup();
            let help = vec![format!("Projects: {}", names.join(", "))];
            return Err(Refusal::new(format!("{name} is not a Project"), help));
        }
        let set = checked(config, set, &PROJECT_SETTINGS)?;
        write(
            table_at(table_at(doc.as_table_mut(), "projects"), name),
            set,
        );
        Ok(())
    })??;
    let config = config::load(&ctx.config_dir)?;
    checks::run(ctx, &config, |slug, repo| repo.project_name(slug) == name)?;
    let mut shown = json!({ "name": name, "defaults": config.projects.get(name) });
    status::settings(&mut shown, &config, name, &config.project(name));
    Ok(shown)
}

/// `set` as an object of some of `keys`, each null or a value the config
/// holds; else a bad request.
fn checked<'a>(
    config: &Config,
    set: &'a Value,
    keys: &[&str],
) -> Result<&'a Map<String, Value>, Refusal> {
    let bad = |error: String, help: String| Refusal {
        error,
        help: vec![help],
        exit_code: 2,
    };
    let settings = || {
        format!(
            "Settings: {}; null takes the Project's or the default",
            keys.join(", ")
        )
    };
    let set = (set.as_object())
        .filter(|set| !set.is_empty())
        .ok_or_else(|| bad(format!("{set} sets nothing"), settings()))?;
    let switches = || format!("Switches: {}", SWITCHES.join(", "));
    for (key, new) in set {
        match (key.as_str(), new) {
            (key, _) if !keys.contains(&key) => {
                return Err(bad(
                    format!("`{key}` is not a setting the page sets"),
                    settings(),
                ));
            }
            (_, Value::Null) => {}
            // A room past u32 would leave config.toml unreadable.
            ("room", room)
                if room
                    .as_u64()
                    .and_then(|r| u32::try_from(r).ok())
                    .is_some_and(|r| r >= 1) => {}
            ("room", room) => {
                let help = "room is how many Dispatches the Repo may have In flight at once, \
                            a whole number of at least 1";
                return Err(bad(
                    format!("room is a whole number of at least 1, not {room}"),
                    help.into(),
                ));
            }
            ("base" | "project", Value::String(name)) if is_name(name) => {}
            ("install", Value::String(command)) if !command.trim().is_empty() => {}
            ("install", other) => {
                let help =
                    "install is the command run in the Repo's clone after a merge into its Base";
                return Err(bad(
                    format!("install is a command, not {other}"),
                    help.into(),
                ));
            }
            ("base" | "project", other) => {
                let help = match key.as_str() {
                    "base" => "base is the branch a Dispatch starts from unless stacked",
                    _ => "project is the name of the Project the Repo joins",
                };
                return Err(bad(format!("{key} is a name, not {other}"), help.into()));
            }
            ("switches", Value::Object(set)) => {
                for (name, on) in set {
                    if !SWITCHES.contains(&name.as_str()) {
                        return Err(bad(format!("`{name}` is not a switch"), switches()));
                    }
                    if !(on.is_boolean() || on.is_null()) {
                        return Err(bad(
                            format!("{name} is true or false, not {on}"),
                            switches(),
                        ));
                    }
                }
            }
            ("switches", other) => {
                return Err(bad(
                    format!("{other} is not an object of switches"),
                    switches(),
                ));
            }
            (_, launch) => {
                let names: Vec<&str> = config.harnesses.keys().map(String::as_str).collect();
                let launch: Launch = serde_json::from_value(launch.clone()).map_err(|_| {
                    let error = format!("{key} is {{harness, model, effort}}, not {launch}");
                    bad(error, format!("Harnesses: {}", names.join(", ")))
                })?;
                dispatch::check(config, &launch)?;
            }
        }
    }
    Ok(set)
}

/// Write each of `set`, [`checked`], to `table`, with the spacing and
/// comment each was written with; null removes one.
pub(crate) fn write(table: &mut dyn TableLike, set: &Map<String, Value>) {
    for (key, new) in set {
        match new {
            Value::Null => {
                table.remove(key);
            }
            Value::Object(set) if key == "switches" => {
                let switches = table
                    .entry(key)
                    .or_insert(value(InlineTable::new()))
                    .as_table_like_mut()
                    .expect("load read switches as a table");
                for (name, on) in set {
                    match on.as_bool() {
                        Some(on) => set_kept(switches, name, on.into()),
                        None => {
                            switches.remove(name);
                        }
                    }
                }
                if switches.is_empty() {
                    table.remove(key);
                }
            }
            Value::Object(_) => {
                let launch: Launch = serde_json::from_value(new.clone()).expect("checked above");
                let fields = [("model", launch.model), ("effort", launch.effort)];
                // One written as its own `[...]` table keeps its header and comments.
                if let Some(written) = table.get_mut(key).and_then(Item::as_table_mut) {
                    set_kept(written, "harness", launch.harness.into());
                    for (field, set) in fields {
                        match set {
                            Some(set) => set_kept(written, field, set.into()),
                            None => {
                                written.remove(field);
                            }
                        }
                    }
                    continue;
                }
                let mut written = InlineTable::new();
                written.insert("harness", launch.harness.into());
                for (field, set) in fields {
                    if let Some(set) = set {
                        written.insert(field, set.into());
                    }
                }
                set_kept(table, key, written.into());
            }
            Value::Number(room) => {
                set_kept(table, key, room.as_i64().expect("checked above").into())
            }
            Value::String(name) => set_kept(table, key, name.as_str().into()),
            Value::Bool(_) | Value::Array(_) => unreachable!("checked above"),
        }
    }
}

/// The table `key` of `table`, made when missing: its `[key]` header
/// written only once it holds a key of its own.
pub(crate) fn table_at<'t>(table: &'t mut dyn TableLike, key: &str) -> &'t mut dyn TableLike {
    (table.entry(key))
        .or_insert_with(|| {
            let mut made = Table::new();
            made.set_implicit(true);
            Item::Table(made)
        })
        .as_table_like_mut()
        .expect("load read it as a table")
}

/// Set `key` of `table` to `new`, with the spacing and comment it was written with.
fn set_kept(table: &mut dyn TableLike, key: &str, mut new: toml_edit::Value) {
    match table.get_mut(key).and_then(Item::as_value_mut) {
        Some(was) => {
            *new.decor_mut() = was.decor().clone();
            *was = new;
        }
        None => {
            table.insert(key, Item::Value(new));
        }
    }
}

/// The refusal of a `slug` the config has no Repo for.
pub fn not_configured(slug: &str) -> Refusal {
    Refusal::new(
        format!("{slug} is not a configured Repo"),
        vec![format!(
            "Run `nico-agent repo add {slug} --path <clone>` first"
        )],
    )
}

/// `switches` as the app shows them.
pub fn shown(switches: &Switches) -> Value {
    let all = serde_json::to_value(switches).expect("switches are plain data");
    (SWITCHES.iter())
        .map(|name| (*name, all[name].clone()))
        .collect()
}

/// A Base's or Project's name: not empty, nor starting or ending in a space.
fn is_name(text: &str) -> bool {
    !text.is_empty() && text.trim() == text
}

/// `owner/name`, each part letters, digits, `_`, `.` or `-`.
pub fn is_slug(text: &str) -> bool {
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
