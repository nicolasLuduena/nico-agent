/** Where this browser remembers the sections open in each panel: `{ "<panel>": ["Room", …] }`. */
const KEY = "nico-agent.open";

function remembered(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * A section of a panel (a Repo's or a Project's defaults) folded to one line:
 * open as this browser remembers it for that panel, and open by itself while
 * `alarmed` says it holds a refusal or a failing state, which is not remembered.
 * Made while a component is, as its effect lives as long as it does.
 */
export class Fold {
  open = $state(false);
  #panel: string;
  #section: string;

  constructor(panel: string, section: string, alarmed: () => boolean) {
    this.#panel = panel;
    this.#section = section;
    this.open = remembered()[panel]?.includes(section) ?? false;
    $effect(() => {
      if (alarmed()) this.open = true;
    });
  }

  /** The user opened or closed it: remembered for its panel in this browser. */
  toggle(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    const all = remembered();
    const others = (all[this.#panel] ?? []).filter((s) => s !== this.#section);
    all[this.#panel] = open ? [...others, this.#section] : others;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // Kept for this visit only.
    }
  }
}
