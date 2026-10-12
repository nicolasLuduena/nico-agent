<script lang="ts">
  // Beside a setting: where it comes from while the Repo does not set it, else
  // the button that removes the Repo's own, named for what takes its place.
  import type { Project, Setting } from "../status";
  import { tag, undo } from "./settings";

  let {
    setting,
    project,
    keys,
    name,
    busy,
    onundo,
  }: { setting: Setting<unknown>; project: Project | undefined; keys: string[]; name: string; busy: boolean; onundo: () => void } = $props();

  const instead = $derived(undo(setting, project, keys));
</script>

{#if instead}
  <button type="button" class="quiet" aria-label="{instead} {name}" disabled={busy} onclick={onundo}>{instead}</button>
{:else}
  <span class="label">{tag(setting)}</span>
{/if}

<style>
  span {
    color: var(--ink-muted);
  }
</style>
