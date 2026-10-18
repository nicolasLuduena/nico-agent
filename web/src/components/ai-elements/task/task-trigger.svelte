<script lang="ts">
  import { cn } from "$lib/utils";

  let { title, class: className }: { title: string; class?: string } = $props();
</script>

<summary class={cn(className)}>{title}</summary>
