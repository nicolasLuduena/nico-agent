import { escape } from "./html";
import { linearIdentifier } from "./linear";
import { type IssueDescription, type World, worldErrorMessage } from "./world";

/** How long a fetched description is shown again without asking its Source. */
const FRESH_MS = 5 * 60_000;
/** Roughly a screen of text: past it, a description is cut at a paragraph. */
const LONGEST = 2400;

/** An issue's hover card, as HTML, by the issue's GitHub or Linear URL; null when the URL names no issue. */
export type PreviewLookup = (url: string) => Promise<string | null>;

/**
 * Hover cards for the Board: an issue's key, title, labels and the start of
 * its description. One cache for the server's life, so hovering the same
 * issue again shows it at once and asks its Source at most every few minutes.
 */
export function cachedPreviews(world: World): PreviewLookup {
  const cache = new Map<string, { at: number; card: string }>();
  return async (url) => {
    const issue = issueOf(url);
    if (!issue) return null;
    const now = world.now().getTime();
    const hit = cache.get(issue.key);
    if (hit && now - hit.at < FRESH_MS) return hit.card;
    let description: IssueDescription | null;
    try {
      description = issue.slug
        ? await world.githubIssueDescription(issue.slug, issue.number)
        : await world.linearIssueDescription(issue.key);
    } catch (e) {
      return card(issue.key, `<p class="error">Could not load: ${escape(worldErrorMessage(e))}</p>`);
    }
    const html = description ? describe(issue.key, url, description) : card(issue.key, '<p class="error">No such issue</p>');
    if (description) cache.set(issue.key, { at: now, card: html });
    return html;
  };
}

function issueOf(url: string): { key: string; slug?: string; number: number } | null {
  const github = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i);
  if (github) return { key: `${github[1]}#${github[2]}`, slug: github[1], number: Number(github[2]) };
  const identifier = /^https:\/\/linear\.app\//i.test(url) ? linearIdentifier(url) : null;
  return identifier ? { key: identifier, number: 0 } : null;
}

function describe(key: string, url: string, { title, labels, body }: IssueDescription) {
  const { text, cut } = shortened(body.replace(/<!--[\s\S]*?-->/g, "").trim());
  return card(key, [
    `<p class="card-title"><span class="num">${escape(key)}</span> ${escape(title)}</p>`,
    ...(labels.length ? [`<p class="labels">${labels.map((l) => `<span class="label">${escape(l)}</span>`).join("")}</p>`] : []),
    text ? `<div class="markdown">${markdown(text)}</div>` : '<p class="empty">No description.</p>',
    ...(cut ? [`<a class="more" href="${escape(url)}" target="_blank" rel="noopener">Read the rest</a>`] : []),
  ].join("\n"));
}

function card(key: string, inner: string) {
  return `<div class="card" data-issue="${escape(key)}">\n${inner}\n</div>`;
}

/** The description up to about a screen of text, cut at the last paragraph break before it. */
function shortened(text: string) {
  if (text.length <= LONGEST) return { text, cut: false };
  const at = text.lastIndexOf("\n\n", LONGEST);
  // A heading left last would introduce nothing.
  return { text: text.slice(0, at > 0 ? at : LONGEST).replace(/(\n+#{1,6} [^\n]*)+\s*$/, ""), cut: true };
}

/**
 * Markdown as GitHub-flavoured HTML, with nothing the issue's author could
 * use against the Board: raw HTML is escaped, links go only to http(s) and
 * mailto in a new tab, and images become their alt text.
 */
function markdown(text: string) {
  const html = Bun.markdown.html(text, {
    noHtmlBlocks: true, noHtmlSpans: true, tables: true, tasklists: true, strikethrough: true, autolinks: true,
  });
  return html
    .replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/g, '<span class="image">$1</span>')
    .replace(/<img\b[^>]*>/g, "")
    .replace(/<a href="([^"]*)"/g, (_, href: string) =>
      /^(https?:|mailto:)/i.test(href) ? `<a href="${href}" target="_blank" rel="noopener"` : "<a");
}
