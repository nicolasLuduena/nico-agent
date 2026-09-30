import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("serve", () => {
  test("serves the web Board on 127.0.0.1:42069", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });

    const { stdout, exitCode } = await cli("serve");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      ['url: "http://127.0.0.1:42069/"', "help[1]:", "  Open the url in a browser to see the Board; stop the server with Ctrl-C", ""].join(
        "\n",
      ),
    );
    expect(world.calls).toContain("serve 127.0.0.1:42069");

    const response = await world.server!.handler(new Request("http://127.0.0.1:42069/"));
    expect(await response.text()).toContain('<a href="https://github.com/acme/api/issues/7">#7 Add retries</a>');
  });

  test("--port overrides the port", async () => {
    const { cli, world } = setup();
    const { stdout, exitCode } = await cli("serve", "--port", "8080");
    expect(exitCode).toBe(0);
    expect(stdout).toStartWith('url: "http://127.0.0.1:8080/"\n');
    expect(world.calls).toEqual(["serve 127.0.0.1:8080"]);
  });

  test("a port that is not a number from 1 to 65535 is a usage error", async () => {
    const { cli, world } = setup();
    for (const port of ["http", "0", "70000", "80.5"]) {
      const { stdout, exitCode } = await cli("serve", "--port", port);
      expect(exitCode).toBe(2);
      expect(stdout).toBe(
        [`error: the port must be a number from 1 to 65535 (got \`${port}\`)`, "help[1]:", "  Usage: `nico-agent serve [--port <port>]`", ""].join("\n"),
      );
    }
    expect(world.calls).toEqual([]);
  });

  test("a port already in use is an error suggesting another port", async () => {
    const { cli, world } = setup();
    world.failServe("port 42069 is already in use");
    const { stdout, exitCode } = await cli("serve");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      ["error: port 42069 is already in use", "help[1]:", "  Run `nico-agent serve --port <port>` with a free port", ""].join("\n"),
    );
  });
});
