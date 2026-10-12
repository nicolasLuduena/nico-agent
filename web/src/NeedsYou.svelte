<script lang="ts">
  import { ticked } from "./controls/Refused.svelte";
  import { projectOf } from "./controls/settings";
  import { flash } from "./motion";
  import { selection } from "./selection.svelte";
  import type { Project } from "./status";
  import type { Need } from "./strip";
  import { clock } from "./time";

  let { needs, projects }: { needs: Need[]; projects: Project[] } = $props();

  /** Show the tab of the item's Repo's Project with its node open. */
  function open(need: Need) {
    selection.project = need.repo && (projectOf(need.repo, projects)?.name ?? null);
    selection.issue = need.issue;
  }

  /** A row the band did not have: it flashes once as it arrives. Not on the first read, nor as the band turns yellow, which says it already. */
  function arrive(row: Element) {
    flash(row);
    return {};
  }
</script>

{#snippet cells(need: Need)}
  <span class="label kind">{need.kind}</span>
  {#if need.repo && need.issue}
    <!-- `acme/api #7`, or `acme/api BLE-12` for a Linear issue. -->
    <span class="ref">{need.repo} {need.issue.replace(need.repo, "")}</span>
    <span class="text">{@render ticked(need.text)}</span>
  {:else}
    <span class="ref">{need.text}</span>
    <span class="text"></span>
  {/if}
  <span class="at">{need.kind === "Paused" ? "until " : ""}{need.at ? clock(need.at) : ""}</span>
{/snippet}

<section class="band" class:empty={needs.length === 0} aria-label="Needs you">
  {#if needs.length === 0}
    <p>Nothing needs you</p>
  {:else}
    <ul>
      {#each needs as need (`${need.kind} ${need.repo} ${need.issue ?? need.text}`)}
        <li in:arrive>
          {#if need.issue}
            <button type="button" class="row" onclick={() => open(need)}>{@render cells(need)}</button>
          {:else}
            <div class="row">{@render cells(need)}</div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .band {
    background: var(--signal);
    color: var(--signal-ink);
    border-block: 1px solid var(--rule);
    padding-block: 4px;
  }
  .band.empty {
    background: var(--surface);
    color: var(--ink-muted);
    border-color: var(--hairline);
    padding: 12px var(--gutter);
  }
  ul {
    display: grid;
    grid-template-columns: max-content max-content minmax(0, 1fr) max-content;
    padding: 0;
    list-style: none;
  }
  li,
  .row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
  }
  li + li {
    border-top: 1px solid color-mix(in srgb, var(--signal-ink) 20%, var(--signal));
  }
  .row {
    column-gap: 16px;
    align-items: baseline;
    width: 100%;
    padding: 8px var(--gutter);
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
  }
  button.row:hover {
    background: color-mix(in srgb, var(--signal-ink) 8%, var(--signal));
  }
  button.row:hover .text {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button.row:focus-visible {
    outline-color: var(--signal-ink);
    outline-offset: -4px;
  }
  .ref {
    font-weight: 600;
  }
  /* A command keeps the band's own ink: the page's would be white on yellow in Dark. */
  .text :global(code) {
    color: inherit;
  }
  .text,
  .ref {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .at {
    text-align: right;
  }

  /* One item per block: kind, Repo and issue, and time; the question or title under them. */
  @media (width < 720px) {
    ul,
    li {
      display: block;
    }
    .row {
      grid-template-columns: max-content minmax(0, 1fr) max-content;
      grid-template-areas: "kind ref at" "text text text";
      row-gap: 2px;
    }
    .kind {
      grid-area: kind;
    }
    .ref {
      grid-area: ref;
    }
    .at {
      grid-area: at;
    }
    .text {
      grid-area: text;
      white-space: normal;
    }
    .text:empty {
      display: none;
    }
  }
</style>
