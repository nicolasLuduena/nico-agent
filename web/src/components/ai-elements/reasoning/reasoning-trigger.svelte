<script lang="ts">
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";

  let { class: className = "", children }: { class?: string; children?: Snippet } = $props();
</script>

<summary class={cn("font-normal", className)}>
  {#if children}{@render children()}{:else}Thinking{/if}
</summary>
