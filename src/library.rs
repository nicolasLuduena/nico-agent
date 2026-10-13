//! The Library versions no Repo links, which the Board's Libraries tab adds
//! and removes under `[wiki] libraries` in `config.toml`, keeping the rest
//! as written. A Repo's own links are its settings ([`crate::repo::set`]).

use serde::Serialize;
use serde_json::{Value, json};
use toml_edit::{Array, DocumentMut, RawString};

use crate::cli::{Context, Refusal};
use crate::config::{self, Config, Library};
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
        if let Some(slug) = linked_by(config, &id) {
            return format!("{id} already linked by {slug} (no-op)");
        }
        if config.wiki.libraries.iter().any(|l| l.id() == id) {
            return format!("{id} already added (no-op)");
        }
        let mut written = (library.serialize(toml_edit::ser::ValueSerializer::new()))
            .expect("a Library version is TOML");
        let list = added(doc);
        // In a list written one per line, on a line of its own, after the comment ending the last.
        let indent = (list.iter().last()).and_then(|last| raw(last.decor().prefix()));
        match indent.as_deref().and_then(|p| p.rsplit_once('\n')) {
            Some((_, indent)) => {
                let after = raw(Some(list.trailing())).unwrap_or_default();
                written.decor_mut().set_prefix(format!("{after}{indent}"));
                list.set_trailing("\n");
                list.push_formatted(written);
            }
            None => list.push(written),
        }
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
        if let Some(slug) = linked_by(config, id) {
            return Err(Refusal::new(
                format!("{id} is linked by {slug}"),
                vec![format!(
                    "Unlink it in {slug}'s settings first; the Libraries tab holds only the versions no Repo links"
                )],
            ));
        }
        let Some(at) = (config.wiki.libraries.iter()).position(|l| l.id() == id) else {
            return Ok(json!({ "library": format!("{id} not added (no-op)") }));
        };
        let dropped = wiki::forget(ctx, config, &Of::Library(&config.wiki.libraries[at]))?;
        // Its line goes with it: the next takes what came before it, or the last line its comment.
        let list = added(doc);
        let before = raw(list.remove(at).decor().prefix()).unwrap_or_default();
        match list.get_mut(at) {
            Some(next) => next.decor_mut().set_prefix(before),
            None => {
                if let Some((line, _)) = before.rsplit_once('\n') {
                    list.set_trailing(format!("{line}\n"));
                }
            }
        }
        let stays = dropped.then_some("its Wiki, in the Bucket's history");
        Ok(json!({ "library": format!("{id} removed"), "stays": Vec::from_iter(stays) }))
    })?
}

/// The first Repo linking the Library version `id`, by its slug: itself
/// or through its Project's defaults.
pub fn linked_by<'a>(config: &'a Config, id: &str) -> Option<&'a str> {
    (config.repos.iter())
        .find(|(_, repo)| repo.libraries.iter().any(|l| l.id() == id))
        .map(|(slug, _)| slug.as_str())
}

/// What `raw` holds, as written.
fn raw(raw: Option<&RawString>) -> Option<String> {
    raw.and_then(RawString::as_str).map(String::from)
}

/// `[wiki] libraries` as written, made when missing.
fn added(doc: &mut DocumentMut) -> &mut Array {
    let wiki = repo::table_at(doc.as_table_mut(), "wiki");
    let libraries = (wiki.entry("libraries")).or_insert(toml_edit::value(Array::new()));
    // shortcut: `[[wiki.libraries]]` tables become one inline list, their comments lost; keep them tables if anyone writes them so.
    libraries.make_value();
    libraries.as_array_mut().expect("load read it as a list")
}
