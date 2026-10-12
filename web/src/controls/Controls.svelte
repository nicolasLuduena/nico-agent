<script lang="ts">
  // The column right of the map: the Dispatch form, then the Repo's room and its switches.
  import type { Repo, Status } from "../status";
  import DispatchForm from "./DispatchForm.svelte";
  import Room from "./Room.svelte";
  import Switches from "./Switches.svelte";

  let { repo, status }: { repo: Repo; status: Status } = $props();
</script>

<div class="controls">
  <!-- A new tab starts the column fresh: no other Repo's picks, saves or refusals. -->
  {#key repo.slug}
    <DispatchForm {repo} {status} />
    <Room {repo} {status} />
    <Switches {repo} />
  {/key}
</div>

<style>
  .controls {
    display: grid;
    gap: 16px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  .controls :global(h2) {
    font-size: 14px;
  }
  .controls > :global(section + section) {
    padding-top: 16px;
    border-top: 1px solid var(--hairline);
  }
</style>
