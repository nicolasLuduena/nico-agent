<script lang="ts">
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";

  let { class: className, children }: { class?: string; children?: Snippet } = $props();
</script>

<div class={cn("grid gap-1 border-l-2 border-border pl-3", className)}>
  {@render children?.()}
</div>
