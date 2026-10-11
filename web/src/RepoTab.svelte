<script lang="ts">
  // One Repo's tab: its map on the left; on the right its switches and
  // Dispatch form (#254, controls/), or the open node's panel (#253, map/).
  import Controls from "./controls/Controls.svelte";
  import Panel from "./map/Panel.svelte";
  import RepoMap from "./map/RepoMap.svelte";
  import { selection } from "./selection.svelte";
  import type { Repo, Status } from "./status";

  let { repo, status }: { repo: Repo; status: Status } = $props();
</script>

<div class="work" class:open={selection.issue}>
  <RepoMap {repo} />
  <div class="side">
    {#if selection.issue}
      <Panel issue={selection.issue} />
    {:else}
      <Controls {repo} {status} />
    {/if}
  </div>
</div>

<style>
  .work {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    padding: 16px var(--gutter) var(--gutter);
  }
  .work.open {
    grid-template-columns: minmax(0, 1fr) 400px;
  }
  .side {
    min-width: 0;
  }

  /* The map, then the column below it. */
  @media (width < 720px) {
    .work,
    .work.open {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
  }
</style>
