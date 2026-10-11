//! Builds the app in `web/` with Vite into `OUT_DIR/web`, and writes
//! `OUT_DIR/app.rs`: each built file as (path served at, Content-Type,
//! bytes), which `src/http.rs` embeds, so the binary serves it alone.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{env, fs, io};

fn main() {
    for input in [
        "web/src",
        "web/index.html",
        "web/package.json",
        "web/package-lock.json",
        "web/vite.config.ts",
    ] {
        println!("cargo::rerun-if-changed={input}");
    }
    let modified = |path: &str| fs::metadata(path).and_then(|m| m.modified()).ok();
    // npm notes what it installed in node_modules/.package-lock.json: missing, or older than the lock, is stale.
    if modified("web/node_modules/.package-lock.json") < modified("web/package-lock.json") {
        npm(&["ci"]);
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let dist = out.join("web");
    let dist_arg = dist.to_str().unwrap();
    npm(&["run", "build", "--", "--outDir", dist_arg, "--emptyOutDir"]);
    let mut files = vec![];
    walk(&dist, &mut files).unwrap();
    let rows: String = (files.iter())
        .map(|file| {
            let served = file.strip_prefix(&dist).unwrap().to_str().unwrap();
            let served = match served {
                "index.html" => "/".to_string(),
                path => format!("/{path}"),
            };
            let kind = match file.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("woff2") => "font/woff2",
                Some("svg") => "image/svg+xml",
                _ => "application/octet-stream",
            };
            format!("({served:?}, {kind:?}, include_bytes!({file:?})),\n")
        })
        .collect();
    fs::write(out.join("app.rs"), format!("&[\n{rows}]\n")).unwrap();
}

/// `npm <args>` in `web/`, its output kept off cargo's.
fn npm(args: &[&str]) {
    let status = Command::new("npm")
        .args(args)
        .current_dir("web")
        .stdout(Stdio::from(io::stderr()))
        .status()
        .unwrap_or_else(|e| {
            panic!("could not run npm, which builds the app in web/: {e}; install Node.js")
        });
    assert!(status.success(), "npm {} failed in web/", args.join(" "));
}

/// Every file under `dir`, into `files`.
fn walk(dir: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}
