<script lang="ts">
  import { cn } from "$lib/utils";
  import type { Snippet } from "svelte";

  let { class: className = "", children }: { class?: string; children?: Snippet } = $props();
</script>

<div class={cn("grid gap-2 border-t border-border p-2.5", className)}>
  {@render children?.()}
</div>
