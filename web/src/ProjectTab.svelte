<script lang="ts">
  // One Project's tab: its map on the left; on the right its defaults, unless
  // it is a Repo's own, then a panel per Repo with its switches, settings and
  // Dispatch form (controls/), or the open node's panel (#253, map/).
  import Controls from "./controls/Controls.svelte";
  import ProjectDefaults from "./controls/ProjectDefaults.svelte";
  import Panel from "./map/Panel.svelte";
  import ProjectMap from "./map/ProjectMap.svelte";
  import { selection } from "./selection.svelte";
  import type { Project, Status } from "./status";

  let { project, status }: { project: Project; status: Status } = $props();

  const repos = $derived(status.repos.filter((r) => project.repos.includes(r.slug)));
  /** A Repo's own Project: its panel is the tab's, as before Projects. */
  const own = $derived(project.repos.length === 1 && project.repos[0] === project.name);
</script>

<div class="work" class:open={selection.issue}>
  <ProjectMap {project} />
  <div class="side">
    {#if selection.issue}
      <Panel issue={selection.issue} {project} />
    {:else}
      {#if !own}
        <ProjectDefaults {project} harnesses={repos[0].harnesses} />
      {/if}
      {#each repos as repo (repo.slug)}
        <Controls {repo} {status} headed={!own} />
      {/each}
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
    display: grid;
    align-content: start;
    gap: 16px;
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
