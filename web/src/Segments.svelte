<script lang="ts" generics="T extends string">
  // A segmented switch, its states set here once: the theme switch's.
  // On a `raised` track, the picked segment a lifted `surface` pill; 44px tall under 720px.
  let { label, options, value, pick }: { label: string; options: { value: T; label: string }[]; value: T; pick: (value: T) => void } =
    $props();
</script>

<div class="switch" role="group" aria-label={label}>
  {#each options as o (o.value)}
    <button type="button" aria-pressed={value === o.value} onclick={() => pick(o.value)}>{o.label}</button>
  {/each}
</div>

<style>
  .switch {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--raised);
  }
  button {
    min-height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    color: var(--ink);
  }
  button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow), 0 0 0 1px var(--hairline);
  }
  /* Over its neighbours, which would paint over its ring. */
  button:focus-visible {
    position: relative;
  }
  @media (width < 720px) {
    button {
      min-height: 44px;
    }
  }
</style>
