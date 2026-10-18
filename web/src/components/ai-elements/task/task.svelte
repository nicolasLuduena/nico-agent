<script lang="ts">
  // A run of work and how far along it is, open; a native fold, where upstream's is bits-ui's Collapsible.
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";

  let { open = true, class: className, children }: { open?: boolean; class?: string; children?: Snippet } = $props();
</script>

<details {open} class={cn("task min-w-0", className)}>
  {@render children?.()}
</details>
