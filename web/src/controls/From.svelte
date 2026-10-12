<script lang="ts">
  // Beside a setting: where it comes from while the Repo (or the Project) does
  // not set it, else the button that removes its own, named for what takes its place.
  import type { Setting } from "../status";
  import { type Holder, tag, undoLabel } from "./settings";

  let {
    setting,
    holder,
    keys,
    name,
    busy,
    onundo,
  }: { setting: Setting<unknown>; holder: Holder; keys: string[]; name: string; busy: boolean; onundo: () => void } = $props();

  const instead = $derived(undoLabel(setting, holder.under, keys, holder.own));
</script>

{#if instead}
  <button type="button" class="quiet" aria-label="{instead} {name}" disabled={busy} onclick={onundo}>{instead}</button>
{:else}
  <span class="label">{tag(setting, holder.own)}</span>
{/if}

<style>
  span {
    color: var(--ink-muted);
  }
</style>
