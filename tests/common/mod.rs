//! The test harness: `setup()` gives a FakeWorld, a fresh config directory
//! and a `cli()` that runs the binary's library entry as the CLI would.
//! Tests assert on the command's output, `world.calls()` and the config files.
//! `Scratch` is the temp folder each test works in, removed when it ends.

// Each test binary uses a different part of the harness.
#![allow(dead_code)]

mod fake_world;

use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

pub use fake_world::*;
use nico_agent::world::{Answer, HttpRequest, Poll};
use nico_agent::{Context, run};
use serde_json::{Value, json};

/// Where the app reaches `serve`: its own host, on the default port.
pub const HOST: &str = "127.0.0.1:42069";

pub struct Setup {
    pub world: FakeWorld,
    /// Not created yet: commands create it when they first write.
    pub config_dir: PathBuf,
    /// The folder `config_dir` is in, removed when the Setup is dropped;
    /// `None` for a Setup on another's `config_dir`, which leaves it.
    pub root: Option<Scratch>,
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

/// The Library version `acme/kit@v1`, which a Repo links, and how a Repo
/// links it.
pub const KIT: &str = "acme/kit@v1";
pub const KIT_TOML: &str = "{ repo = \"acme/kit\", tag = \"v1\" }";

/// The Wiki of `KIT` built by `wiki build`, from its one file at its tag.
pub fn kit_built(t: &Setup) {
    t.world.add_clone("/mnt/agents-land/nico-agent-bucket", &[]);
    let origin = "https://github.com/acme/kit.git";
    (t.world).add_tree_file(origin, "refs/tags/v1", "lib.rs", "pub fn run() {}\n");
    let leaf = json!({ "kind": "leaf", "overview": "A small kit." });
    (t.world.headless.borrow_mut()).push((format!("## The part: {KIT}"), leaf.to_string()));
    let ran = t.cli(&["wiki", "build", KIT, "--json"]);
    assert_eq!(ran.exit_code, 0, "{}", ran.stdout);
}

/// Change the first Dispatch in `config_dir`'s dispatches.json, as another
/// process would.
pub fn edit_dispatch(config_dir: &Path, change: impl FnOnce(&mut Value)) {
    let file = config_dir.join("dispatches.json");
    let mut all: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    change(&mut all[0]);
    std::fs::write(&file, all.to_string()).unwrap();
}

/// A fresh folder `nico-agent-<name>-<pid>-<n>` in the temp directory,
/// removed when dropped; a failing test's is kept and its path printed.
pub struct Scratch(PathBuf);

impl Scratch {
    pub fn new(name: &str) -> Scratch {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "nico-agent-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Scratch(path)
    }
}

impl Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!("kept {}", self.0.display());
        } else {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

pub fn setup() -> Setup {
    let root = Scratch::new("test");
    Setup {
        world: FakeWorld::default(),
        config_dir: root.join("config"),
        root: Some(root),
    }
}

impl Setup {
    /// Run one tick of the loop: `serve` with its timer off, which ticks once.
    /// What it logged, a line per action, taken out of the log unstamped.
    /// The calls `serve` makes before its tick, its Readiness checks and its
    /// listen, are taken out too, and the read of GitHub's rate limits that
    /// ends every tick (`tests/rate_limit.rs` asserts it): only the tick's are left.
    pub fn tick(&self) -> Vec<String> {
        let runs = self.world.timer_runs.replace(0);
        let start = self.world.logged.borrow().len();
        let served = self.world.calls.borrow().len();
        let ran = self.cli(&["serve"]);
        let mut calls = self.world.calls.borrow_mut();
        let listen = (calls[served..].iter()).position(|c| c.starts_with("listen "));
        calls.drain(served..=served + listen.expect("serve listens"));
        calls.retain(|c| !c.ends_with("api rate_limit"));
        drop(calls);
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
        self.request_with(method, path, &[("Host", HOST)], body)
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
        self.send_with(method, path, &[("Host", HOST)], body)
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
