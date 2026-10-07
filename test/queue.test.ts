import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { webHandler } from "../src/web";
import { setup } from "./harness";

/** A Repo claiming Linear team BLE, with the Scheduler defaults set. */
async function linearRepo(repo: Record<string, unknown> = {}) {
  const ctx = setup();
  ctx.world.addClone("/src/pdf", "git@github.com:bleentr/pdf-diff.git");
  await ctx.cli("repo", "add", "bleentr/pdf-diff", "--path", "/src/pdf", "--linear-team", "BLE");
  const file = join(ctx.configDir, "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.scheduler = { harness: "claude", model: "opus", effort: "high" };
  config.repos[0] = { ...config.repos[0], ...repo };
  writeFileSync(file, JSON.stringify(config));
  ctx.world.calls.length = 0;
  return { ...ctx, queue: (spec: string, repo = "bleentr/pdf-diff") => post(ctx.web, "/queue", { repo, spec }) };
}

type Web = ReturnType<typeof setup>["web"];

/** A Board POST as htmx sends it. */
function post(web: Web, path: string, fields: Record<string, string>) {
  return web(path, { method: "POST", body: new URLSearchParams(fields), headers: { "hx-request": "true" } });
}

/** `result issue` for each row of an `advance --json` run. */
async function advanced(cli: ReturnType<typeof setup>["cli"]) {
  return (await cli("advance", "--json")).json().specs.map((s: { result: string; issue: string }) => `${s.result} ${s.issue}`);
}

describe("the Queue fills a Repo's room", () => {
  test("advance starts the head of the Repo's Queue, saying it came from the Queue, and the started Spec leaves the Queue", async () => {
    const { cli, world, queue, web } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" }, { identifier: "BLE-21" }, { identifier: "BLE-22" });
    expect((await queue("BLE-20")).status).toBe(200);

    const { exitCode, json } = await cli("advance", "--json");
    expect(exitCode).toBe(0);
    expect(json().specs).toEqual([{
      spec: "BLE-20", repo: "bleentr/pdf-diff", result: "started", issue: "BLE-21",
      reason: "BLE-20 is the head of the Queue; BLE-21 is the first unblocked issue of BLE-20; the Spec has no open PR, so it starts from main",
    }]);
    expect(world.calls).toContain("herdr worktree create --cwd /src/pdf --branch nico/ble-21 --base origin/main --label pdf-diff:BLE-21 --no-focus");
    expect((await web("/")).body).toContain("<span>Queue <b>0</b></span>");
  });

  test("with room for one and two queued, only the head starts; the second starts in a later run once room frees up", async () => {
    const { cli, world, queue } = await linearRepo({ maxRunningSpecs: 1 });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    await queue("BLE-30");
    await queue("BLE-20");

    expect(await advanced(cli)).toEqual(["started BLE-31"]);
    expect(await advanced(cli)).toEqual([]);

    // BLE-31 gets its PR, so BLE-30 has every issue done and frees its slot.
    world.linearIssueNamed("BLE-31").state = "started";
    world.linearAttachments.set("BLE-31", ["https://github.com/bleentr/pdf-diff/pull/31"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 31, headBranch: "nico/ble-31" });
    expect(await advanced(cli)).toEqual(["started BLE-21"]);
  });

  test("a queued Spec whose start is refused stays queued and leaves its slot to the next queued Spec", async () => {
    const { cli, world, queue, web } = await linearRepo({ maxRunningSpecs: 1 });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    await queue("BLE-20");
    await queue("BLE-30");
    // Someone takes BLE-21 on Linear after the Board was loaded.
    const linearIssue = world.linearIssue.bind(world);
    world.linearIssue = async (identifier) => {
      const issue = await linearIssue(identifier);
      return issue && identifier === "BLE-21" ? { ...issue, assignee: "someone-else" } : issue;
    };

    expect(await advanced(cli)).toEqual(["skipped BLE-21", "started BLE-31"]);
    expect((await web("/")).body).toContain('<span class="queued">Queued 1 of 1</span>');
  });

  test("with room for two and two queued, one run starts both", async () => {
    const { cli, world, queue } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    await queue("BLE-20");
    await queue("BLE-30");

    expect(await advanced(cli)).toEqual(["started BLE-21", "started BLE-31"]);
  });

  test("an unqueued candidate never starts, even with room", async () => {
    const { cli, world, web } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    await post(web, "/queue", { repo: "bleentr/pdf-diff", spec: "BLE-20" });
    await post(web, "/unqueue", { repo: "bleentr/pdf-diff", spec: "BLE-20" });

    expect(await advanced(cli)).toEqual([]);
    expect(world.calls.some((c) => c.startsWith("herdr worktree create"))).toBe(false);
  });

  test("a queued Spec that became Held, closed or not Ready is dropped and not started", async () => {
    const { cli, world, queue, web } = await linearRepo({ maxRunningSpecs: 5 });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    world.addLinearSpec({ identifier: "BLE-40" }, { identifier: "BLE-41" });
    for (const spec of ["BLE-20", "BLE-30", "BLE-40"]) await queue(spec);
    world.linearIssueNamed("BLE-31").state = "completed";
    world.linearIssueNamed("BLE-41").labels = [];
    expect((await web("/")).body).toContain("<span>Queue <b>1</b></span>");

    world.addLinearSpec({ identifier: "BLE-50" }, { identifier: "BLE-51" }, { identifier: "BLE-52" });
    await queue("BLE-50");
    world.failHerdr("agent start", "herdr is not running");
    expect(await advanced(cli)).toEqual(["failed BLE-21", "failed BLE-51"]);
    world.clearFailures();
    // Held now, both are off the Queue: re-queuing is refused, and a later run resumes rather than starts them anew.
    expect((await queue("BLE-50")).status).toBe(409);
    expect((await web("/")).body).toContain("<span>Queue <b>0</b></span>");
    expect(world.calls.filter((c) => c.startsWith("herdr worktree create"))).toHaveLength(2);
  });

  test("Queues are per Repo: a Spec queued in one Repo never fills another Repo's room", async () => {
    const { cli, world, queue } = await linearRepo();
    world.addClone("/src/api", "git@github.com:acme/api.git");
    await cli("repo", "add", "acme/api", "--path", "/src/api");
    world.addGitHubSpec("acme/api", { number: 10 }, { number: 11 });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    await queue("acme/api#10", "acme/api");

    // A Spec of another Repo is no candidate of this one.
    expect((await queue("acme/api#10")).status).toBe(409);
    const { specs } = (await cli("advance", "--json")).json();
    expect(specs.map((s: { repo: string; issue: string }) => `${s.repo} ${s.issue}`)).toEqual(["acme/api acme/api#11"]);
  });
});

describe("the Queue on the web Board", () => {
  test("queuing answers htmx with the Repo's section alone, showing the Spec's place and the Queue's length, its launch forms kept", async () => {
    const { world, queue, web } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20", title: "Parser" }, { identifier: "BLE-21" }, { identifier: "BLE-22" });
    world.addLinearSpec({ identifier: "BLE-30", title: "Lexer" }, { identifier: "BLE-31" });
    await queue("BLE-30");

    const { status, body } = await queue("BLE-20");
    expect(status).toBe(200);
    expect(body).toStartWith('<section class="repo">\n<header><h2>bleentr/pdf-diff</h2>');
    expect(body).not.toContain("<html");
    expect(body).toContain("<span>Candidates <b>2</b></span><span>Queue <b>2</b></span>");
    expect(body).toContain([
      '<span class="num">BLE-20</span> Parser</a>',
      '<form method="post" action="/unqueue" class="queue" hx-post="/unqueue" hx-target="closest section.repo" hx-swap="outerHTML">',
      '<input type="hidden" name="repo" value="bleentr/pdf-diff"><input type="hidden" name="spec" value="BLE-20">',
      '<span class="queued">Queued 2 of 2</span><button>Unqueue</button></form>',
    ].join(""));
    expect(body).toContain('<span class="queued">Queued 1 of 2</span>');
    // htmx keeps an open launch form across the swap by its id.
    expect(body).toContain('<div id="dispatch-bleentr-pdf-diff-BLE-21" hx-preserve="true">\n<form method="post" action="/dispatch" class="dispatch">');

    const unqueued = (await post(web, "/unqueue", { repo: "bleentr/pdf-diff", spec: "BLE-30" })).body;
    expect(unqueued).toContain("<span>Queue <b>1</b></span>");
    expect(unqueued).toContain('<span class="queued">Queued 1 of 1</span>');
  });

  test("only candidate Specs get a Queue control, and queuing anything else is refused", async () => {
    const { cli, web, world, queue } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-10" }, { identifier: "BLE-11", state: "started" }, { identifier: "BLE-12" });
    world.linearAttachments.set("BLE-11", ["https://github.com/bleentr/pdf-diff/pull/11"]);
    world.addPr({ repo: "bleentr/pdf-diff", number: 11, headBranch: "nico/ble-11" });
    world.addLinearSpec({ identifier: "BLE-40" }, { identifier: "BLE-41", labels: [] }, { identifier: "BLE-42", labels: [] });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" }, { identifier: "BLE-22" });
    await cli("advance");

    const { body } = await web("/");
    expect(body.match(/name="spec" value="[^"]+"/g)).toEqual(['name="spec" value="BLE-20"']);
    for (const spec of ["BLE-10", "BLE-40", "BLE-99"]) {
      const refused = await queue(spec);
      expect(refused.status).toBe(409);
      expect(refused.body).toContain(`${spec} is not a candidate Spec of bleentr/pdf-diff`);
    }
    expect((await post(web, "/queue", { repo: "acme/nope", spec: "BLE-20" })).status).toBe(400);
  });

  test("queued Specs move up and down the Queue, none past either end, and the Board renders the new order", async () => {
    const { world, queue, web } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    world.addLinearSpec({ identifier: "BLE-40" }, { identifier: "BLE-41" });
    for (const spec of ["BLE-20", "BLE-30", "BLE-40"]) await queue(spec);
    const moves = (body: string) => body.match(/hx-post="\/move"[^]*?name="spec" value="[^"]+"[^]*?name="direction" value="(?:up|down)"/g)!
      .map((m) => `${m.match(/name="spec" value="([^"]+)"/)![1]} ${m.match(/name="direction" value="(up|down)"/)![1]}`);

    const board = (await web("/")).body;
    expect(moves(board)).toEqual(["BLE-20 down", "BLE-30 up", "BLE-30 down", "BLE-40 up"]);
    expect(board).toContain('<button aria-label="Move BLE-30 up">');

    const moved = await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-40", direction: "up" });
    expect(moved.status).toBe(200);
    expect(moved.body).toStartWith('<section class="repo">');
    const place = (body: string, spec: string) => body.match(new RegExp(`value="${spec}">(?:[^]*?)<span class="queued">Queued (\\d) of 3`))?.[1];
    expect(["BLE-20", "BLE-30", "BLE-40"].map((s) => place(moved.body, s))).toEqual(["1", "3", "2"]);

    // Past either end, nothing moves.
    await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-20", direction: "up" });
    await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-30", direction: "down" });
    await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-20", direction: "down" });
    const after = (await web("/")).body;
    expect(["BLE-20", "BLE-30", "BLE-40"].map((s) => place(after, s))).toEqual(["2", "3", "1"]);
    expect((await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-20", direction: "sideways" })).status).toBe(400);
  });

  test("the Queue is listed in order beside the Repo's room readout, and follows a move", async () => {
    const { world, queue, web } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    expect((await web("/")).body).not.toContain('class="queue-order"');
    await queue("BLE-30");
    await queue("BLE-20");

    const order = (body: string) => body.match(/<ol class="queue-order"[^>]*>(.*?)<\/ol>/)?.[0];
    expect(order((await web("/")).body)).toBe('<ol class="queue-order" aria-label="Queue of bleentr/pdf-diff"><li>BLE-30</li><li>BLE-20</li></ol>');
    const moved = await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-20", direction: "up" });
    expect(order(moved.body)).toBe('<ol class="queue-order" aria-label="Queue of bleentr/pdf-diff"><li>BLE-20</li><li>BLE-30</li></ol>');
  });

  test("a Spec is the same Spec whatever its case: queued in lower case, it shows queued and starts", async () => {
    const { cli, world, queue, web } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    expect((await queue("ble-20")).status).toBe(200);
    expect((await web("/")).body).toContain('<span class="queued">Queued 1 of 1</span>');
    expect(await advanced(cli)).toEqual(["started BLE-21"]);
  });

  test("after reordering, advance starts the new head first", async () => {
    const { cli, world, queue, web } = await linearRepo({ maxRunningSpecs: 1 });
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    await queue("BLE-20");
    await queue("BLE-30");
    await post(web, "/move", { repo: "bleentr/pdf-diff", spec: "BLE-20", direction: "down" });

    expect(await advanced(cli)).toEqual(["started BLE-31"]);
  });

  test("the CLI Board lists each Repo's Queue in order, read-only", async () => {
    const { cli, world, queue } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    world.addLinearSpec({ identifier: "BLE-30" }, { identifier: "BLE-31" });
    expect((await cli("--json")).json().rooms[0].queue).toEqual([]);
    await queue("BLE-30");
    await queue("BLE-20");

    expect((await cli("--json")).json().rooms[0].queue).toEqual(["BLE-30", "BLE-20"]);
    expect((await cli()).stdout).toContain("    queue[2]: BLE-30,BLE-20\n");
  });

  test("a plain form post goes back to the Board, and the Queue survives a restart", async () => {
    const { world, web, configDir } = await linearRepo();
    world.addLinearSpec({ identifier: "BLE-20" }, { identifier: "BLE-21" });
    const plain = await web("/queue", { method: "POST", body: new URLSearchParams({ repo: "bleentr/pdf-diff", spec: "BLE-20" }) });
    expect(plain.status).toBe(303);

    const restarted = webHandler({ world, configDir });
    const body = await (await restarted(new Request("http://127.0.0.1:42069/"))).text();
    expect(body).toContain('<span class="queued">Queued 1 of 1</span>');
  });
});
