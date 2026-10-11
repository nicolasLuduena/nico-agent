use nico_agent::world::RealWorld;
use nico_agent::{Context, run};

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let config_dir = std::env::home_dir()
        .unwrap_or_default()
        .join(".config/nico-agent");
    let world = RealWorld {
        config_dir: config_dir.clone(),
    };
    let output = run(
        &argv,
        &Context {
            world: &world,
            config_dir,
        },
    );
    print!("{}", output.stdout);
    std::process::exit(output.exit_code);
}
