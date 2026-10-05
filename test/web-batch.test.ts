import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

const FLAGS = ["--harness", "claude", "--model", "opus", "--effort", "high"];

/** A Repo with issues 1 and 2 Ready, and 3 and 4 dispatched, 3 with an open PR. */
async function mixed() {
  const ctx = setup();
  ctx.world.addClone("/src/api", "git@github.com:acme/api.git");
  await ctx.cli("repo", "add", "acme/api", "--path", "/src/api");
  for (const number of [1, 2, 3, 4]) ctx.world.addIssue("acme/api", { number });
  await ctx.cli("dispatch", "acme/api#3", ...FLAGS);
  await ctx.cli("dispatch", "acme/api#4", ...FLAGS);
  ctx.world.linkPr("acme/api", 3, { number: 13 });
  ctx.world.calls.length = 0;
  return ctx;
}

const query = (issues: string[], extra: Record<string, string> = {}) => {
  const params = new URLSearchParams(extra);
  for (const issue of issues) params.append("issue", issue);
  return params;
};

describe("Board selection", () => {
  test("Ready and In-flight issues have a checkbox for the action bar, which starts with nothing to act on", async () => {
    const { web } = await mixed();
    const { body } = await web("/");
    for (const issue of ["acme/api#1", "acme/api#3"]) {
      expect(body).toContain(`<input type="checkbox" class="pick" name="issue" value="${issue}" form="batch" autocomplete="off"`);
    }
    expect(body).toContain('<form id="batch" method="get" action="/batch-form">');
    expect(body).toContain('<button name="action" value="dispatch" disabled>Dispatch 0</button>');
    expect(body).toContain('<button name="action" value="review" disabled>Review 0</button>');
    expect(body).toContain('<button name="action" value="close" formmethod="post" formaction="/close" disabled>Close 0</button>');
  });

  test("the In-flight checkboxes keep their state across polls", async () => {
    const { web } = await mixed();
    const { body } = await web("/in-flight");
    expect(body).toContain('value="acme/api#3" form="batch" autocomplete="off" id="pick-acme-api-3" hx-preserve="true"');
  });

  test("each action button counts the ticked issues it applies to, and is disabled at zero", async () => {
    const { web } = await mixed();
    const mixedBar = (await web(`/action-bar?${query(["acme/api#1", "acme/api#2", "acme/api#3", "acme/api#4"])}`)).body;
    expect(mixedBar).toContain('<button name="action" value="dispatch">Dispatch 2</button>');
    expect(mixedBar).toContain('<button name="action" value="review">Review 1</button>');
    expect(mixedBar).toContain('<button name="action" value="close" formmethod="post" formaction="/close">Close 2</button>');

    const readyOnly = (await web(`/action-bar?${query(["acme/api#1"])}`)).body;
    expect(readyOnly).toContain(">Dispatch 1</button>");
    expect(readyOnly).toContain('<button name="action" value="review" disabled>Review 0</button>');
  });
});

