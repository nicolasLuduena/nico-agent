use std::process::Command;

fn nico_agent(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_nico-agent"))
        .args(args)
        .output()
        .unwrap()
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
    let root = std::env::temp_dir().join(format!("nico-agent-binary-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let clone = root.join("api");
    std::fs::create_dir_all(clone.join("src")).unwrap();
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
    let (config_dir, bucket) = (root.join(".config/nico-agent"), root.join("bucket"));
    std::fs::create_dir_all(&config_dir).unwrap();
    let config = format!("[bucket]\npath = \"{}\"\n", bucket.display());
    std::fs::write(config_dir.join("config.toml"), config).unwrap();
    let repo_add = |path: &std::path::Path| {
        let ran = Command::new(env!("CARGO_BIN_EXE_nico-agent"))
            .args(["repo", "add", "acme/api", "--json", "--path"])
            .arg(path)
            .env("HOME", &root)
            .output()
            .unwrap();
        (ran.status.code(), String::from_utf8(ran.stdout).unwrap())
    };

    let (code, stdout) = repo_add(&clone.join("src"));
    assert_eq!(code, Some(1), "{stdout}");
    assert!(stdout.contains("is not a git clone"), "{stdout}");

    let (code, stdout) = repo_add(&clone);
    assert_eq!(code, Some(0), "{stdout}");
    let config = std::fs::read_to_string(config_dir.join("config.toml")).unwrap();
    assert!(
        config.contains(&format!("path = \"{}\"", clone.display())),
        "{config}"
    );
    assert!(bucket.join(".git").is_dir() && bucket.join("README.md").is_file());
}
