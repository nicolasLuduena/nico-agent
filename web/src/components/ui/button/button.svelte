<script lang="ts" module>
  import { type VariantProps, tv } from "tailwind-variants";
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

  // DESIGN.md's states, one look for every button: focus the 2px `focus` ring, disabled `ink-muted` on
  // `raised` in a hairline (never an opacity), busy the progress cursor, and 44px tall under 720px.
  export const buttonVariants = tv({
    base: "min-h-9 cursor-pointer rounded-md border py-0 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground aria-busy:not-disabled:cursor-progress phone:min-h-11",
    variants: {
      variant: {
        // The form's one action: the accent's fill, a step darker on hover.
        default: "border-primary bg-primary px-4 text-primary-foreground hover:not-disabled:bg-primary-hover",
        // Every other action, DESIGN.md's quiet button: `surface` in a `rule` frame, `raised` on hover.
        outline: "flex-none border-input bg-card px-3.5 text-foreground hover:not-disabled:bg-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
    };
</script>

<script lang="ts">
  let {
    class: className,
    variant = "default",
    ref = $bindable(null),
    href = undefined,
    type = "button",
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant }), "inline-flex items-center justify-center no-underline", className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    role={disabled ? "link" : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant }), className)}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
