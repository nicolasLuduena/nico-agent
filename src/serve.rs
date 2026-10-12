//! `serve`: the loop. Each Repo's Readiness checks, then one tick at once,
//! then one every `tick_minutes`, each logged a line per action; a tick
//! that fails is logged and the next runs.
//! A panic ends the process, and the user service starts it again.

use serde_json::{Value, json};

use crate::args::Args;
use crate::checks;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::http;
use crate::tick;
use crate::world::{HttpRequest, World};

pub fn serve(args: &[&str], ctx: &Context) -> Result<Value, Refusal> {
    Args::parse("serve", args, &[])?.positionals(&[])?;
    // shortcut: tick_minutes and port are read once; a change to either needs a restart of serve.
    let config = config::load(&ctx.config_dir)?;
    // Before listening, so the page's first status has them.
    if let Err(e) = checks::run(ctx, &config, |_, _| true) {
        ctx.world
            .log(&format!("could not keep the Readiness checks: {e}"));
    }
    let (config_dir, port) = (ctx.config_dir.clone(), config.port);
    let handler = move |world: &dyn World, request: &HttpRequest| {
        let ctx = Context {
            world,
            config_dir: config_dir.clone(),
        };
        http::answer(&ctx, port, request)
    };
    // Without the app the loop still works: a port taken is said, not fatal.
    if let Err(e) = ctx.world.listen(config.port, Box::new(handler)) {
        ctx.world.log(&e.0);
    }
    let mut run = || match tick::tick(ctx, false) {
        Ok(said) => said.iter().for_each(|line| ctx.world.log(line)),
        Err(no) => ctx.world.log(&format!("tick failed: {}", no.error)),
    };
    run();
    ctx.world.every(config.tick(), &mut run);
    Ok(json!({}))
}
