//! `serve`: the loop. One tick at once, then one every `tick_minutes`, each
//! logged a line per action; a tick that fails is logged and the next runs.
//! A panic ends the process, and the user service starts it again.

use serde_json::{Value, json};

use crate::args::Args;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::tick;

pub fn serve(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("serve", args, &[])?.positionals(&[])?;
    // shortcut: tick_minutes is read once; a change to it needs a restart of serve.
    let interval = config::load(&ctx.config_dir)?.tick();
    let mut run = || match tick::tick(ctx, false) {
        Ok(said) => said.iter().for_each(|line| ctx.world.log(line)),
        Err(no) => ctx.world.log(&format!("tick failed: {}", no.error)),
    };
    run();
    ctx.world.every(interval, &mut run);
    Ok(json!({}))
}
