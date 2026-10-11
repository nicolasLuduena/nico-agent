<script lang="ts">
  import { blocks, type Span } from "./markdown";

  /** morning.md, as the morning agent wrote it. */
  let { text }: { text: string } = $props();

  const shown = $derived(blocks(text));
</script>

{#snippet line(spans: Span[])}{#each spans as span, i (i)}{#if span.kind === "strong"}<strong>{span.text}</strong>{:else if span.kind === "code"}<code>{span.text}</code>{:else if span.kind === "link"}<a href={span.href} target="_blank" rel="noreferrer">{span.text}</a>{:else}{span.text}{/if}{/each}{/snippet}

<section class="morning" aria-label="Morning summary">
  {#each shown as block, i (i)}
    {#if block.kind === "heading"}
      <h2 class="label">{@render line(block.spans)}</h2>
    {:else if block.kind === "line"}
      <p>{@render line(block.spans)}</p>
    {:else}
      <svelte:element this={block.ordered ? "ol" : "ul"}>
        {#each block.items as item, j (j)}
          <li>{@render line(item)}</li>
        {/each}
      </svelte:element>
    {/if}
  {/each}
</section>

<style>
  /* A sheet of short lists: as many columns as the width takes, one on a phone. */
  .morning {
    columns: 280px auto;
    column-gap: 32px;
    padding: 12px var(--gutter) 16px;
    background: var(--surface);
    border-top: 1px solid var(--hairline);
    overflow-wrap: anywhere;
  }
  h2 {
    padding-top: 12px;
    padding-bottom: 4px;
    color: var(--ink-muted);
    break-after: avoid;
  }
  h2:first-child {
    padding-top: 0;
  }
  ul,
  ol {
    margin: 0;
    padding: 0;
    break-inside: avoid;
  }
  ul {
    list-style: none;
  }
  ol {
    padding-left: 3ch;
  }
  li {
    padding-block: 2px;
  }
</style>
