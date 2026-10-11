<script module lang="ts">
  export { ticked };
</script>

<script lang="ts">
  // A command's refusal, inline under what was refused: DESIGN.md's errata rule.
  let { error, help }: { error: string; help: string[] } = $props();
</script>

<!-- A line with its commands in backticks, each set as code. -->
{#snippet ticked(line: string)}{#each line.split("`") as part, j (j)}{#if j % 2}<code>{part}</code>{:else}{part}{/if}{/each}{/snippet}

<div class="errata" role="alert">
  <p class="error">{@render ticked(error)}</p>
  {#each help as line, i (i)}
    <p>{@render ticked(line)}</p>
  {/each}
</div>

<style>
  .error {
    font-weight: 600;
  }
</style>
