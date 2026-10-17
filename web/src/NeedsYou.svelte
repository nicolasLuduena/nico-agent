<script lang="ts">
  import { ticked } from "./controls/Refused.svelte";
  import { projectOf } from "./controls/settings";
  import { repoLine } from "./hues";
  import { flash } from "./motion";
  import type { Project } from "./status";
  import type { Need } from "./strip";
  import { clock } from "./time";

  let { needs, projects }: { needs: Need[]; projects: Project[] } = $props();

  // What has a node is on its flag; the rest is a toast, dismissed for this page load only.
  const key = (need: Need) => `${need.repo} ${need.text}`;
  let dismissed = $state(new Set<string>());
  const toasts = $derived(needs.filter((n) => n.issue === null && !dismissed.has(key(n))));

  /** A toast the page did not have: it flashes once as it arrives, not on the first read. */
  function arrive(row: Element) {
    flash(row);
    return {};
  }
</script>

<!-- The Repo's line colour, in a Project of more than one, before its name. -->
{#snippet swatch(repo: string)}
  {@const line = repoLine(repo, projectOf(repo, projects))}
  {#if line}<span class="swatch" style:--line={line}></span>{/if}
{/snippet}

{#if toasts.length}
  <ul class="toasts" aria-label="Needs you">
    {#each toasts as need (key(need))}
      <li class="toast" role="status" in:arrive>
        <span class="label kind">{need.kind}</span>
        {#if need.kind === "Check" || need.kind === "Install"}
          <!-- `acme/api: what it says`, and under it what to do about it, both read whole: the help is the fix. -->
          <span class="ref">{@render swatch(need.repo ?? "")}{need.repo}:</span>
          <span class="text">{@render ticked(need.text)}{#if need.help}<span class="help">{@render ticked(need.help)}</span>{/if}</span>
        {:else}
          <!-- `PAUSED GitHub until HH:MM`; `BLOCKED <agent> HH:MM` for an agent of the loop's own with no node. -->
          <span class="ref">{need.text}</span>
          <span class="text">{need.kind === "Paused" ? "until " : ""}{need.at ? clock(need.at) : ""}</span>
        {/if}
        <button type="button" class="close" aria-label="Dismiss" onclick={() => (dismissed = new Set(dismissed).add(key(need)))}>×</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  /* Stacked over the page's corner, in signal yellow; across the foot on a phone. */
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 10;
    display: grid;
    gap: 8px;
    width: min(420px, calc(100vw - 32px));
    padding: 0;
    list-style: none;
  }
  .toast {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    grid-template-areas: "kind ref close" "text text text";
    column-gap: 12px;
    row-gap: 4px;
    align-items: baseline;
    padding: 10px 8px 12px 14px;
    background: var(--signal);
    color: var(--signal-ink);
    border: 1px solid var(--rule);
    box-shadow: 0 6px 20px color-mix(in srgb, var(--signal-ink) 25%, transparent);
  }
  .kind {
    grid-area: kind;
  }
  .ref {
    grid-area: ref;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    grid-area: text;
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
    background: none;
    color: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover {
    background: color-mix(in srgb, var(--signal-ink) 10%, var(--signal));
  }
  .close:focus-visible {
    outline-color: var(--signal-ink);
  }
  /* On the yellow in both themes: framed in its ink, so a light line colour still shows. */
  .swatch {
    margin-right: 8px;
    outline: 1px solid var(--signal-ink);
  }
  /* A command keeps the toast's own ink: the page's would be white on yellow in Dark. */
  .text :global(code) {
    color: inherit;
  }
</style>
