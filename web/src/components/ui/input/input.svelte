<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";

  type Props = WithElementRef<Omit<HTMLInputAttributes, "type"> & { type?: Exclude<HTMLInputTypeAttribute, "file"> }>;

  let { ref = $bindable(null), value = $bindable(), type, class: className, "data-slot": dataSlot = "input", ...restProps }: Props = $props();
</script>

<!-- A text or number field, DESIGN.md's states on it: hover takes its `rule` frame to `ink`, focus is the 2px `focus` ring,
     refused frames it 2px in `failed`, disabled is `ink-muted` on `raised` in a hairline; under 720px 44px tall and 16px text. -->
<input
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    "min-h-9 w-full rounded-md border border-input bg-card px-2.5 py-0 text-ellipsis placeholder:text-muted-foreground placeholder:opacity-100 hover:not-disabled:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive aria-busy:not-disabled:cursor-progress disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground phone:min-h-11 phone:text-[16px]",
    className,
  )}
  {type}
  bind:value
  {...restProps}
/>
