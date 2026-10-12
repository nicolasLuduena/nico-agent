//! The test harness: `setup()` gives a FakeWorld, a fresh config directory
//! and a `cli()` that runs the binary's library entry as the CLI would.
//! Tests assert on the command's output, `world.calls()` and the config files.

// Each test binary uses a different part of the harness.
#![allow(dead_code)]

mod fake_world;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

pub use fake_world::*;
use nico_agent::world::{Answer, HttpRequest, Poll};
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

/// An open event stream of `serve`.
pub struct Events<'a> {
    t: &'a Setup,
    poll: Poll,
}

impl Events<'_> {
    /// What the stream sends at its next poll: a keepalive, or its events.
    pub fn next(&mut self) -> String {
        (self.poll)(&self.t.world)
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
    /// The call `serve` makes to listen is taken out too: only the tick's are left.
    pub fn tick(&self) -> Vec<String> {
        let runs = self.world.timer_runs.replace(0);
        let start = self.world.logged.borrow().len();
        let listen = self.world.calls.borrow().len();
        let ran = self.cli(&["serve"]);
        self.world.calls.borrow_mut().remove(listen);
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

    /// Send `serve`, which must have run, a request as the app would: on its own host.
    pub fn request(&self, method: &str, path: &str, body: &str) -> Answer {
        self.request_with(method, path, &[("Host", "127.0.0.1:42069")], body)
    }

    /// Send `serve` a request with `headers` and no other.
    pub fn request_with(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> Answer {
        let listening = self.world.listening.borrow();
        let handler = listening.as_ref().expect("serve has not listened");
        let request = HttpRequest {
            method: method.into(),
            url: path.into(),
            headers: (headers.iter())
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            body: body.into(),
        };
        handler(&self.world, &request)
    }

    /// `GET path` of `serve`: its status and JSON body.
    pub fn get(&self, path: &str) -> (u16, Value) {
        self.send("GET", path, "")
    }

    /// `method path` of `serve` with `body`: its status and JSON body.
    pub fn send(&self, method: &str, path: &str, body: &str) -> (u16, Value) {
        self.send_with(method, path, &[("Host", "127.0.0.1:42069")], body)
    }

    /// [`Setup::send`] with `headers` and no other.
    pub fn send_with(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> (u16, Value) {
        let Answer::Whole(response) = self.request_with(method, path, headers, body) else {
            panic!("{method} {path} answered with a stream");
        };
        let body = serde_json::from_slice(&response.body).unwrap_or_else(|e| {
            let body = String::from_utf8_lossy(&response.body);
            panic!("body is not JSON ({e}): {body}")
        });
        (response.status, body)
    }

    /// Open `serve`'s event stream: what each 10-second poll of it sends.
    pub fn events(&self) -> Events<'_> {
        let Answer::Events { every, poll } = self.request("GET", "/api/events", "") else {
            panic!("GET /api/events answered whole");
        };
        assert_eq!(every, Duration::from_secs(10));
        Events { t: self, poll }
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
