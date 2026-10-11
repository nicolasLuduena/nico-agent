//! The test harness: `setup()` gives a FakeWorld, a fresh config directory
//! and a `cli()` that runs the binary's library entry as the CLI would.
//! Tests assert on the command's output, `world.calls()` and the config files.

// Each test binary uses a different part of the harness.
#![allow(dead_code)]

mod fake_world;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

pub use fake_world::*;
use nico_agent::{Context, run};
use serde_json::Value;

pub struct Setup {
    pub world: FakeWorld,
    /// Not created yet: commands create it when they first write.
    pub config_dir: PathBuf,
}

/// What a command printed and the exit code it ended with.
pub struct Ran {
    pub stdout: String,
    pub exit_code: i32,
}

impl Ran {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.stdout)
            .unwrap_or_else(|e| panic!("stdout is not JSON ({e}): {}", self.stdout))
    }
}

pub fn setup() -> Setup {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "nico-agent-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    Setup {
        world: FakeWorld::default(),
        config_dir: root.join("config"),
    }
}

impl Setup {
    /// Run one tick of the loop: `serve` with its timer off, which ticks once.
    /// What it logged, a line per action, taken out of the log unstamped.
    pub fn tick(&self) -> Vec<String> {
        let runs = self.world.timer_runs.replace(0);
        let start = self.world.logged.borrow().len();
        let ran = self.cli(&["serve"]);
        self.world.timer_runs.set(runs);
        assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
        let said: Vec<String> = (self.world.logged.borrow_mut().drain(start..))
            // Past the stamp: `2026-09-30T12:00:00Z `.
            .map(|line| line[21..].to_string())
            .collect();
        if let Some(failed) = said.iter().find(|l| l.starts_with("tick failed: ")) {
            panic!("{failed}");
        }
        said
    }

    /// Run `nico-agent <argv>` against the FakeWorld.
    pub fn cli(&self, argv: &[&str]) -> Ran {
        let argv: Vec<String> = argv.iter().map(|a| a.to_string()).collect();
        let ctx = Context {
            world: &self.world,
            config_dir: self.config_dir.clone(),
        };
        let output = run(&argv, &ctx);
        Ran {
            stdout: output.stdout,
            exit_code: output.exit_code,
        }
    }
}
