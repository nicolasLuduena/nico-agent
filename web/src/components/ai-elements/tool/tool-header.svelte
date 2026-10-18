<script lang="ts">
  import { cn } from "$lib/utils";
  import { STATUS, type ToolUIPartState } from "./tool-context.js";

  let { type, state, class: className = "" }: { type: string; state: ToolUIPartState; class?: string } = $props();
</script>

<summary class={cn("px-2.5", className)}>
  <span class="min-w-0 truncate">{type}</span>
  <span class={cn("ml-auto flex-none font-normal", state === "output-error" ? "text-destructive" : "text-muted-foreground")}>{STATUS[state]}</span>
</summary>
