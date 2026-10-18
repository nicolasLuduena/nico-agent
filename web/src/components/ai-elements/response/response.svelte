<script lang="ts">
  // An agent's Markdown, as the house reads it: kept as text, nothing in it is HTML.
  import { cn } from "$lib/utils";
  import Markdown from "$lib/Markdown.svelte";

  let { content, class: className }: { content: string; class?: string } = $props();
</script>

<div class={cn("response min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
  <Markdown text={content} />
</div>
