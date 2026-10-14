<script lang="ts">
  // Where a setting comes from, as a chip beside it: `from Project` or
  // `default` while the Repo (or the Project) does not set it; `set here` once
  // it does, its × removing its own, named for what takes its place.
  import type { Setting } from "../status";
  import { type Holder, tag, undoLabel } from "./settings";

  let { setting, holder, keys, name, onundo }: { setting: Setting<unknown>; holder: Holder; keys: string[]; name: string; onundo: () => void } =
    $props();

  const instead = $derived(undoLabel(setting, holder.under, keys, holder.own));
</script>

{#if instead}
  <span class="chip own"
    >set here<button type="button" aria-label="{instead} {name}" title="{instead} {name}" onclick={onundo}
      ><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1 7 7 M7 1 1 7" stroke="currentColor" stroke-width="1.5" /></svg
      ></button
    ></span
  >
{:else}
  <span class="chip">{tag(setting, holder.own)}</span>
{/if}
