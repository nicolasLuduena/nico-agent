<script lang="ts">
  // A section of a panel folded to one line: its head, and what is set at its
  // right. Open as this browser remembers it for the panel, and open by itself
  // while `alarm` says it holds a refusal or a failing state.
  import type { Snippet } from "svelte";
  import { Fold } from "./folded.svelte";

  let { panel, title, summary, alarm = false, children }: { panel: string; title: string; summary: string; alarm?: boolean; children: Snippet } =
    $props();
  const id = $props.id();

  // A panel starts afresh for another Repo or Project (`{#key}` around it), so its panel and title stay.
  // svelte-ignore state_referenced_locally
  const fold = new Fold(panel, title, () => alarm);
</script>

<section class="fold" aria-labelledby="{id}-head">
  <details open={fold.open} ontoggle={(e) => fold.toggle(e.currentTarget.open)}>
    <summary>
      <span class="label" id="{id}-head">{title}</span>
      <span class="summary">{summary}</span>
    </summary>
    <div class="inside">
      {@render children()}
    </div>
  </details>
</section>

<style>
  /* Each folded line a faint band, so the column reads as parts, not one grey list. */
  summary {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-height: 40px;
    padding: 10px 12px;
    border-radius: var(--radius-control);
    background: var(--ground);
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  /* A chevron, drawn: right while folded, down once open. */
  summary::before {
    content: "";
    flex: none;
    align-self: flex-start;
    width: 6px;
    height: 6px;
    margin: 6px 2px 0 0;
    border-right: 1.5px solid var(--ink-muted);
    border-bottom: 1.5px solid var(--ink-muted);
    transform: rotate(-45deg);
    transition: transform 120ms ease-out;
  }
  details[open] > summary::before {
    transform: rotate(45deg);
  }
  summary:hover {
    background: var(--raised);
  }
  /* What is set, whole: a long launch wraps under itself rather than hide its model or Effort. */
  .summary {
    min-width: 0;
    margin-left: auto;
    color: var(--ink-muted);
    text-align: right;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .inside {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 12px 0 8px;
  }
  @media (width < 720px) {
    summary {
      min-height: 44px;
      padding-block: 12px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    summary::before {
      transition: none;
    }
  }
</style>
