import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("repo add", () => {
  test("rejects a path that is not a git clone", async () => {
    const { cli } = setup();
    const { stdout, exitCode } = await cli("repo", "add", "acme/api", "--path", "/src/nothing");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: /src/nothing is not a git clone",
        "help[1]:",
        "  Run `git clone https://github.com/acme/api /src/nothing` first, or pass the path of an existing clone",
        "",
      ].join("\n"),
    );
  });

  test("rejects a clone whose remotes point at another repo", async () => {
    const { cli, world } = setup();
    world.addClone("/src/web", "git@github.com:acme/web.git");
    const { stdout, exitCode } = await cli("repo", "add", "acme/api", "--path", "/src/web");
    expect(exitCode).toBe(1);
    expect(stdout).toBe(
      [
        "error: /src/web is not a clone of acme/api",
        "remotes[1]: \"git@github.com:acme/web.git\"",
        "help[1]:",
        "  Run `nico-agent repo add <owner/name> --path /src/web` with the slug its remote points at",
        "",
      ].join("\n"),
    );
  });

  test("adds a clone of the slug and lists it", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "https://github.com/Acme/API.git");
    const added = await cli("repo", "add", "acme/api", "--path", "/src/api");
    expect(added.exitCode).toBe(0);
    expect(added.stdout).toBe(
      [
        "repo: acme/api added",
        "path: /src/api",
        "help[2]:",
        "  Run `nico-agent` to see the Board",
        "  Run `nico-agent repo list` to see all Repos",
        "",
      ].join("\n"),
    );
    const listed = await cli("repo", "list");
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toBe(
      [
        "count: 1",
        "repos[1]{slug,path}:",
        "  acme/api,/src/api",
        "help[2]:",
        "  Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo",
        "  Run `nico-agent repo rm <owner/name>` to remove one",
        "",
      ].join("\n"),
    );
  });

  test("re-adding the same Repo is a no-op; a new path replaces the old one", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    world.addClone("/work/api", "git@github.com:acme/api");
    await cli("repo", "add", "acme/api", "--path", "/src/api");

    const again = await cli("repo", "add", "acme/api", "--path", "/src/api");
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toStartWith("repo: acme/api already added (no-op)\npath: /src/api\n");

    const moved = await cli("repo", "add", "ACME/api", "--path", "/work/api");
    expect(moved.exitCode).toBe(0);
    expect(moved.stdout).toStartWith("repo: acme/api path updated\npath: /work/api\n");
    expect((await cli("repo", "list", "--json")).json().repos).toEqual([{ slug: "acme/api", path: "/work/api" }]);
  });
});

describe("repo rm", () => {
  test("removes a Repo, and removing it again is a no-op", async () => {
    const { cli, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");

    const removed = await cli("repo", "rm", "acme/api");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toStartWith("repo: acme/api removed\n");
    const again = await cli("repo", "rm", "acme/api");
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toStartWith("repo: acme/api not configured (no-op)\n");

    expect((await cli("repo", "list")).stdout).toBe(
      ["repos: 0 configured", "help[1]:", "  Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo", ""].join("\n"),
    );
  });
});
