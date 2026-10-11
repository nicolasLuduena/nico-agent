mod common;

use common::FakeWorld;
use nico_agent::world::{World, WorldError};

#[test]
fn the_fake_records_every_call_in_order_and_fails_the_ones_told_to() {
    let world = FakeWorld::default();
    world.fail_call("herdr agent start", "agent_start_failed: no such kind");

    let worktree = world
        .herdr_worktree_create("/src/api", "agent/7", "main", "api#7")
        .unwrap();
    let tab = world
        .herdr_tab_create(&worktree.workspace, &worktree.path, "implementer")
        .unwrap();
    let started = world.herdr_agent_start(
        "api-7",
        "claude",
        &tab.pane,
        &["--model".into(), "opus".into()],
    );

    assert_eq!(
        started,
        Err(WorldError("agent_start_failed: no such kind".into()))
    );
    assert_eq!(
        world.calls(),
        [
            "herdr worktree create --cwd /src/api --branch agent/7 --base main --label api#7 --no-focus",
            "herdr tab create --workspace w1 --cwd /worktrees/7 --label implementer --no-focus",
            "herdr agent start api-7 --kind claude --pane w1:p2 -- --model opus",
        ]
    );
}
