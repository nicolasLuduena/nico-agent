//! A Source's rate limit, kept in `pauses.json` as when it may be asked
//! again, so no tick, command or restarted `serve` reads it till then.

use std::collections::BTreeMap;
use std::io;
use std::path::Path;

use crate::state;
use crate::world::{World, WorldError};

pub const FILE: &str = "pauses.json";

/// Every Source, as its rate limit names it.
pub const SOURCES: [&str; 2] = ["GitHub", "Linear"];

/// When `source` may be asked again, while it is paused.
pub fn until(world: &dyn World, config_dir: &Path, source: &str) -> io::Result<Option<String>> {
    let pauses: BTreeMap<String, String> = state::load(&config_dir.join(FILE))?;
    let now = state::iso(world.now());
    Ok(pauses
        .get(&source.to_lowercase())
        .filter(|until| **until > now)
        .cloned())
}

/// The pause on `source`, as the error a read of it would fail with.
pub fn of(world: &dyn World, config_dir: &Path, source: &str) -> io::Result<Option<WorldError>> {
    let until = until(world, config_dir, source)?;
    Ok(until.map(|until| WorldError::rate_limited(source, &until)))
}

/// Keep the pause a rate-limited `error` carries; whether it was one.
pub fn note(config_dir: &Path, error: &WorldError) -> io::Result<bool> {
    let Some((source, until)) = error.rate_limit() else {
        return Ok(false);
    };
    let file = config_dir.join(FILE);
    state::update(&file, |text| {
        let mut pauses: BTreeMap<String, String> = state::parse(&file, text)?;
        pauses.insert(source.to_lowercase(), until.into());
        Ok::<_, io::Error>((state::text(&pauses), ()))
    })?;
    Ok(true)
}
