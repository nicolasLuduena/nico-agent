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
