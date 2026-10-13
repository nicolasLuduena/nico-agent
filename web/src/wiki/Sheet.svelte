<script lang="ts">
  // A column of the Wiki view beside the Component, staying in view; while
  // `folded`, a bottom sheet as the node panel's on a phone, shown once opened
  // and closed by its Close button or Escape.
  import type { Snippet } from "svelte";

  let {
    id,
    title,
    folded,
    open,
    close,
    children,
  }: { id: string; title: string; folded: boolean; open: boolean; close: () => void; children: Snippet } = $props();

  // Focus moves to the sheet's title as it opens, and back to what opened it as Close or Escape shuts it.
  let head = $state<HTMLElement>();
  let opener: HTMLElement | null = null;
  $effect(() => {
    if (!folded || !open || !head) return;
    opener = document.activeElement as HTMLElement | null;
    head.focus();
  });
  function shut() {
    close();
    opener?.focus();
  }
</script>

<svelte:window onkeydown={(e) => folded && open && e.key === "Escape" && shut()} />

{#if !folded || open}
  <div {id} class="column" class:sheet={folded}>
    <header>
      <h2 class="label" tabindex="-1" bind:this={head}>{title}</h2>
      {#if folded}
        <button type="button" class="quiet" onclick={shut}>Close</button>
      {/if}
    </header>
    {@render children()}
  </div>
{/if}

<style>
  .column {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow: auto;
    overflow-wrap: anywhere;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding-bottom: 8px;
  }
  h2 {
    font-size: 14px;
    color: var(--ink-muted);
  }

  /* The bottom sheet: up to 85vh, scrolling inside, its head staying on top. */
  .sheet {
    position: fixed;
    inset: auto 0 0;
    z-index: 10;
    max-height: 85vh;
    padding: 0 16px 16px;
    background: var(--surface);
    border-top: 1px solid var(--rule);
    box-shadow: 0 0 0 1px var(--hairline);
    overscroll-behavior: contain;
    animation: rise 160ms ease-out;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }
  .sheet header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 12px 0 8px;
    background: var(--surface);
  }
  .sheet h2 {
    color: var(--ink);
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>
