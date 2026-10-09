import { describe, expect, test } from "bun:test";
import { setup } from "./harness";

/** The preview card the Board shows on hovering an issue's link. */
function preview(web: ReturnType<typeof setup>["web"], url: string) {
  return web(`/preview?url=${encodeURIComponent(url)}`);
}

describe("web Board issue previews", () => {
  test("a GitHub issue's preview shows its key, title, labels and description as Markdown", async () => {
    const { web, world } = setup();
    world.addIssue("acme/api", { number: 10, title: "Billing", labels: ["ready-for-agent", "spec"] });
    world.descriptions.set("acme/api#10", "## Problem\n\nInvoices are **late**.\n\n- [ ] one\n- two");

    const { status, type, body } = await preview(web, "https://github.com/acme/api/issues/10");
    expect(status).toBe(200);
    expect(type).toContain("text/html");
    expect(body).toContain('<span class="num">acme/api#10</span> Billing');
    expect(body).toContain('<span class="label">ready-for-agent</span><span class="label">spec</span>');
    expect(body).toContain("<h2>Problem</h2>");
    expect(body).toContain("<p>Invoices are <strong>late</strong>.</p>");
    expect(body).toContain("<li>two</li>");
  });

  test("a Linear issue's preview is found by its URL", async () => {
    const { web, world } = setup();
    world.addLinearIssue({ identifier: "BLE-27", title: "Search", labels: ["ready-for-agent"] });
    world.descriptions.set("BLE-27", "Find things fast.");

    const { body } = await preview(web, "https://linear.app/bleentr/issue/BLE-27/search");
    expect(body).toContain('<span class="num">BLE-27</span> Search');
    expect(body).toContain("<p>Find things fast.</p>");
  });

  test("an issue without a description says so", async () => {
    const { web, world } = setup();
    world.addIssue("acme/api", { number: 11, title: "Bare" });

    const { body } = await preview(web, "https://github.com/acme/api/issues/11");
    expect(body).toContain('<p class="empty">No description.</p>');
  });

  test("raw HTML, script links and images in a description are not rendered", async () => {
    const { web, world } = setup();
    world.addIssue("acme/api", { number: 12 });
    world.descriptions.set("acme/api#12", [
      "<!-- template comment -->",
      "<script>alert(1)</script> <img src=x onerror=alert(1)>",
      "",
      "[bad](javascript:alert(1)) [good](https://example.com) ![shot](https://example.com/a.png)",
    ].join("\n"));

    const { body } = await preview(web, "https://github.com/acme/api/issues/12");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<img");
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("template comment");
    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain('<a href="https://example.com" target="_blank" rel="noopener">good</a>');
    expect(body).toContain('<span class="image">shot</span>');
  });

  test("a long description is cut short, with a link to read the rest", async () => {
    const { web, world } = setup();
    world.addIssue("acme/api", { number: 13 });
    const paragraphs = Array.from({ length: 40 }, (_, i) => i % 5 === 4 ? `## Part ${i}` : `Paragraph ${i} ${"words ".repeat(20)}`);
    world.descriptions.set("acme/api#13", paragraphs.join("\n\n"));

    const { body } = await preview(web, "https://github.com/acme/api/issues/13");
    expect(body).toContain("Paragraph 0 ");
    expect(body).not.toContain("Paragraph 38 ");
    // The cut never leaves a heading last, with nothing under it.
    expect(body).not.toMatch(/<\/h2>\n<\/div>/);
    expect(body).toContain('<a class="more" href="https://github.com/acme/api/issues/13" target="_blank" rel="noopener">Read the rest</a>');
  });

  test("hovering again within a few minutes doesn't ask the Source again", async () => {
    const { web, world } = setup();
    world.addIssue("acme/api", { number: 10, title: "Billing" });
    const asked = () => world.calls.filter((c) => c === "github issue description acme/api#10").length;

    await preview(web, "https://github.com/acme/api/issues/10");
    await preview(web, "https://github.com/acme/api/issues/10");
    expect(asked()).toBe(1);

    world.clock = new Date(world.clock.getTime() + 10 * 60_000);
    await preview(web, "https://github.com/acme/api/issues/10");
    expect(asked()).toBe(2);
  });

  test("an unknown issue, a failing Source and a URL that isn't an issue each say what went wrong", async () => {
    const { web, world } = setup();
    expect((await preview(web, "https://github.com/acme/api/issues/99")).body).toContain('<p class="error">No such issue</p>');

    world.addIssue("acme/api", { number: 10 });
    world.failCall("github issue description", "not authenticated with GitHub; run `gh auth login`");
    expect((await preview(web, "https://github.com/acme/api/issues/10")).body)
      .toContain('<p class="error">Could not load: not authenticated with GitHub; run `gh auth login`</p>');

    const notIssue = await preview(web, "https://example.com/elsewhere");
    expect(notIssue.status).toBe(400);
  });
});
