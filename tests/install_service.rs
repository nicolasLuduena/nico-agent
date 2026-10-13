//! `scripts/install-service.sh`, run with a temp HOME and fake `systemctl`,
//! `sudo` and `ollama` that log their arguments instead of touching the
//! system; the fake `systemctl --user cat` finds a unit only in the temp HOME.

mod common;

use std::fs;
use std::process::{Command, Stdio};

use common::Scratch;

const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/scripts/install-service.sh");

struct Sandbox {
    home: Scratch,
}

impl Sandbox {
    fn new() -> Self {
        let home = Scratch::new("service");
        fs::create_dir_all(home.join("fakebin")).unwrap();
        let units = home.join(".config/systemd/user");
        for (name, then) in [
            (
                "systemctl",
                format!(
                    "if [ \"$2\" = cat ]; then exec test -e '{}'/\"$3\"; fi",
                    units.display()
                ),
            ),
            ("sudo", String::new()),
            ("ollama", String::new()),
        ] {
            let stub = home.join("fakebin").join(name);
            let log = home.join(format!("{name}.log"));
            let script = format!("#!/bin/sh\necho \"$*\" >> '{}'\n{then}\n", log.display());
            fs::write(&stub, script).unwrap();
            Command::new("chmod").arg("+x").arg(&stub).status().unwrap();
        }
        Sandbox { home }
    }

    /// Run the script with `args`, answering its prompts with `stdin`: exit code and stderr.
    fn run(&self, args: &[&str], stdin: &str) -> (i32, String) {
        let mut child = Command::new("bash")
            .arg(SCRIPT)
            .args(args)
            .env_clear()
            .env("HOME", self.home.as_os_str())
            .env("USER", "nico")
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin", self.home.join("fakebin").display()),
            )
            .env("NICO_AGENT_BIN", "/opt/nico/bin/nico-agent")
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(stdin.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        (
            out.status.code().unwrap(),
            String::from_utf8(out.stderr).unwrap(),
        )
    }

    fn systemctl(&self) -> Vec<String> {
        self.log("systemctl")
    }

    /// What the fake `name` was called with, a line a call.
    fn log(&self, name: &str) -> Vec<String> {
        let log = fs::read_to_string(self.home.join(format!("{name}.log"))).unwrap_or_default();
        log.lines().map(String::from).collect()
    }

    fn units(&self) -> Vec<String> {
        let dir = self.home.join(".config/systemd/user");
        let Ok(entries) = fs::read_dir(dir) else {
            return vec![];
        };
        entries
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect()
    }

    fn unit(&self) -> String {
        fs::read_to_string(self.home.join(".config/systemd/user/nico-agent.service")).unwrap()
    }
}

#[test]
fn yes_installs_serve_as_a_user_service_that_always_restarts_and_prints_the_lingering_command() {
    let s = Sandbox::new();

    let (code, out) = s.run(&["--yes"], "");
    let first = s.unit();
    let (again, again_out) = s.run(&["--yes"], "");

    assert_eq!(code, 0, "{out}");
    let home = s.home.display();
    assert_eq!(
        first,
        format!(
            "[Unit]
Description=nico-agent serve: the loop

[Service]
Type=simple
Environment=\"PATH={home}/.local/share/mise/shims:/opt/nico/bin:{home}/.local/bin:/usr/local/bin:/usr/bin:/bin\"
ExecStart=/opt/nico/bin/nico-agent serve
Restart=always
RestartSec=5s

[Install]
WantedBy=default.target
"
        )
    );
    assert!(out.contains("loginctl enable-linger nico"), "{out}");
    assert_eq!(again, 0, "{again_out}");
    assert!(again_out.contains("unit unchanged"), "{again_out}");
    assert_eq!(s.unit(), first);
    assert_eq!(s.units(), ["nico-agent.service"]);
    assert_eq!(
        s.systemctl(),
        [
            "--user daemon-reload",
            "--user enable nico-agent.service",
            "--user restart nico-agent.service",
            "--user cat ollama.service",
            "--user enable nico-agent.service",
            "--user restart nico-agent.service",
            "--user cat ollama.service",
        ]
    );
    // With no unit of the user's own, the system's the package installs.
    assert_eq!(
        s.log("sudo"),
        [
            "systemctl enable --now ollama.service",
            "systemctl enable --now ollama.service"
        ]
    );
    assert_eq!(
        s.log("ollama"),
        ["pull nomic-embed-text", "pull nomic-embed-text"]
    );
}

#[test]
fn it_enables_the_users_own_ollama_unit_and_pulls_the_configured_embedding_model() {
    let s = Sandbox::new();
    let units = s.home.join(".config/systemd/user");
    fs::create_dir_all(&units).unwrap();
    fs::write(units.join("ollama.service"), "[Service]\n").unwrap();
    let config = s.home.join(".config/nico-agent");
    fs::create_dir_all(&config).unwrap();
    let toml = "[wiki]\nhour = 2\nembed_model = \"mxbai-embed-large\" # a bigger one\n";
    fs::write(config.join("config.toml"), toml).unwrap();

    let (code, out) = s.run(&["--yes"], "");

    assert_eq!(code, 0, "{out}");
    assert_eq!(
        s.systemctl()[3..],
        [
            "--user cat ollama.service",
            "--user enable --now ollama.service"
        ]
    );
    assert_eq!(s.log("sudo"), Vec::<String>::new());
    assert_eq!(s.log("ollama"), ["pull mxbai-embed-large"]);
}

#[test]
fn declining_leaves_everything_untouched() {
    let s = Sandbox::new();

    let (code, out) = s.run(&[], "n\n");

    assert_eq!(code, 0, "{out}");
    assert_eq!(s.units(), Vec::<String>::new());
    assert_eq!(s.systemctl(), Vec::<String>::new());
    assert_eq!(s.log("ollama"), Vec::<String>::new());
}

#[test]
fn remove_stops_the_service_and_deletes_its_unit() {
    let s = Sandbox::new();
    s.run(&["--yes"], "");

    let (code, out) = s.run(&["--remove", "--yes"], "");

    assert_eq!(code, 0, "{out}");
    assert_eq!(s.units(), Vec::<String>::new());
    assert_eq!(
        s.systemctl()[4..],
        [
            "--user disable --now nico-agent.service",
            "--user daemon-reload"
        ]
    );
}
