//! The Library versions no Repo links, which the Board's Libraries tab adds
//! and removes under `[wiki] libraries` in `config.toml`, keeping the rest
//! as written. A Repo's own links are its settings ([`crate::repo::set`]).

use serde::Serialize;
use serde_json::{Value, json};
use toml_edit::{Array, RawString, TableLike};

use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Library, Repo};
use crate::repo;
use crate::wiki::{self, Of};

/// What a Library version is, for a refusal of one.
pub const HELP: &str = "libraries is a list of {repo, tag, path}: a GitHub repository's owner/name, one of its tags and, if only part of it, a subfolder";

/// `POST /api/libraries {repo, tag, path}`: add the Library version under
/// `[wiki] libraries` and queue its Wiki; a no-op for one added already, or
/// linked by a Repo.
pub fn add(ctx: &Context, body: &Value) -> Result<Value, Refusal> {
    let library: Library = serde_json::from_value(body.clone()).map_err(|e| Refusal {
        error: e.to_string(),
        help: vec![HELP.into()],
        exit_code: 2,
    })?;
    let id = library.id();
    let said = config::edit(&ctx.config_dir, |config, doc| {
        if let Some((slug, _)) = linked_by(config, &id) {
            return format!("{id} already linked by {slug} (no-op)");
        }
        if config.wiki.libraries.iter().any(|l| l.id() == id) {
            return format!("{id} already added (no-op)");
        }
        let wiki = repo::table_at(doc.as_table_mut(), "wiki");
        write(
            wiki,
            "libraries",
            &[&config.wiki.libraries[..], &[library]].concat(),
        );
        format!("{id} added")
    })?;
    wiki::queue_new(ctx, &config::load(&ctx.config_dir)?)?;
    Ok(json!({ "library": said }))
}

/// `DELETE /api/libraries/<id>`: remove the Library version `[wiki]
/// libraries` adds and take its Wiki out of the Bucket's files in one
/// commit, its history keeping it; refused while a Repo links it or its
/// Wiki builds; a no-op for one not added.
pub fn rm(ctx: &Context, id: &str) -> Result<Value, Refusal> {
    config::edit(&ctx.config_dir, |config, doc| {
        if let Some((slug, repo)) = linked_by(config, id) {
            let unlink = match (repo.own.libraries.is_some(), &repo.project) {
                (false, Some(project)) => format!(
                    "Unlink it from projects.\"{project}\".libraries in config.toml, which {slug} takes it from"
                ),
                _ => format!("Unlink it in {slug}'s settings first"),
            };
            return Err(Refusal::new(
                format!("{id} is linked by {slug}"),
                vec![format!(
                    "{unlink}; the Libraries tab holds only the versions no Repo links"
                )],
            ));
        }
        let Some(library) = (config.wiki.libraries.iter()).find(|l| l.id() == id) else {
            return Ok(json!({ "library": format!("{id} not added (no-op)") }));
        };
        let dropped = wiki::forget(ctx, config, &Of::Library(library))?;
        let kept: Vec<Library> = (config.wiki.libraries.iter())
            .filter(|l| l.id() != id)
            .cloned()
            .collect();
        write(
            repo::table_at(doc.as_table_mut(), "wiki"),
            "libraries",
            &kept,
        );
        let stays = dropped.then_some("its Wiki, in the Bucket's history");
        Ok(json!({ "library": format!("{id} removed"), "stays": Vec::from_iter(stays) }))
    })?
}

/// The first Repo linking the Library version `id`, by its slug: itself
/// or through its Project's defaults.
pub fn linked_by<'a>(config: &'a Config, id: &str) -> Option<(&'a str, &'a Repo)> {
    (config.repos.iter())
        .find(|(_, repo)| repo.libraries.iter().any(|l| l.id() == id))
        .map(|(slug, repo)| (slug.as_str(), repo))
}

/// Set the list `key` of `table` to `libraries`, each version it lists
/// already kept as written, with its comments: the others taken out with
/// theirs, the new ones added at its end.
pub fn write(table: &mut dyn TableLike, key: &str, libraries: &[Library]) {
    let list = (table.entry(key)).or_insert(toml_edit::value(Array::new()));
    // shortcut: `[[...libraries]]` tables become one inline list, their comments lost; keep them tables if anyone writes them so.
    list.make_value();
    let list = list.as_array_mut().expect("load read it as a list");
    let ids: Vec<String> = libraries.iter().map(Library::id).collect();
    // Last first, so each index holds.
    for at in (0..list.len()).rev() {
        if !(list.get(at).and_then(written)).is_some_and(|id| ids.contains(&id)) {
            remove(list, at);
        }
    }
    let kept: Vec<String> = list.iter().filter_map(written).collect();
    for library in libraries.iter().filter(|l| !kept.contains(&l.id())) {
        push(list, library);
    }
    if list.is_empty() {
        *list = Array::new();
    }
}

/// The id of the Library version `value` writes.
fn written(value: &toml_edit::Value) -> Option<String> {
    let table = value.as_inline_table()?;
    let field = |key| table.get(key).and_then(toml_edit::Value::as_str);
    let library = Library {
        repo: field("repo")?.into(),
        tag: field("tag")?.into(),
        path: field("path").map(Into::into),
    };
    Some(library.id())
}

/// Add `library` at the end of `list`: in a list written one per line, on
/// a line of its own, after the comment that ended the last one.
fn push(list: &mut Array, library: &Library) {
    let mut new = (library.serialize(toml_edit::ser::ValueSerializer::new()))
        .expect("a Library version is TOML");
    let last = (list.iter().last()).and_then(|last| raw(last.decor().prefix()));
    let Some((_, indent)) = last.as_deref().and_then(|p| p.rsplit_once('\n')) else {
        return list.push(new);
    };
    let after = raw(Some(list.trailing())).unwrap_or_default();
    new.decor_mut().set_prefix(format!("{after}{indent}"));
    list.set_trailing("\n");
    list.push_formatted(new);
}

/// Take the `at`th entry out of `list` with its lines: the comments above it
/// and the one ending its own line. What ends the line before it stays.
fn remove(list: &mut Array, at: usize) {
    let before = raw(list.remove(at).decor().prefix()).unwrap_or_default();
    // In a list on one line, the next takes its place.
    let Some((line, _)) = before.split_once('\n') else {
        if let Some(next) = list.get_mut(at) {
            next.decor_mut().set_prefix(before);
        }
        return;
    };
    // Past its first line, what precedes the next entry, or closes the list, is theirs.
    let theirs = |text: String| {
        text.split_once('\n')
            .map_or(text.clone(), |(_, rest)| rest.into())
    };
    match list.get_mut(at) {
        Some(next) => {
            let own = theirs(raw(next.decor().prefix()).unwrap_or_default());
            next.decor_mut().set_prefix(format!("{line}\n{own}"));
        }
        None => {
            let end = theirs(raw(Some(list.trailing())).unwrap_or_default());
            list.set_trailing(format!("{line}\n{end}"));
        }
    }
}

/// What `raw` holds, as written.
fn raw(raw: Option<&RawString>) -> Option<String> {
    raw.and_then(RawString::as_str).map(String::from)
}
