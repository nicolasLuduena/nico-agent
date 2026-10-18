<script lang="ts">
  import { cn } from "$lib/utils";

  let { output, errorText, class: className = "" }: { output?: string; errorText?: string; class?: string } = $props();
</script>

{#if output || errorText}
  <div class={cn("grid gap-1", className)}>
    <h4 class="m-0 text-muted-foreground">{errorText ? "Error" : "Result"}</h4>
    <pre class={cn("tool-text rounded-md p-2", errorText ? "text-destructive bg-muted" : "bg-muted")}>{errorText ?? output}</pre>
  </div>
{/if}
