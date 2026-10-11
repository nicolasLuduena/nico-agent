import { describe, expect, it } from "vitest";
import { blocks } from "./markdown";

const text = (text: string) => ({ kind: "text", text });

describe("the Morning summary's Markdown", () => {
  it("is headings, lists and lines, blank lines dropped", () => {
    const summary = "## Merge these\n1. acme/api#7\n2. acme/api#8\n\n## Answer these\nNothing needs you\n- acme/web#3 Keep v1?\n";

    expect(blocks(summary)).toEqual([
      { kind: "heading", spans: [text("Merge these")] },
      { kind: "list", ordered: true, items: [[text("acme/api#7")], [text("acme/api#8")]] },
      { kind: "heading", spans: [text("Answer these")] },
      { kind: "line", spans: [text("Nothing needs you")] },
      { kind: "list", ordered: false, items: [[text("acme/web#3 Keep v1?")]] },
    ]);
  });

  it("sets **strong**, `code`, and links to http(s) URLs, bare or named", () => {
    const line = "**Verified** `acme/api#7` https://github.com/acme/api/pull/9. [PR 10](https://github.com/acme/api/pull/10)";

    expect(blocks(line)).toEqual([
      {
        kind: "line",
        spans: [
          { kind: "strong", text: "Verified" },
          text(" "),
          { kind: "code", text: "acme/api#7" },
          text(" "),
          { kind: "link", text: "https://github.com/acme/api/pull/9", href: "https://github.com/acme/api/pull/9" },
          text(". "),
          { kind: "link", text: "PR 10", href: "https://github.com/acme/api/pull/10" },
        ],
      },
    ]);
  });

  it("keeps markup and any other link as text, never as HTML or a link", () => {
    const hostile = '<img src=x onerror="alert(1)"> [run](javascript:alert(1))';

    expect(blocks(hostile)).toEqual([{ kind: "line", spans: [text(hostile)] }]);
  });
});
