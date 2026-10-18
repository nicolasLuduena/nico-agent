<script lang="ts">
  // What the tool was called with, as the chat has it (its input as JSON, cut past 2000 characters).
  import { cn } from "$lib/utils";

  let { input, class: className = "" }: { input: string; class?: string } = $props();
</script>

<div class={cn("grid gap-1", className)}>
  <h4 class="m-0 text-muted-foreground">Parameters</h4>
  <pre class="tool-text rounded-md bg-muted p-2">{input}</pre>
</div>
