//! `answer`: unblock an Asking Implementer by typing an answer into its pane,
//! or pressing keys there, through herdr, then keep it on its Dispatch with
//! the question it answers.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal, bad_invocation};
use crate::config;
use crate::dispatch;
use crate::launch;
use crate::state;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answer {
    /// The `since` of the Asking it answers.
    pub since: String,
    pub at: String,
    pub question: String,
    pub text: String,
    pub by: By,
}

/// Who typed an answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum By {
    User,
    FauxNico,
}

pub fn answer(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    let (args, keys) = split_keys(args);
    let args = Args::parse("answer", &args, &["--text", "--by"])?;
    let &[text_ref] = args.positionals(&["<issue>"])? else {
        unreachable!("one positional")
    };
    let text = match (args.flag("--text"), &keys) {
        (Some(text), None) => text.to_string(),
        (None, Some(keys)) if !keys.is_empty() => keys.join(" "),
        (None, Some(_)) => return Err(bad_invocation("--keys needs a key".into(), "answer")),
        (Some(_), Some(_)) => {
            let error = "give --text or --keys, not both".into();
            return Err(bad_invocation(error, "answer"));
        }
        (None, None) => {
            let error = "--text or --keys is required".into();
            return Err(bad_invocation(error, "answer"));
        }
    };
    let by = args.flag("--by").unwrap_or("user");
    let author = match by {
        "user" => By::User,
        "faux-nico" => By::FauxNico,
        _ => {
            let error = format!("`{by}` is not an author: user or faux-nico");
            return Err(bad_invocation(error, "answer"));
        }
    };
    let config = config::load(&ctx.config_dir)?;
    let dispatches = dispatch::load(&ctx.config_dir)?;
    let issue = dispatch::key(&config, &dispatches, text_ref)?;
    let see_status = || "Run `nico-agent status` to see the Dispatch".to_string();
    let Some(d) = (dispatches.into_iter()).find(|d| dispatch::is_live(d, &issue)) else {
        return Err(Refusal::new(
            format!("{issue} has no live Dispatch"),
            vec![
                "An answer goes to the Asking Implementer of an issue In flight".into(),
                see_status(),
            ],
        ));
    };
    let Some(asking) = d.asking else {
        return Err(Refusal::new(
            format!("{issue} is not Asking"),
            vec![
                "An answer goes to an Implementer herdr reports blocked on a question".into(),
                see_status(),
            ],
        ));
    };
    let said = format!("{issue} answered by {by}");
    let agent = &d.implementer.agent;
    if let Some(keys) = keys {
        ctx.world.herdr_agent_send_keys(agent, &keys)?;
    } else if (d.answers.iter()).any(|a| (&a.since, &a.text) == (&asking.since, &text)) {
        return Ok(json!({ "answer": format!("{said} already recorded (no-op)") }));
    } else {
        let harness = &config.harnesses[&d.implementer.harness];
        launch::prompt(ctx.world, harness, agent, &text)?;
    }
    let new = Answer {
        since: asking.since,
        at: state::iso(ctx.world.now()),
        question: asking.question,
        text,
        by: author,
    };
    dispatch::update(&ctx.config_dir, |all| {
        if let Some(live) = all.iter_mut().find(|d| dispatch::is_live(d, &issue)) {
            live.answers.push(new);
        }
    })?;
    Ok(json!({ "answer": said }))
}

/// `args` without `--keys` and the keys after it, up to the next flag (no
/// key herdr names starts with `--`), and those keys; none without `--keys`.
fn split_keys<'a>(args: &[&'a str]) -> (Vec<&'a str>, Option<Vec<String>>) {
    let Some(at) = args.iter().position(|a| *a == "--keys") else {
        return (args.to_vec(), None);
    };
    let keys: Vec<String> = (args[at + 1..].iter())
        .take_while(|a| !a.starts_with("--"))
        .map(|key| key.to_string())
        .collect();
    let rest = [&args[..at], &args[at + 1 + keys.len()..]].concat();
    (rest, Some(keys))
}
