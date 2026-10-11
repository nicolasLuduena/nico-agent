//! `scripts/setup-tunnel.sh`, the wizard, run with a temp HOME, its answers
//! on stdin, and fake `cloudflared`, `systemctl`, `curl` and `wslview`
//! that log their arguments instead of touching Cloudflare or systemd. The
//! real binary checks the config it writes.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};

const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/scripts/setup-tunnel.sh");
const TUNNEL_ID: &str = "6ff42ae2-765d-4adf-8112-31c55c1551ef";

/// Every prompt of a first run, in order, as the user answers it.
const FIRST_RUN: &str = "\n\n\nnico.example.com\nnico@example.com\ny\n\n\ny\ny\ny\ny\n\n\ny\ny\n";
/// A re-run: Enter keeps the hostname and email, nothing asks to be written.
const RERUN: &str = "\n\n\n\n\n\n\ny\ny\n\n\ny\n";

struct Sandbox {
    home: PathBuf,
}

impl Sandbox {
    fn new(config: Option<&str>) -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let home = std::env::temp_dir().join(format!(
            "nico-agent-tunnel-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("fakebin")).unwrap();
        let log = home.join("calls.log");
        let log = log.display();
        let fakes = [
            ("systemctl", String::new()),
            // open_url's first choice, so no browser opens.
            ("wslview", String::new()),
            (
                "curl",
                "printf '302 https://nico.cloudflareaccess.com/cdn-cgi/access/login/nico.example.com'"
                    .into(),
            ),
            (
                "cloudflared",
                format!(
                    "case \"$1 $2\" in\n\
                     '--version ') echo 'cloudflared version 2026.8.3' ;;\n\
                     'tunnel login') mkdir -p \"$HOME/.cloudflared\" && : > \"$HOME/.cloudflared/cert.pem\" ;;\n\
                     'tunnel create') echo '{{\"AccountTag\":\"acct\",\"TunnelSecret\":\"c2VjcmV0\",\"TunnelID\":\"{TUNNEL_ID}\"}}' > \"$4\" ;;\n\
                     esac"
                ),
            ),
        ];
        for (name, then) in fakes {
            let fake = home.join("fakebin").join(name);
            fs::write(
                &fake,
                format!("#!/bin/sh\necho \"{name} $*\" >> '{log}'\n{then}\n"),
            )
            .unwrap();
            Command::new("chmod").arg("+x").arg(&fake).status().unwrap();
        }
        if let Some(config) = config {
            fs::create_dir_all(home.join(".config/nico-agent")).unwrap();
            fs::write(home.join(".config/nico-agent/config.toml"), config).unwrap();
        }
        Sandbox { home }
    }

    /// Run the wizard answering its prompts with `stdin`: exit code and everything it printed.
    fn run(&self, stdin: &str) -> (i32, String) {
        let mut child = Command::new("bash")
            .arg(SCRIPT)
            .env_clear()
            .env("HOME", &self.home)
            .env("USER", "nico")
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin", self.home.join("fakebin").display()),
            )
            .env("NICO_AGENT_BIN", env!("CARGO_BIN_EXE_nico-agent"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
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
        let printed =
            String::from_utf8(out.stdout).unwrap() + &String::from_utf8(out.stderr).unwrap();
        (out.status.code().unwrap(), printed)
    }

    /// The calls the fakes logged since the last look.
    fn calls(&self) -> Vec<String> {
        let log = self.home.join("calls.log");
        let calls = fs::read_to_string(&log).unwrap_or_default();
        let _ = fs::remove_file(log);
        calls.lines().map(String::from).collect()
    }

    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.home.join(path)).unwrap()
    }
}

