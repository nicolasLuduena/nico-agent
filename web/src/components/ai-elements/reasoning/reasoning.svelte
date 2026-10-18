<script lang="ts">
  // The agent's thinking, folded; a native fold, where upstream's is bits-ui's Collapsible, timed by runed.
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";

  let { class: className = "", children }: { class?: string; children?: Snippet } = $props();
</script>

<details class={cn("reasoning min-w-0 text-muted-foreground", className)}>
  {@render children?.()}
</details>
