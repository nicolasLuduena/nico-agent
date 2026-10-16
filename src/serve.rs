//! `serve`: the loop. Each Repo's Readiness checks, then one tick at once,
//! then one every `tick_minutes`, each logged a line per action; a tick
//! that fails is logged and the next runs; the user is notified once
//! when 3 fail in a row, and once more when one works again.
//! A panic ends the process, and the user service starts it again.

use serde_json::{Value, json};

use crate::args::Args;
use crate::checks;
use crate::cli::{Context, Refusal};
use crate::config;
use crate::http;
use crate::tick;
use crate::world::{HttpRequest, World};

/// Ticks failing in a row before the user is told: one is a blip, these are a broken night.
const FAILS_TOLD: u32 = 3;

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
    // Ticks failed in a row; the user is told once at FAILS_TOLD, and once when one works again.
    let mut failed = 0;
    let mut run = || match tick::tick(ctx, false) {
        Ok(said) => {
            said.iter().for_each(|line| ctx.world.log(line));
            if failed >= FAILS_TOLD {
                tell(
                    ctx,
                    "nico-agent's ticks work again",
                    &format!("after {failed} failed in a row"),
                );
            }
            failed = 0;
        }
        Err(no) => {
            ctx.world.log(&format!("tick failed: {}", no.error));
            failed += 1;
            if failed == FAILS_TOLD {
                tell(
                    ctx,
                    &format!("nico-agent's last {failed} ticks failed"),
                    &no.error,
                );
            }
        }
    };
    run();
    ctx.world.every(config.tick(), &mut run);
    Ok(json!({}))
}

/// A notification, or the log saying it could not be sent.
fn tell(ctx: &Context, title: &str, body: &str) {
    if let Err(e) = ctx.world.notify(title, body) {
        ctx.world.log(&format!("could not notify \"{title}\": {e}"));
    }
}
