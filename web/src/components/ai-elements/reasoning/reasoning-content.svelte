<script lang="ts">
  import { cn } from "$lib/utils";
  import Response from "../response/response.svelte";

  let { content, class: className = "" }: { content: string; class?: string } = $props();
</script>

<Response class={cn("grid gap-2 border-l-2 border-border pl-3", className)} {content} />
