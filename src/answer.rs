//! `answer`: unblock an Asking Implementer by typing an answer into its pane
//! through herdr, then keep it on its Dispatch with the question it answers.

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
    let args = Args::parse("answer", args, &["--text", "--by"])?;
    let &[text_ref] = args.positionals(&["<issue>"])? else {
        unreachable!("one positional")
    };
    let Some(text) = args.flag("--text") else {
        return Err(bad_invocation("--text is required".into(), "answer"));
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
    if (d.answers.iter()).any(|a| (&a.since, &*a.text) == (&asking.since, text)) {
        return Ok(json!({ "answer": format!("{said} already recorded (no-op)") }));
    }
    launch::prompt(ctx.world, &d.implementer.agent, text)?;
    let new = Answer {
        since: asking.since,
        at: state::iso(ctx.world.now()),
        question: asking.question,
        text: text.into(),
        by: author,
    };
    dispatch::update(&ctx.config_dir, |all| {
        if let Some(live) = all.iter_mut().find(|d| dispatch::is_live(d, &issue)) {
            live.answers.push(new);
        }
    })?;
    Ok(json!({ "answer": said }))
}
