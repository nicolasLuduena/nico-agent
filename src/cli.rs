use std::path::PathBuf;

use serde_json::{Value, json};

use crate::dispatch;
use crate::repo;
use crate::status;
use crate::world::{World, WorldError};

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

impl Refusal {
    /// A refusal the user can act on: exit 1.
    pub fn new(error: String, help: Vec<String>) -> Self {
        Refusal {
            error,
            help,
            exit_code: 1,
        }
    }
}

impl From<std::io::Error> for Refusal {
    fn from(e: std::io::Error) -> Self {
        Refusal::new(e.to_string(), vec![])
    }
}

impl From<WorldError> for Refusal {
    fn from(e: WorldError) -> Self {
        Refusal::new(e.0, vec![])
    }
}

/// Every command, as its usage and what it does, for help lines.
const COMMANDS: &[(&str, &str)] = &[
    ("nico-agent --version", "print the version"),
    (
        "nico-agent repo add <owner/name> --path <clone> [--linear-team <team> --linear-project <project> --linear-label <label>]",
        "add a Repo",
    ),
    ("nico-agent repo rm <owner/name>", "remove a Repo"),
    ("nico-agent repo list", "list the Repos"),
    (
        "nico-agent dispatch <issue>... [--harness <harness> --model <model> --effort <effort>]",
        "start an Implementer on each Ready issue, or resume its failed Dispatch",
    ),
    (
        "nico-agent status",
        "show per Repo the Ready and Stackable issues, and every Dispatch",
    ),
];

/// Run `nico-agent` with `argv` (without the program name).
pub fn run(argv: &[String], ctx: &Context) -> Output {
    let json = argv.iter().any(|a| a == "--json");
    let words: Vec<&str> = argv
        .iter()
        .map(String::as_str)
        .filter(|a| *a != "--json")
        .collect();
    let answer = match words.as_slice() {
        ["--version"] => Ok(json!({ "version": env!("CARGO_PKG_VERSION") })),
        ["repo", "add", args @ ..] => repo::add(args, ctx),
        ["repo", "rm", args @ ..] => repo::rm(args, ctx),
        ["repo", "list", args @ ..] => repo::list(args, ctx),
        ["dispatch", args @ ..] => dispatch::dispatch(args, ctx),
        ["status", args @ ..] => status::status(args, ctx),
        ["repo", ..] => Err(bad_invocation(
            "`repo` needs a subcommand: add, rm or list".into(),
            "repo",
        )),
        [] => Err(bad_invocation("no command given".into(), "")),
        [word, ..] => Err(bad_invocation(format!("unknown command `{word}`"), "")),
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

/// Exit 2, with help on each command whose usage starts `nico-agent <command>`.
pub fn bad_invocation(error: String, command: &str) -> Refusal {
    let help = COMMANDS
        .iter()
        .filter(|(usage, _)| usage.starts_with(&format!("nico-agent {command}")))
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
