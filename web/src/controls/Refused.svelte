<script lang="ts">
  // A command's refusal, inline under what was refused: DESIGN.md's errata rule.
  let { error, help }: { error: string; help: string[] } = $props();
</script>

<div class="refused" role="alert">
  <p class="error">{error}</p>
  {#each help as line, i (i)}
    <!-- A command in backticks, set as App sets one. -->
    <p>
      {#each line.split("`") as part, j (j)}{#if j % 2}<code>{part}</code>{:else}{part}{/if}{/each}
    </p>
  {/each}
</div>

<style>
  .refused {
    display: grid;
    gap: 4px;
    padding: 8px 12px;
    border-left: 4px solid var(--failed);
    overflow-wrap: anywhere;
  }
  .error,
  code {
    font-weight: 600;
  }
  code {
    font-family: inherit;
  }
</style>
