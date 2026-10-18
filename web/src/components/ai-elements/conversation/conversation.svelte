<script lang="ts" module>
  import { cn, type WithElementRef } from "$lib/utils";
  import type { HTMLAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";

  export interface ConversationProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
    children?: Snippet;
  }
</script>

<script lang="ts">
  // The scrolling box itself (upstream's root and content in one), kept at its foot as the chat streams.
  import { setStickToBottomContext } from "./stick-to-bottom-context.svelte.js";

  let { class: className, children, ref = $bindable(null), ...restProps }: ConversationProps = $props();

  const context = setStickToBottomContext();
  $effect(() => {
    if (ref) return context.follow(ref);
  });
</script>

<!-- Scrolls inside itself, so a keyboard can reach it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div bind:this={ref} class={cn("flex flex-col gap-3 overflow-y-auto overscroll-contain", className)} role="log" tabindex="0" {...restProps}>
  {@render children?.()}
</div>
