<script lang="ts">
  // A tool call, folded to its header line; a native fold, where upstream's is bits-ui's Collapsible.
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";
  import type { HTMLDetailsAttributes } from "svelte/elements";

  let { class: className = "", children, ...restProps }: HTMLDetailsAttributes & { children?: Snippet } = $props();
</script>

<details class={cn("tool w-full min-w-0 rounded-md border border-border bg-card", className)} {...restProps}>
  {@render children?.()}
</details>
