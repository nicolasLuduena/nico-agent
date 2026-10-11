use std::path::PathBuf;

use serde_json::{Value, json};

use crate::world::World;

/// What a command runs against: the outside world and the config directory.
pub struct Context<'a> {
    pub world: &'a dyn World,
    pub config_dir: PathBuf,
}

/// What a command prints, and the exit code it ends with.
pub struct Output {
    pub stdout: String,
    pub exit_code: i32,
}

/// A command saying no: printed as `{error, help}`; exit 1, or 2 for a bad invocation.
pub struct Refusal {
    pub error: String,
    pub help: Vec<String>,
    pub exit_code: i32,
}

/// Every command, as its usage and what it does, for help lines.
const COMMANDS: &[(&str, &str)] = &[("nico-agent --version", "print the version")];

/// Run `nico-agent` with `argv` (without the program name).
pub fn run(argv: &[String], _ctx: &Context) -> Output {
    let json = argv.iter().any(|a| a == "--json");
    let words: Vec<&str> = argv
        .iter()
        .map(String::as_str)
        .filter(|a| *a != "--json")
        .collect();
    let answer = match words.as_slice() {
        ["--version"] => Ok(json!({ "version": env!("CARGO_PKG_VERSION") })),
        [] => Err(bad_invocation("no command given".into())),
        [word, ..] => Err(bad_invocation(format!("unknown command `{word}`"))),
    };
    match answer {
        Ok(answer) => Output {
            stdout: render(&answer, json),
            exit_code: 0,
        },
        Err(no) => Output {
            stdout: render(&json!({ "error": no.error, "help": no.help }), json),
            exit_code: no.exit_code,
        },
    }
}

fn bad_invocation(error: String) -> Refusal {
    let help = COMMANDS
        .iter()
        .map(|(usage, does)| format!("Run `{usage}` to {does}"))
        .collect();
    Refusal {
        error,
        help,
        exit_code: 2,
    }
}

/// One JSON object with `--json`; else a line per field, a list's items indented under it.
fn render(answer: &Value, json: bool) -> String {
    if json {
        return format!("{answer}\n");
    }
    let plain = |v: &Value| v.as_str().map_or_else(|| v.to_string(), str::to_string);
    let mut lines = String::new();
    for (key, value) in answer.as_object().into_iter().flatten() {
        match value {
            Value::Array(items) => {
                lines += &format!("{key}:\n");
                items
                    .iter()
                    .for_each(|item| lines += &format!("  {}\n", plain(item)));
            }
            _ => lines += &format!("{key}: {}\n", plain(value)),
        }
    }
    lines
}
