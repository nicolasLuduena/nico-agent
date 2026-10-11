//! The file layer for everything nico-agent keeps in its config directory.
//! A file is replaced whole, atomically (a temp file renamed over it) under
//! its lock, so two processes never corrupt one; readers need no lock.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde::de::DeserializeOwned;

/// Read `file` (empty when missing), let `change` compute its new text, and
/// write that atomically when it differs, all under `file`'s lock.
pub fn update<T, E: From<io::Error>>(
    file: &Path,
    change: impl FnOnce(&str) -> Result<(String, T), E>,
) -> Result<T, E> {
    let named = |e: io::Error| io::Error::new(e.kind(), format!("{}: {e}", file.display()));
    let (_lock, old) = lock_and_read(file).map_err(named)?;
    let (new, out) = change(&old)?;
    if new != old {
        replace(file, &new).map_err(named)?;
    }
    Ok(out)
}

fn lock_and_read(file: &Path) -> io::Result<(File, String)> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    // flock: released when the handle drops, or when its process dies.
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(suffixed(file, ".lock"))?;
    lock.lock()?;
    match fs::read_to_string(file) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok((lock, String::new())),
        read => Ok((lock, read?)),
    }
}

fn replace(file: &Path, text: &str) -> io::Result<()> {
    // Under the lock no one else writes this file, so one temp name will do.
    let tmp = suffixed(file, ".tmp");
    let mut written = File::create(&tmp)?;
    written.write_all(text.as_bytes())?;
    written.sync_all()?;
    fs::rename(&tmp, file)
}

/// The records of an append-only JSON-lines file, without a torn last line
/// (an append a power cut ended early); a bad line before it is an error.
pub fn read_json_lines<T: DeserializeOwned>(file: &Path) -> io::Result<Vec<T>> {
    let bytes = match fs::read(file) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        read => read?,
    };
    // Lossy: a torn line may end mid-character.
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let mut records = Vec::with_capacity(lines.len());
    for (i, line) in lines
        .iter()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        match serde_json::from_str(line) {
            Ok(record) => records.push(record),
            Err(_) if i + 1 == lines.len() => {}
            Err(e) => {
                let error = format!("{} line {}: {e}", file.display(), i + 1);
                return Err(io::Error::new(io::ErrorKind::InvalidData, error));
            }
        }
    }
    Ok(records)
}

/// `value` as a JSON state file holds it.
pub fn text(value: &impl Serialize) -> String {
    serde_json::to_string_pretty(value).expect("state is plain data") + "\n"
}

/// What a JSON state file holds: nothing when missing or empty.
pub fn load<T: DeserializeOwned + Default>(file: &Path) -> io::Result<T> {
    match fs::read_to_string(file) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        read => parse(file, &read?),
    }
}

/// `text`, read from the JSON state file `file`: nothing when empty.
pub fn parse<T: DeserializeOwned + Default>(file: &Path, text: &str) -> io::Result<T> {
    if text.is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(text).map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{}: {e}", file.display()),
        )
    })
}

fn suffixed(file: &Path, suffix: &str) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(suffix);
    name.into()
}

/// `t` as ISO 8601 UTC to the second, the form GitHub gives; two of them
/// compare as text in time order.
pub fn iso(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let (days, time) = (secs / 86_400, secs % 86_400);
    // Howard Hinnant's `civil_from_days`, for days since 1970.
    let z = days + 719_468;
    let (era, doe) = (z / 146_097, z % 146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        time % 3600 / 60,
        time % 60
    )
}
