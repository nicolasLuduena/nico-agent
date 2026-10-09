/**
 * Resting on an issue's link (or focusing it) shows its card: key, title,
 * labels and the start of its description, as `serve` renders it at
 * `/preview`, fetched once and kept for the page's life. The card stays while
 * the pointer is on it, so it can be read and scrolled; leaving both, or
 * Escape, hides it. Returns a function that removes the card and its listeners.
 */
export function installPreviews(): () => void {
  const preview = document.createElement("aside");
  preview.className = "preview";
  preview.hidden = true;
  document.body.append(preview);
  const cards = new Map<string, Promise<string>>();
  let shownFor: HTMLAnchorElement | null = null;
  let showing: ReturnType<typeof setTimeout> | undefined;
  let hiding: ReturnType<typeof setTimeout> | undefined;
  const cardFor = (url: string) => {
    if (!cards.has(url)) {
      cards.set(url, fetch(`/preview?url=${encodeURIComponent(url)}`).then((r) => r.text())
        .catch(() => '<div class="card"><p class="error">Could not load the preview</p></div>'));
    }
    return cards.get(url)!;
  };
  const place = (link: HTMLElement) => {
    const at = link.getBoundingClientRect();
    const width = Math.min(480, innerWidth - 16);
    preview.style.width = `${width}px`;
    preview.style.left = `${Math.max(8, Math.min(at.left, innerWidth - width - 8))}px`;
    const below = innerHeight - at.bottom;
    const above = at.top;
    const under = below > 240 || below > above;
    preview.style.maxHeight = `${Math.max(160, Math.min(440, (under ? below : above) - 16))}px`;
    if (under) [preview.style.top, preview.style.bottom] = [`${at.bottom + 6}px`, "auto"];
    else [preview.style.bottom, preview.style.top] = [`${innerHeight - at.top + 6}px`, "auto"];
  };
  const show = async (link: HTMLAnchorElement) => {
    shownFor = link;
    const html = await cardFor(link.href);
    if (shownFor !== link || !link.isConnected) return;
    // Rendered by `serve` with the issue's text escaped and its links made safe.
    preview.innerHTML = html;
    preview.scrollTop = 0;
    place(link);
    preview.hidden = false;
  };
  const hide = () => {
    shownFor = null;
    preview.hidden = true;
  };
  const closest = (e: Event, selector: string) => (e.target instanceof Element ? e.target.closest(selector) : null);
  const linkOf = (e: Event) => closest(e, "a.title") as HTMLAnchorElement | null;
  const enter = (link: HTMLAnchorElement, delay: number) => {
    clearTimeout(hiding);
    if (link === shownFor) return;
    clearTimeout(showing);
    showing = setTimeout(() => show(link), delay);
  };
  const leave = () => {
    clearTimeout(showing);
    clearTimeout(hiding);
    hiding = setTimeout(hide, 200);
  };
  const listeners: [EventTarget, string, (e: Event) => void][] = [
    [document, "mouseover", (e) => {
      const link = linkOf(e);
      if (link) enter(link, 400);
      else if (closest(e, "aside.preview")) clearTimeout(hiding);
    }],
    [document, "mouseout", (e) => { if (linkOf(e) || closest(e, "aside.preview")) leave(); }],
    [document, "focusin", (e) => { const link = linkOf(e); if (link) enter(link, 0); }],
    [document, "focusout", (e) => { if (linkOf(e)) leave(); }],
    [document, "keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") hide(); }],
    [window, "scroll", hide],
  ];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener, { passive: true });
  return () => {
    clearTimeout(showing);
    clearTimeout(hiding);
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    preview.remove();
  };
}
