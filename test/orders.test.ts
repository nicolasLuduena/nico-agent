import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("orders", () => {
  test("with none in config, shows the five Standing orders at their defaults: review and close on", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("orders");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "orders[5]{order,state,lets}:",
        "  start,off,the Lead queue and start Specs (the Repo's room still caps it)",
        "  answer,off,the Lead answer an Asking Implementer in its own words",
        "  review,on,the Lead launch Reviewers",
        "  close,on,the Lead Close Dispatches whose PR is ready",
        "  write,off,the Lead write Specs and tickets to a Source",
        "help[1]:",
        "  Run `nico-agent orders set <order> on|off` to change one",
        "",
      ].join("\n"),
    );
    expect(world.calls).toEqual([]);
  });

  test("--json gives each order as a boolean", async () => {
    const { cli } = setup();
    const { json, exitCode } = await cli("orders", "--json");
    expect(exitCode).toBe(0);
    expect(json().orders).toEqual({ start: false, answer: false, review: true, close: true, write: false });
  });
});

describe("orders set", () => {
  test("turning an order on persists it, and setting it again is a no-op", async () => {
    const { cli } = setup();
    const set = await cli("orders", "set", "start", "on");
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toBe(["order: start on", "help[1]:", "  Run `nico-agent orders` to see every Standing order", ""].join("\n"));
    expect((await cli("orders", "--json")).json().orders).toEqual({ start: true, answer: false, review: true, close: true, write: false });

    const again = await cli("orders", "set", "start", "on");
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toStartWith("order: start already on (no-op)\n");

    const off = await cli("orders", "set", "review", "off");
    expect(off.stdout).toStartWith("order: review off\n");
    expect((await cli("orders", "--json")).json().orders).toEqual({ start: true, answer: false, review: false, close: true, write: false });
  });

  test("an unknown order is refused with the orders there are", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("orders", "set", "nope", "on");
    expect(exitCode).toBe(2);
    expect(stdout).toBe(
      [
        "error: `nope` is not a Standing order",
        "help[2]:",
        "  Standing orders: start, answer, review, close, write",
        "  Usage: `nico-agent orders set <order> on|off`",
        "",
      ].join("\n"),
    );
    expect((await cli("orders", "--json")).json().orders.start).toBe(false);
  });

  test("a value other than on or off is refused", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("orders", "set", "start", "maybe");
    expect(exitCode).toBe(2);
    expect(stdout).toBe(
      ["error: `maybe` is not on or off", "help[1]:", "  Usage: `nico-agent orders set <order> on|off`", ""].join("\n"),
    );
    expect((await cli("orders", "--json")).json().orders.start).toBe(false);
  });

  test("a missing order or value is refused with the usage", async () => {
    const { cli } = setup();
    expect(await cli("orders", "set", "start")).toMatchObject({
      stdout: ["error: <on|off> is required", "help[1]:", "  Usage: `nico-agent orders set <order> on|off`", ""].join("\n"),
      exitCode: 2,
    });
    expect((await cli("orders", "set")).stdout).toStartWith("error: <order> is required\n");
  });
});

describe("Standing orders in config", () => {
  test("are read fresh on every use, so a change by hand shows without a restart", async () => {
    const { cli, configDir } = setup();
    expect((await cli("orders", "--json")).json().orders.write).toBe(false);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ repos: [], orders: { write: true, close: false } }));
    expect((await cli("orders", "--json")).json().orders).toEqual({ start: false, answer: false, review: true, close: false, write: true });
  });

  test("setting one keeps the rest of the config", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    await cli("orders", "set", "answer", "on");
    expect((await cli("repo", "list", "--json")).json().repos).toEqual([{ slug: "acme/api", path: "/src/api" }]);
  });

  test("an unknown order or a non-boolean in config is a config error", async () => {
    const { cli, configDir } = setup();
    mkdirSync(configDir, { recursive: true });
    const file = join(configDir, "config.json");
    writeFileSync(file, JSON.stringify({ repos: [], orders: { merge: true } }));
    const unknown = await cli("orders", "--json");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.json()).toEqual({ error: `${file}: orders.merge is not a Standing order`, help: ["Standing orders: start, answer, review, close, write"] });
    writeFileSync(file, JSON.stringify({ repos: [], orders: { start: "on" } }));
    expect((await cli("orders", "--json")).json().error).toBe(`${file}: orders.start is not true or false`);
  });
});
