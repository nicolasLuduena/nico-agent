/** A run of a line: plain text, **strong**, `code`, or a link to an http(s) URL. */
export type Span = { kind: "text" | "strong" | "code"; text: string } | { kind: "link"; text: string; href: string };

/** A block of the Morning summary: a heading, a list, or a line. */
export type Block =
  | { kind: "heading"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] }
  | { kind: "line"; spans: Span[] };

// shortcut: only the Morning summary's shape (headings, lists, lines, strong, code, links); take a Markdown library if it outgrows that.
/** The blocks of `markdown`, an agent's, kept as text: rendered as Svelte text, nothing in it is HTML. */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const line of markdown.split("\n").map((l) => l.trim())) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    const last = out.at(-1);
    if (!line) continue;
    if (heading) out.push({ kind: "heading", spans: spans(heading[1]) });
    else if (!item) out.push({ kind: "line", spans: spans(line) });
    else if (last?.kind === "list" && last.ordered === (item[1] !== undefined)) last.items.push(spans(item[2]));
    else out.push({ kind: "list", ordered: item[1] !== undefined, items: [spans(item[2])] });
  }
  return out;
}

/** The sections the needs-you band shows live; morning.md's snapshot of them only goes stale once the user acts. */
const LIVE = ["merge these", "answer these", "fix these"];

/** `markdown` without its live sections, each from its heading to the next: the night's history is what stays. */
export function withoutLive(markdown: string): string {
  let live = false;
  return markdown
    .split("\n")
    .filter((line) => {
      const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
      if (heading) live = LIVE.includes(heading[1].trim().toLowerCase());
      return !live;
    })
    .join("\n");
}

/** The first line of `markdown` that is not a heading, a list item's marker dropped: the folded Morning summary's one line. */
export function firstLine(markdown: string): Span[] {
  const line = markdown.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  return line ? spans(line.replace(/^(?:[-*+]|\d+[.)])\s+/, "")) : [];
}

/** **strong**, `code`, [named](https://…) and bare https://… links, the last without trailing punctuation. */
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]*[^\s).,;:!?])/g;

export function spans(line: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: line.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", text: m[3], href: m[4] });
    else out.push({ kind: "link", text: m[5], href: m[5] });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ kind: "text", text: line.slice(at) });
  return out;
}