#[test]
fn a_first_run_writes_the_unit_and_bucket_url_and_a_rerun_rewrites_nothing_and_restarts_once() {
    let config =
        "# the loop\ntick_minutes = 15\n\n[repos.\"acme/api\"]\npath = \"/src/api\" # the clone\n";
    let s = Sandbox::new(Some(config));
    let home = s.home.display();

    let (code, out) = s.run(FIRST_RUN);
    let first_calls = s.calls();
    let (unit, ingress) = (
        s.read(".config/systemd/user/nico-agent-tunnel.service"),
        s.read(".cloudflared/nico-agent.yml"),
    );
    let (again, again_out) = s.run(RERUN);

    assert_eq!(code, 0, "{out}");
    assert_eq!(
        unit,
        format!(
            "[Unit]
Description=nico-agent tunnel: serve behind Cloudflare Access

[Service]
Type=simple
ExecStart={home}/fakebin/cloudflared tunnel --no-autoupdate --config {home}/.cloudflared/nico-agent.yml run
Restart=always
RestartSec=5s

[Install]
WantedBy=default.target
"
        )
    );
    assert_eq!(
        ingress,
        format!(
            "tunnel: {TUNNEL_ID}
credentials-file: {home}/.cloudflared/nico-agent.json
ingress:
  - hostname: nico.example.com
    service: http://127.0.0.1:42069
  - service: http_status:404
"
        )
    );
    assert_eq!(
        s.read(".config/nico-agent/config.toml"),
        format!("{config}\n[bucket]\nurl = \"https://nico.example.com\"\n")
    );
    let curl = "curl -s -o /dev/null --max-time 20 -H Accept: text/html -w %{http_code} %{redirect_url} https://nico.example.com/";
    let route = format!("cloudflared tunnel route dns {TUNNEL_ID} nico.example.com");
    assert_eq!(
        first_calls,
        [
            "cloudflared --version",
            "cloudflared tunnel login",
            &format!(
                "cloudflared tunnel create --cred-file {home}/.cloudflared/nico-agent.json nico-agent"
            ),
            "wslview https://one.dash.cloudflare.com/",
            "systemctl --user daemon-reload",
            "systemctl --user enable nico-agent-tunnel.service",
            "systemctl --user restart nico-agent-tunnel.service",
            &route,
            curl,
        ]
    );

    assert_eq!(again, 0, "{again_out}");
    assert!(
        again_out.contains("unchanged: bucket.url is https://nico.example.com already"),
        "{again_out}"
    );
    assert_eq!(
        s.read(".config/systemd/user/nico-agent-tunnel.service"),
        unit
    );
    assert_eq!(s.read(".cloudflared/nico-agent.yml"), ingress);
    assert_eq!(
        s.read(".config/nico-agent/config.toml"),
        format!("{config}\n[bucket]\nurl = \"https://nico.example.com\"\n")
    );
    assert_eq!(
        s.calls(),
        [
            "cloudflared --version",
            "wslview https://one.dash.cloudflare.com/",
            "systemctl --user enable nico-agent-tunnel.service",
            "systemctl --user restart nico-agent-tunnel.service",
            &route,
            curl,
        ]
    );
}

#[test]
fn bucket_url_replaces_the_one_in_the_bucket_table_and_keeps_every_other_line() {
    let s = Sandbox::new(Some(
        "[bucket] # Evidence\n# kept\npath = \"/data/bucket\"\nurl = \"https://old.example.com\"\n\n[repos.\"acme/api\"]\npath = \"/src/api\"\n",
    ));

    let (code, out) = s.run(FIRST_RUN);

    assert_eq!(code, 0, "{out}");
    assert_eq!(
        s.read(".config/nico-agent/config.toml"),
        "[bucket] # Evidence\n# kept\npath = \"/data/bucket\"\nurl = \"https://nico.example.com\"\n\n[repos.\"acme/api\"]\npath = \"/src/api\"\n"
    );
}

#[test]
fn a_hostname_that_does_not_send_a_stranger_to_access_stops_the_tunnel() {
    let s = Sandbox::new(None);
    fs::write(
        s.home.join("fakebin/curl"),
        format!(
            "#!/bin/sh\necho \"curl $*\" >> '{}/calls.log'\nprintf '200 '\n",
            s.home.display()
        ),
    )
    .unwrap();

    let (code, out) = s.run(FIRST_RUN);

    assert_eq!(code, 1, "{out}");
    assert!(
        out.contains("answered \"200 \", not with the Access login"),
        "{out}"
    );
    assert_eq!(
        s.calls().last().map(String::as_str),
        Some("systemctl --user stop nico-agent-tunnel.service")
    );
    assert!(!s.home.join(".config/nico-agent/config.toml").exists());
}

#[test]
fn a_config_nico_agent_would_refuse_is_left_as_it_was() {
    // A quoted table name the edit does not see, so its [bucket] would be a second one.
    let config = "[\"bucket\"]\npath = \"/data/bucket\"\n";
    let s = Sandbox::new(Some(config));

    let (code, out) = s.run(FIRST_RUN);

    assert_eq!(code, 1, "{out}");
    assert!(out.contains("nico-agent refuses the new config"), "{out}");
    assert_eq!(s.read(".config/nico-agent/config.toml"), config);
    assert!(!s.home.join(".config/nico-agent/config.toml.tmp").exists());
}
