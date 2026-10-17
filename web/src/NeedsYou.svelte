<script lang="ts">
  import { ticked } from "./controls/Refused.svelte";
  import { flash } from "./motion";
  import type { Need } from "./toasts";
  import { clock } from "./time";

  let { needs }: { needs: Need[] } = $props();

  // Each dismissed for this page load only.
  const key = (need: Need) => `${need.repo} ${need.text}`;
  let dismissed = $state(new Set<string>());
  const toasts = $derived(needs.filter((n) => !dismissed.has(key(n))));
  /** The stack folded to its one line, for this page load: the work under it shows again. */
  let folded = $state(false);

  /** A toast the page did not have: it flashes once as it arrives, not on the first read. */
  function arrive(row: Element) {
    flash(row);
    return {};
  }
</script>

{#if toasts.length}
  <div class="stack">
    <button type="button" class="quiet fold" aria-expanded={!folded} onclick={() => (folded = !folded)}>
      {folded ? `Show ${toasts.length} notice${toasts.length === 1 ? "" : "s"}` : "Hide notices"}
    </button>
    <ul class="toasts" aria-label="Needs you" hidden={folded}>
      {#each toasts as need (key(need))}
        <li class="toast" role="status" in:arrive>
          <span class="label kind">{need.kind}</span>
          {#if need.kind === "Check" || need.kind === "Install"}
            <!-- `acme/api: what it says`, and under it what to do about it, both read whole: the help is the fix. -->
            <span class="ref">{need.repo}:</span>
            <span class="text">{@render ticked(need.text)}{#if need.help}<span class="help">{@render ticked(need.help)}</span>{/if}</span>
          {:else}
            <!-- `PAUSED GitHub until HH:MM`; `BLOCKED <agent> HH:MM` for an agent of the loop's own with no node. -->
            <span class="ref">{need.text}</span>
            <span class="text">{need.kind === "Paused" ? "until " : ""}{need.at ? clock(need.at) : ""}</span>
          {/if}
          <button type="button" class="close" aria-label="Dismiss {need.kind} {need.repo ?? need.text}" onclick={() => (dismissed = new Set(dismissed).add(key(need)))}>×</button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  /* Stacked over the page's corner, quiet cards with the amber edge of needs you; across the foot on a phone. */
  .stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 10;
    display: grid;
    justify-items: end;
    gap: 8px;
    width: min(400px, calc(100vw - 32px));
  }
  /* At most half the window: past that the notices scroll inside, never over the whole page. */
  .toasts {
    display: grid;
    gap: 8px;
    width: 100%;
    max-height: 50vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }
  .toasts[hidden] {
    display: none;
  }
  .fold {
    order: 1;
    border-left: 4px solid var(--signal-edge);
    box-shadow: var(--shadow-pop);
  }
  .toast {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    grid-template-areas: "kind ref close" "text text text";
    column-gap: 8px;
    row-gap: 2px;
    align-items: baseline;
    padding: 10px 6px 12px 14px;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-left: 4px solid var(--signal-edge);
    border-radius: var(--radius);
  }
  .kind {
    grid-area: kind;
  }
  .ref {
    grid-area: ref;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    grid-area: text;
    color: var(--ink-muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .text:empty {
    display: none;
  }
  .help {
    display: block;
  }
  .close {
    grid-area: close;
    min-width: 32px;
    min-height: 32px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--ink-muted);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover {
    background: var(--raised);
    color: var(--ink);
  }
  @media (width < 720px) {
    .close {
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
