import { getContext, setContext } from "svelte";

const KEY = Symbol("stick-to-bottom-context");

/** Keeps a scrolling box at its foot as content lands, unless the user has scrolled up from it. */
export class StickToBottomContext {
  isAtBottom = $state(true);

  /** Follows `element` till the returned function stops it. */
  follow(element: HTMLElement) {
    const scrolled = () => {
      this.isAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
    };
    // After the DOM settles, once per frame however many appends landed in it.
    let frame = 0;
    const landed = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (this.isAtBottom) element.scrollTop = element.scrollHeight;
      });
    };
    const mutations = new MutationObserver(landed);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    const resizes = new ResizeObserver(landed);
    resizes.observe(element);
    element.addEventListener("scroll", scrolled, { passive: true });
    element.scrollTop = element.scrollHeight;
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes.disconnect();
      element.removeEventListener("scroll", scrolled);
    };
  }
}

export function setStickToBottomContext(): StickToBottomContext {
  return setContext(KEY, new StickToBottomContext());
}

export function getStickToBottomContext(): StickToBottomContext {
  const context = getContext<StickToBottomContext>(KEY);
  if (!context) throw new Error("StickToBottomContext must be used within a Conversation component");
  return context;
}
