<script lang="ts">
  // The column right of the map: the Repo's switches and room, then the Dispatch form.
  import type { Repo, Status } from "../status";
  import DispatchForm from "./DispatchForm.svelte";
  import Room from "./Room.svelte";
  import Switches from "./Switches.svelte";

  let { repo, status }: { repo: Repo; status: Status } = $props();
</script>

<div class="controls">
  <!-- A new tab starts the column fresh: no other Repo's picks, saves or refusals. -->
  {#key repo.slug}
    <Switches {repo} />
    <Room {repo} {status} />
    <DispatchForm {repo} {status} />
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