describe("batch launch form", () => {
  test("has a row per issue that fits, and lists the others as skipped with the reason", async () => {
    const { web } = await mixed();
    const { status, body } = await web(`/batch-form?${query(["acme/api#1", "acme/api#3", "acme/api#2"], { action: "dispatch" })}`);
    expect(status).toBe(200);
    expect(body).toContain('<form method="post" action="/batch/dispatch" class="batch">');
    expect(body).toContain('<fieldset class="row">\n<legend>acme/api#1</legend>\n<input type="hidden" name="issue" value="acme/api#1">');
    expect(body).toContain("<legend>acme/api#2</legend>");
    expect(body).not.toContain("<legend>acme/api#3</legend>");
    expect(body).toContain("<li>acme/api#3: skipped, acme/api#3 is already In flight</li>");
    expect(body).toContain("<button>Dispatch 2</button>");
  });

  test("a review form skips an issue without a PR", async () => {
    const { web } = await mixed();
    const { body } = await web(`/batch-form?${query(["acme/api#3", "acme/api#4"], { action: "review" })}`);
    expect(body).toContain('<form method="post" action="/batch/review" class="batch">');
    expect(body).toContain("<legend>acme/api#3</legend>");
    expect(body).toContain("<li>acme/api#4: skipped, no PR is linked to acme/api#4 yet</li>");
    expect(body).toContain("<button>Launch review 1</button>");
  });

  test("changing one row re-renders only that row, keeping its own choices", async () => {
    const { web } = await mixed();
    const params = new URLSearchParams({ action: "dispatch", issue: "acme/api#1", harness: "claude", model: "sonnet", effort: "max", stackOn: "" });
    const { body } = await web(`/batch-row?${params}`);
    expect(body).toStartWith('<fieldset class="row">\n<legend>acme/api#1</legend>');
    expect(body).toContain("<option selected>sonnet</option>");
    expect(body).toContain("<option selected>max</option>");
    expect(body).toContain('hx-get="/batch-row" hx-vals=\'{"action":"dispatch"}\' hx-include="closest fieldset" hx-target="closest fieldset" hx-swap="outerHTML"');
  });

  test("submitting launches each row with its own Harness, model and Effort, and reports each issue", async () => {
    const { web, world, cli } = await mixed();
    world.failCall("herdr worktree create --cwd /src/api --branch agent/api-2 ", "worktree already exists");
    const form = new URLSearchParams();
    for (const [issue, harness, model, effort] of [
      ["acme/api#1", "claude", "sonnet", "max"],
      ["acme/api#2", "claude", "opus", "low"],
      ["acme/api#5", "codex", "gpt-5.5", "high"],
    ]) {
      for (const [name, value] of Object.entries({ issue: issue!, stackOn: "", harness: harness!, model: model!, effort: effort! })) {
        form.append(name, value);
      }
    }
    world.addIssue("acme/api", { number: 5 });
    const { status, body } = await web("/batch/dispatch", { method: "POST", body: form });
    expect(status).toBe(200);
    expect(body).toContain("<li>acme/api#1: dispatched</li>");
    expect(body).toContain('<li>acme/api#2: <span class="error">failed, worktree already exists</span></li>');
    expect(body).toContain("<li>acme/api#5: dispatched</li>");
    expect(world.calls).toContain("herdr agent start impl-api-1 --kind claude --pane w3:p2 -- --model sonnet --effort max");
    expect(world.calls.some((c) => c.startsWith("herdr agent start impl-api-5 --kind codex") && c.includes("-m gpt-5.5 -c model_reasoning_effort=high"))).toBe(true);
    expect((await cli("show", "acme/api#2", "--json")).json().stage).toBe("Failed at worktree");
  });
});

describe("batch close on the web", () => {
  test("closes the issues with a PR straight away and asks to confirm the rest in one step", async () => {
    const { web, cli } = await mixed();
    const first = await web("/close", { method: "POST", body: query(["acme/api#3", "acme/api#4"]) });
    expect(first.status).toBe(200);
    expect(first.body).toContain("<li>acme/api#3: closed</li>");
    expect(first.body).toContain(
      ['<form method="post" action="/close">', '<input type="hidden" name="issue" value="acme/api#4">', '<input type="hidden" name="confirm" value="yes">', "<button>Confirm close</button>", "</form>"].join("\n"),
    );
    expect(first.body).not.toContain('name="issue" value="acme/api#3"');
    expect((await cli("show", "acme/api#3")).exitCode).toBe(1);
    expect((await cli("show", "acme/api#4")).exitCode).toBe(0);

    const confirmed = await web("/close", { method: "POST", body: query(["acme/api#4"], { confirm: "yes" }) });
    expect(confirmed.status).toBe(303);
    expect((await cli("show", "acme/api#4")).exitCode).toBe(1);
  });

  test("closing only issues with a PR goes straight back to the Board", async () => {
    const { web } = await mixed();
    expect((await web("/close", { method: "POST", body: query(["acme/api#3"]) })).status).toBe(303);
  });
});
