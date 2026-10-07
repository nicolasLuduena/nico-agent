import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/install-board-service.sh");

/** A temp HOME with a fake `systemctl` that logs its arguments instead of touching systemd. */
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "nico-board-"));
  const bin = join(home, "fakebin");
  mkdirSync(bin);
  const log = join(home, "systemctl.log");
  writeFileSync(join(bin, "systemctl"), `#!/usr/bin/env bash\necho "$*" >> "${log}"\n`);
  chmodSync(join(bin, "systemctl"), 0o755);
  const unitDir = join(home, ".config/systemd/user");
  const run = (args: string[], stdin = "", env: Record<string, string> = {}) => {
    const proc = Bun.spawnSync(["bash", SCRIPT, ...args], {
      env: {
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        NICO_AGENT_BIN: "/opt/nico/bin/nico-agent",
        ...env,
      },
      stdin: new TextEncoder().encode(stdin),
    });
    return { exitCode: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const unit = () => readFileSync(join(unitDir, "nico-agent-board.service"), "utf8");
  return { home, unitDir, run, calls, unit };
}

describe("scripts/install-board-service.sh", () => {
  test("--yes installs a long-running service for the Board, enables it at login and starts it", () => {
    const { run, calls, unit } = sandbox();

    const { exitCode, out } = run(["--yes"]);
    expect(exitCode, out).toBe(0);

    expect(unit()).toContain("ExecStart=/opt/nico/bin/nico-agent serve --port 42069");
    expect(unit()).toContain("Type=simple");
    expect(unit()).toContain("Restart=on-failure");
    expect(unit()).toContain("WantedBy=default.target");
    expect(calls()).toEqual([
      "--user daemon-reload",
      "--user enable nico-agent-board.service",
      "--user restart nico-agent-board.service",
    ]);
  });

  test("NICO_AGENT_PORT picks the port", () => {
    const { run, unit } = sandbox();
    run(["--yes"], "", { NICO_AGENT_PORT: "8080" });
    expect(unit()).toContain("ExecStart=/opt/nico/bin/nico-agent serve --port 8080");
  });

  test("the service puts mise's shims first on PATH", () => {
    const { home, run, unit } = sandbox();
    run(["--yes"]);
    const path = unit().match(/^Environment="?PATH=([^"\n]*)"?$/m)?.[1];
    expect(path?.split(":")[0]).toBe(join(home, ".local/share/mise/shims"));
  });

  test("running it again is safe: same unit, one service", () => {
    const { unitDir, run, unit } = sandbox();
    run(["--yes"]);
    const first = unit();

    const again = run(["--yes"]);
    expect(again.exitCode, again.out).toBe(0);
    expect(unit()).toEqual(first);
    expect(readdirSync(unitDir)).toEqual(["nico-agent-board.service"]);
    expect(again.out).toContain("unchanged");
  });

  test("without --yes, declining leaves everything untouched", () => {
    const { unitDir, run, calls } = sandbox();
    const { exitCode } = run([], "n\nn\n");
    expect(exitCode).toBe(0);
    expect(existsSync(unitDir) ? readdirSync(unitDir) : []).toEqual([]);
    expect(calls()).toEqual([]);
  });

  test("--remove --yes stops the service and deletes its unit", () => {
    const { unitDir, run, calls } = sandbox();
    run(["--yes"]);
    const { exitCode, out } = run(["--remove", "--yes"]);
    expect(exitCode, out).toBe(0);
    expect(readdirSync(unitDir)).toEqual([]);
    expect(calls().slice(3)).toEqual(["--user disable --now nico-agent-board.service", "--user daemon-reload"]);
  });
});
