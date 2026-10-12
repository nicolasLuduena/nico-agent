<script lang="ts">
  import { blocks, firstLine, type Span } from "./markdown";

  /** morning.md, as the morning agent wrote it. */
  let { text }: { text: string } = $props();

  // The text last hidden, remembered in this browser: hidden until morning.md says something else.
  const KEY = "nico-agent.morning-hidden";
  let hiddenText = $state(remembered());
  const hidden = $derived(hiddenText === text);
  const shown = $derived(blocks(text));

  function remembered(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  function setHidden(next: boolean) {
    hiddenText = next ? text : null;
    try {
      if (next) localStorage.setItem(KEY, text);
      else localStorage.removeItem(KEY);
    } catch {
      // Kept for this page's life only.
    }
  }
</script>

{#snippet line(spans: Span[])}{#each spans as span, i (i)}{#if span.kind === "strong"}<strong>{span.text}</strong>{:else if span.kind === "code"}<code>{span.text}</code>{:else if span.kind === "link"}<a href={span.href} target="_blank" rel="noreferrer">{span.text}</a>{:else}{span.text}{/if}{/each}{/snippet}

<section class="morning" aria-label="Morning summary">
  {#if hidden}
    <p class="first">{@render line(firstLine(text))}</p>
  {:else}
    <div class="sheet">
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
    </div>
  {/if}
  <button type="button" onclick={() => setHidden(!hidden)}>{hidden ? "Show" : "Hide"}</button>
</section>

<style>
  .morning {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 12px var(--gutter) 16px;
    background: var(--surface);
    border-top: 1px solid var(--hairline);
    overflow-wrap: anywhere;
  }
  /* A sheet of short lists: as many columns as the width takes, one on a phone. */
  .sheet {
    flex: 1;
    min-width: 0;
    columns: 280px auto;
    column-gap: 32px;
  }
  /* Folded: the one line, beside its Show button. */
  .first {
    flex: 1;
    min-width: 0;
    align-self: center;
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
  /* DESIGN.md's button-quiet, as Refresh. */
  button {
    flex: none;
    min-height: 36px;
    padding: 8px 16px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    background: var(--ground);
  }
</style>
