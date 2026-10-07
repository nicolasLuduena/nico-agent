import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/install-timer.sh");

/** A temp HOME with a fake `systemctl` that logs its arguments instead of touching systemd. */
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "nico-timer-"));
  const bin = join(home, "fakebin");
  mkdirSync(bin);
  const log = join(home, "systemctl.log");
  writeFileSync(join(bin, "systemctl"), `#!/usr/bin/env bash\necho "$*" >> "${log}"\n`);
  chmodSync(join(bin, "systemctl"), 0o755);
  const unitDir = join(home, ".config/systemd/user");
  const run = (args: string[], stdin = "") => {
    const proc = Bun.spawnSync(["bash", SCRIPT, ...args], {
      env: {
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        NICO_AGENT_BIN: "/opt/nico/bin/nico-agent",
      },
      stdin: new TextEncoder().encode(stdin),
    });
    return { exitCode: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const unit = (name: string) => readFileSync(join(unitDir, name), "utf8");
  return { home, unitDir, run, calls, unit };
}

describe("scripts/install-timer.sh", () => {
  test("--yes installs a service running advance and a 10-minute timer, then enables the timer", () => {
    const { run, calls, unit } = sandbox();

    const { exitCode, out } = run(["--yes"]);
    expect(exitCode, out).toBe(0);

    const service = unit("nico-agent-advance.service");
    expect(service).toContain("ExecStart=/opt/nico/bin/nico-agent advance");
    expect(service).toContain("Type=oneshot");
    const timer = unit("nico-agent-advance.timer");
    expect(timer).toContain("OnCalendar=*:0/10");
    expect(timer).toContain("Unit=nico-agent-advance.service");
    expect(timer).toContain("WantedBy=timers.target");
    expect(calls()).toEqual(["--user daemon-reload", "--user enable --now nico-agent-advance.timer"]);
  });

  test("the service puts mise's shims first on PATH", () => {
    const { home, run, unit } = sandbox();
    run(["--yes"]);
    const path = unit("nico-agent-advance.service").match(/^Environment="?PATH=([^"\n]*)"?$/m)?.[1];
    expect(path?.split(":")[0]).toBe(join(home, ".local/share/mise/shims"));
    expect(path?.split(":")).toContain("/opt/nico/bin");
  });

  test("running it again is safe: same units, still one timer", () => {
    const { unitDir, run, unit } = sandbox();
    run(["--yes"]);
    const first = [unit("nico-agent-advance.service"), unit("nico-agent-advance.timer")];

    const again = run(["--yes"]);
    expect(again.exitCode, again.out).toBe(0);
    expect([unit("nico-agent-advance.service"), unit("nico-agent-advance.timer")]).toEqual(first);
    expect(readdirSync(unitDir).sort()).toEqual(["nico-agent-advance.service", "nico-agent-advance.timer"]);
    expect(again.out).toContain("unchanged");
  });

  test("without --yes, declining leaves everything untouched", () => {
    const { unitDir, run, calls } = sandbox();
    const { exitCode } = run([], "n\nn\nn\n");
    expect(exitCode).toBe(0);
    expect(existsSync(unitDir) ? readdirSync(unitDir) : []).toEqual([]);
    expect(calls()).toEqual([]);
  });

  test("without --yes, answering yes installs", () => {
    const { run, calls, unit } = sandbox();
    const { exitCode, out } = run([], "y\ny\n");
    expect(exitCode, out).toBe(0);
    expect(unit("nico-agent-advance.timer")).toContain("OnCalendar=*:0/10");
    expect(calls()).toContain("--user enable --now nico-agent-advance.timer");
  });

  test("--remove --yes disables the timer and deletes both units", () => {
    const { unitDir, run, calls } = sandbox();
    run(["--yes"]);
    const { exitCode, out } = run(["--remove", "--yes"]);
    expect(exitCode, out).toBe(0);
    expect(readdirSync(unitDir)).toEqual([]);
    expect(calls().slice(2)).toEqual(["--user disable --now nico-agent-advance.timer", "--user daemon-reload"]);
  });
});
