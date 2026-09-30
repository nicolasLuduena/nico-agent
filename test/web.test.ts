import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

describe("web Board", () => {
  test("lists the Ready issues of each Repo with title and link", async () => {
    const { cli, web, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addIssue("acme/api", { number: 7, title: "Add retries" });
    world.addIssue("acme/api", { number: 3, title: "Taken", assignees: ["alice"] });
    world.addIssue("acme/web", { number: 4, title: "Fix <header> & nav" });

    const { status, type, body } = await web("/");
    expect(status).toBe(200);
    expect(type).toBe("text/html; charset=utf-8");
    expect(body).toContain(
      [
        '<section class="repo">',
        "<h2>acme/api</h2>",
        "<ul>",
        '<li><a href="https://github.com/acme/api/issues/7">#7 Add retries</a></li>',
        "</ul>",
        "</section>",
        '<section class="repo">',
        "<h2>acme/web</h2>",
        "<ul>",
        '<li><a href="https://github.com/acme/web/issues/4">#4 Fix &lt;header&gt; &amp; nav</a></li>',
        "</ul>",
        "</section>",
      ].join("\n"),
    );
    expect(body).not.toContain("Taken");
  });

  test("says explicitly when no Repo is configured", async () => {
    const { web } = setup();
    const { status, body } = await web("/");
    expect(status).toBe(200);
    expect(body).toContain(
      '<p class="empty">No Repos configured. Run <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code> to add one.</p>',
    );
  });

  test("says explicitly when a Repo has no Ready issue, and shows a Repo that failed to load", async () => {
    const { cli, web, world } = setup();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    world.addClone("/src/web", "git@github.com:acme/web.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    await cli("repo", "add", "acme/web", "--path", "/src/web");
    world.addIssue("acme/api", { number: 1, labels: [] });
    world.failGitHub("acme/web", "not authenticated with GitHub; run `gh auth login`");

    const { status, body } = await web("/");
    expect(status).toBe(200);
    expect(body).toContain(
      [
        '<section class="repo">',
        "<h2>acme/api</h2>",
        '<p class="empty">No Ready issues.</p>',
        "</section>",
        '<section class="repo">',
        "<h2>acme/web</h2>",
        '<p class="error">Could not load: not authenticated with GitHub; run `gh auth login`</p>',
        "</section>",
      ].join("\n"),
    );
  });

  test("the page loads htmx from the app itself", async () => {
    const { web } = setup();
    expect((await web("/")).body).toContain('<script src="/htmx.min.js"></script>');
    const asset = await web("/htmx.min.js");
    expect(asset.status).toBe(200);
    expect(asset.type).toBe("text/javascript; charset=utf-8");
    expect(asset.body).toContain("htmx");
  });

  test("an unknown path is a 404 page", async () => {
    const { web, world } = setup();
    const { status, body } = await web("/nope");
    expect(status).toBe(404);
    expect(body).toContain('<p class="error">No page at /nope</p>');
    expect(world.calls).toEqual([]);
  });
});
