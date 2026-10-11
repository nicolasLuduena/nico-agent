//! Asking: an Implementer herdr reports blocked is waiting on the user. Each
//! tick records on its Dispatch since when and the question its pane shows,
//! and tells the user once per Asking with a desktop notification; the
//! Implementer itself is left alone.

use std::io;

use serde::{Deserialize, Serialize};

use crate::cli::Context;
use crate::config::Config;
use crate::dispatch::{self, Dispatch};
use crate::state;
use crate::world::{self, Agent, AgentState};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Asking {
    /// When herdr was first seen reporting the Implementer blocked.
    pub since: String,
    /// The last meaningful line of its pane then; empty when none could be read.
    pub question: String,
}

/// Record which live Dispatches are Asking and which no longer are, telling
/// the user of each new Asking, from the tick's list of herdr's `agents`;
/// faux-nico tells them instead where `answer` is on. Says what it did, a
/// line per action.
pub fn step(ctx: &Context, config: &Config, agents: Option<&[Agent]>) -> io::Result<Vec<String>> {
    // Unknown is not answered: each Asking stays as it was.
    let Some(agents) = agents else {
        return Ok(vec![]);
    };
    let live = (dispatch::load(&ctx.config_dir)?.into_iter()).filter(|d| d.closed_at.is_none());
    let mut said = vec![];
    for d in live {
        let name = &d.implementer.agent;
        let state = world::agent_state(agents, name);
        match (state, &d.asking) {
            (Some(AgentState::Blocked), None) => {
                let question = match ctx.world.herdr_agent_read(name) {
                    Ok(screen) => meaningful_line(&screen).unwrap_or_default().into(),
                    Err(e) => {
                        said.push(format!("could not read the question of {}: {e}", d.issue));
                        String::new()
                    }
                };
                let since = state::iso(ctx.world.now());
                let asking = Asking { since, question };
                record(ctx, &d.issue, Some(asking.clone()))?;
                said.push(format!("{} is Asking: \"{}\"", d.issue, asking.question));
                if !config.repo_of(&d).switches.answer {
                    said.extend(tell(ctx, &d, &asking));
                }
            }
            (Some(AgentState::Blocked | AgentState::Unknown), _) | (_, None) => {}
            (_, Some(_)) => record(ctx, &d.issue, None)?,
        }
    }
    Ok(said)
}

/// Tell the user `d` is Asking with a desktop notification quoting the
/// question; what failed, said. Once: a failed notification is not tried again.
pub fn tell(ctx: &Context, d: &Dispatch, asking: &Asking) -> Option<String> {
    let title = format!("{} is Asking", d.issue);
    let body = format!(
        "\"{}\"\nAnswer it in herdr: agent {}.",
        asking.question, d.implementer.agent
    );
    (ctx.world.notify(&title, &body))
        .err()
        .map(|e| format!("could not notify \"{title}\": {e}"))
}

fn record(ctx: &Context, issue: &str, asking: Option<Asking>) -> io::Result<()> {
    dispatch::update(&ctx.config_dir, |all| {
        if let Some(live) = all.iter_mut().find(|d| dispatch::is_live(d, issue)) {
            live.asking = asking;
        }
    })
}

/// The last line of `screen` that says something: not blank, and not a box's
/// edge, an empty prompt, a spinner or a key hint. Ported from `main`'s
/// screen-line.ts, without its regexes' word boundaries.
fn meaningful_line(screen: &str) -> Option<&str> {
    let edge = |c: char| c.is_whitespace() || ('─'..='╿').contains(&c);
    (screen.lines())
        .map(|line| line.trim_matches(edge))
        .rfind(|line| !line.is_empty() && !is_chrome(line))
}

/// What a Harness draws around the work: an empty prompt, a spinner, a key hint.
fn is_chrome(line: &str) -> bool {
    let mut chars = line.chars();
    let first = chars.next().unwrap_or_default();
    let rest = chars.as_str();
    let spaced = rest.starts_with(char::is_whitespace);
    // The first word after a star, cut off by an ellipsis: `✻ Thinking…`.
    let pondering = || {
        let word = rest.split_whitespace().next().unwrap_or_default();
        word.chars().skip(1).any(|c| c == '…')
    };
    let prompt = rest.is_empty() && ">›❯$%#".contains(first);
    let spinner = (spaced && (('⠀'..='⣿').contains(&first) || "◐◓◑◒".contains(first)))
        || (spaced && "✻✽✶✳✢·*".contains(first) && pondering())
        || line.contains("esc to interrupt");
    let hint = line.starts_with("? for shortcuts")
        || first == '⏵'
        || line.contains("(shift+tab to cycle)")
        || line.starts_with("Context left until auto-compact");
    prompt || spinner || hint
}
