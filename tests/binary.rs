use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{Value, json};

fn nico_agent(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_nico-agent"))
        .args(args)
        .output()
        .unwrap()
}

/// A scratch HOME holding `api/`, a git clone of acme/api, and a config whose
/// Bucket is `bucket/`.
fn home(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("nico-agent-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let clone = root.join("api");
    fs::create_dir_all(clone.join("src")).unwrap();
    let git = |args: &[&str]| {
        let ran = Command::new("git")
            .arg("-C")
            .arg(&clone)
            .args(args)
            .output()
            .unwrap();
        assert!(ran.status.success(), "git {args:?}");
    };
    git(&["init", "-q"]);
    git(&["remote", "add", "origin", "git@github.com:acme/api.git"]);
    let config_dir = root.join(".config/nico-agent");
    fs::create_dir_all(&config_dir).unwrap();
    let config = format!("[bucket]\npath = \"{}\"\n", root.join("bucket").display());
    fs::write(config_dir.join("config.toml"), config).unwrap();
    root
}

/// The binary run with `args` in `home`, its `stubs/` first on `PATH`: exit
/// code and stdout.
fn run(home: &Path, args: &[&str]) -> (Option<i32>, String) {
    let path = std::env::var("PATH").unwrap();
    let ran = Command::new(env!("CARGO_BIN_EXE_nico-agent"))
        .args(args)
        .env("HOME", home)
        .env("PATH", format!("{}:{path}", home.join("stubs").display()))
        .env("LINEAR_API_KEY", "lin_api_stub")
        .output()
        .unwrap();
    (ran.status.code(), String::from_utf8(ran.stdout).unwrap())
}

/// `status --json` of acme/api, which reads Linear's team BLE too, with `gh`
/// and `curl` the given shell scripts.
fn status_with(name: &str, gh: &str, curl: &str) -> Value {
    let home = home(name);
    fs::create_dir_all(home.join("stubs")).unwrap();
    for (bin, script) in [("gh", gh), ("curl", curl)] {
        let stub = home.join("stubs").join(bin);
        fs::write(&stub, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&stub, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let api = home.join("api");
    let api = api.to_str().unwrap();
    let add = [
        "repo",
        "add",
        "acme/api",
        "--json",
        "--linear-team",
        "BLE",
        "--path",
        api,
    ];
    let (code, stdout) = run(&home, &add);
    assert_eq!(code, Some(0), "{stdout}");
    let (code, stdout) = run(&home, &["status", "--json"]);
    assert_eq!(code, Some(0), "{stdout}");
    serde_json::from_str(&stdout).unwrap()
}

#[test]
fn the_binary_prints_the_answer_and_exits_with_its_code() {
    let version = nico_agent(&["--version", "--json"]);
    assert_eq!(version.status.code(), Some(0));
    assert_eq!(
        String::from_utf8(version.stdout).unwrap(),
        "{\"version\":\"0.1.0\"}\n"
    );

    assert_eq!(nico_agent(&["frobnicate"]).status.code(), Some(2));
}

#[test]
fn repo_add_reads_a_real_clone_s_remotes() {
    let root = home("binary");
    let clone = root.join("api");
    let repo_add = |path: &Path| {
        let path = path.to_str().unwrap();
        run(
            &root,
            &["repo", "add", "acme/api", "--json", "--path", path],
        )
    };

    let (code, stdout) = repo_add(&clone.join("src"));
    assert_eq!(code, Some(1), "{stdout}");
    assert!(stdout.contains("is not a git clone"), "{stdout}");

    let (code, stdout) = repo_add(&clone);
    assert_eq!(code, Some(0), "{stdout}");
    let config = fs::read_to_string(root.join(".config/nico-agent/config.toml")).unwrap();
    assert!(
        config.contains(&format!("path = \"{}\"", clone.display())),
        "{config}"
    );
    let bucket = root.join("bucket");
    assert!(bucket.join(".git").is_dir() && bucket.join("README.md").is_file());
}

/// `curl` answering Linear's refusal for its rate limit, per
/// linear.app/developers/rate-limiting: the head (`HEADERS` and the status
/// line) only for `--dump-header -`, the status only as `--write-out` asks.
const LINEAR_LIMITED: &str = r#"cat > /dev/null
for arg; do
  case "$flag" in
    --dump-header) [ "$arg" = - ] && printf 'HTTP/2 400\r\nHEADERS\r\n' ;;
    --write-out) out=$arg ;;
  esac
  flag=$arg
done
printf '%s' '{"errors":[{"message":"Rate limit exceeded","extensions":{"code":"RATELIMITED"}}]}'
printf '%s' "$out" | sed 's/%{http_code}/400/'"#;

#[test]
fn github_refusing_for_its_rate_limit_pauses_it_till_the_spent_limit_resets() {
    // As `gh` words a spent limit. `gh api rate_limit` costs none, so it
    // answers: core spent till 2100-01-01, graphql with some left till 2101.
    let gh = r#"if [ "$*" = "api rate_limit" ]; then
  echo '{"resources":{"core":{"remaining":0,"reset":4102444800},"graphql":{"remaining":4999,"reset":4133980800}}}'
else
  echo 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' >&2
  exit 1
fi"#;

    // `curl` is never run: GitHub, read first, refuses.
    let status = status_with("github-limit", gh, "exit 7");

    assert_eq!(
        status["sources"],
        json!({
            "github": { "paused_until": "2100-01-01T00:00:00Z" },
            "linear": { "paused_until": null },
        })
    );
}

#[test]
fn linear_refusing_for_its_rate_limit_pauses_it_till_the_spent_limit_resets() {
    let gh = r#"case "$*" in
  "api user --jq .login") echo nico ;;
  *) echo '{"data":{"repository":{"issues":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}' ;;
esac"#;
    let limits = ["requests", "endpoint-requests", "complexity"];
    for spent in limits {
        // The spent limit resets 2101-01-01 (in ms); the others, with some left, in 2102.
        let headers: String = (limits.iter())
            .map(|limit| {
                let (left, reset) = match *limit == spent {
                    true => (0, 4133980800000_u64),
                    false => (1, 4165516800000),
                };
                format!("x-ratelimit-{limit}-remaining: {left}\\r\\nx-ratelimit-{limit}-reset: {reset}\\r\\n")
            })
            .collect();
        let curl = LINEAR_LIMITED.replace("HEADERS", &headers);

        let status = status_with(&format!("linear-{spent}"), gh, &curl);

        assert_eq!(
            status["sources"],
            json!({
                "github": { "paused_until": null },
                "linear": { "paused_until": "2101-01-01T00:00:00Z" },
            }),
            "{spent}"
        );
    }
}
