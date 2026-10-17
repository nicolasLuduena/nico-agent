<script lang="ts">
  // Markdown as markdown.ts reads it, kept as text: nothing in it is HTML.
  import { blocks, type Span } from "./markdown";

  let { text }: { text: string } = $props();
</script>

{#snippet line(spans: Span[])}{#each spans as span, i (i)}{#if span.kind === "strong"}<strong>{span.text}</strong>{:else if span.kind === "code"}<code>{span.text}</code>{:else if span.kind === "link"}<a href={span.href} target="_blank" rel="noreferrer">{span.text}</a>{:else}{span.text}{/if}{/each}{/snippet}

{#each blocks(text) as block, i (i)}
  {#if block.kind === "list"}
    <svelte:element this={block.ordered ? "ol" : "ul"}>
      {#each block.items as item, j (j)}
        <li>{@render line(item)}</li>
      {/each}
    </svelte:element>
  {:else if block.kind === "heading"}
    <p><strong>{@render line(block.spans)}</strong></p>
  {:else}
    <p>{@render line(block.spans)}</p>
  {/if}
{/each}
