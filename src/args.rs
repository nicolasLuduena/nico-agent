//! A command's arguments: positionals, and flags as `--name value` or
//! `--name=value`. A value may start with `--`, but the `value` of
//! `--name value` is never one of the command's own flags. Anything off is a
//! bad invocation (exit 2).

use std::collections::HashMap;

use crate::cli::{Refusal, bad_invocation};

pub struct Args<'a> {
    command: &'a str,
    positionals: Vec<&'a str>,
    flags: HashMap<&'a str, &'a str>,
}

impl<'a> Args<'a> {
    /// Split the `args` of `command`, which takes the valued `flags`.
    pub fn parse(command: &'a str, args: &[&'a str], flags: &[&str]) -> Result<Self, Refusal> {
        let mut parsed = Args {
            command,
            positionals: vec![],
            flags: HashMap::new(),
        };
        let mut rest = args.iter().copied().peekable();
        let own_flag = |arg: &str| flags.contains(&arg.split_once('=').map_or(arg, |(n, _)| n));
        while let Some(arg) = rest.next() {
            if !arg.starts_with("--") {
                parsed.positionals.push(arg);
                continue;
            }
            let (name, value) = arg
                .split_once('=')
                .map_or((arg, None), |(n, v)| (n, Some(v)));
            if !own_flag(arg) {
                return Err(bad_invocation(
                    format!("unknown flag {name} for `{command}`"),
                    command,
                ));
            }
            // The next argument is the value even when it starts with `--`, as an
            // answer about a command line does, unless it is a flag of the command.
            match value
                .or_else(|| rest.next_if(|next| !own_flag(next)))
                .filter(|v| !v.is_empty())
            {
                Some(value) => parsed.flags.insert(name, value),
                None => return Err(bad_invocation(format!("{name} needs a value"), command)),
            };
        }
        Ok(parsed)
    }

    /// The positionals, when there is one for each of `names`.
    pub fn positionals(&self, names: &[&str]) -> Result<&[&'a str], Refusal> {
        if let Some(missing) = names.get(self.positionals.len()) {
            return Err(bad_invocation(
                format!("{missing} is required"),
                self.command,
            ));
        }
        if let Some(extra) = self.positionals.get(names.len()) {
            let error = format!("unexpected argument `{extra}` for `{}`", self.command);
            return Err(bad_invocation(error, self.command));
        }
        Ok(&self.positionals)
    }

    /// The positionals, when there is at least one `name`.
    pub fn many(&self, name: &str) -> Result<&[&'a str], Refusal> {
        if self.positionals.is_empty() {
            return Err(bad_invocation(format!("{name} is required"), self.command));
        }
        Ok(&self.positionals)
    }

    pub fn flag(&self, name: &str) -> Option<&'a str> {
        self.flags.get(name).copied()
    }
}
