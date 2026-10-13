//! The file layer's append-only reader, which no command reads through yet.

mod common;

use std::fs;

use common::setup;
use nico_agent::state::read_json_lines;
use serde_json::{Value, json};

#[test]
fn a_torn_last_line_is_dropped_and_the_rest_read() {
    let t = setup();
    let file = t.config_dir.join("log.jsonl");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    let mut torn =
        b"{\"at\":1,\"what\":\"one\"}\n{\"at\":2,\"what\":\"two\"}\n{\"at\":3,\"wh".to_vec();
    torn.extend_from_slice(&"é".as_bytes()[..1]); // cut mid-character too
    fs::write(&file, torn).unwrap();

    let read: Vec<Value> = read_json_lines(&file).unwrap();

    assert_eq!(
        read,
        [
            json!({ "at": 1, "what": "one" }),
            json!({ "at": 2, "what": "two" })
        ]
    );
}

#[test]
fn a_missing_file_reads_empty_and_a_bad_line_before_the_last_is_an_error() {
    let t = setup();
    let file = t.config_dir.join("log.jsonl");
    assert_eq!(
        read_json_lines::<Value>(&file).unwrap(),
        Vec::<Value>::new()
    );

    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "{\"at\":1}\nnot json\n{\"at\":3}\n").unwrap();
    let error = read_json_lines::<Value>(&file).unwrap_err().to_string();
    assert!(error.contains("log.jsonl line 2:"), "{error}");
}
