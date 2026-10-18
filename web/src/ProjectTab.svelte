<script lang="ts">
  // One Project's work, its map or its Roadmap (the views are picked in App): every open issue the loop does
  // not work (roadmap/). The map on the left; on the right the open node's
  // inspector (#253, map/), or its agent's panel (#435), or, while the Repos column is open, its defaults,
  // unless it is a Repo's own, then a panel per Repo with its Dispatch form,
  // switches and settings (controls/), and Add a Repo.
  import AddRepo from "./controls/AddRepo.svelte";
  import Controls from "./controls/Controls.svelte";
  import ProjectDefaults from "./controls/ProjectDefaults.svelte";
  import AgentPanel from "./map/AgentPanel.svelte";
  import Panel from "./map/Panel.svelte";
  import ProjectMap from "./map/ProjectMap.svelte";
  import Roadmap from "./roadmap/Roadmap.svelte";
  import { selection } from "./selection.svelte";
  import type { Project, Status } from "./status";

  let { project, status, repos: reposOpen }: { project: Project; status: Status; repos: boolean } = $props();

  const repos = $derived(status.repos.filter((r) => project.repos.includes(r.slug)));
  /** A Repo's own Project: its panel is the Project's, as before Projects. */
  const own = $derived(project.repos.length === 1 && project.repos[0] === project.name);
</script>

{#if selection.view === "roadmap"}
  <Roadmap {project} />
{:else}
  <div class="work" class:open={selection.issue} class:side-open={selection.issue || reposOpen}>
    <ProjectMap {project} />
    {#if selection.issue}
      <div class="side">
        {#if selection.agent}
          <!-- Another agent's panel starts over: its own reads, focus on its title. -->
          {#key `${selection.issue} ${selection.agent}`}
            <AgentPanel issue={selection.issue} role={selection.agent} {project} />
          {/key}
        {:else}
          <Panel issue={selection.issue} {project} />
        {/if}
      </div>
    {:else if reposOpen}
      <div class="side" id="repos" role="region" aria-label="Repos">
        {#if !own}
          <ProjectDefaults {project} harnesses={repos[0].harnesses} />
        {/if}
        {#each repos as repo (repo.slug)}
          <Controls {repo} {status} headed={!own} />
        {/each}
        <AddRepo {status} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .work {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .work.side-open {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
  /* 400px, narrower on a narrow desk, so the map beside it keeps room to read. */
  .work.open {
    grid-template-columns: minmax(0, 1fr) clamp(320px, 30vw, 400px);
  }
  .side {
    display: grid;
    align-content: start;
    gap: 16px;
    min-width: 0;
  }
  /* The rest of the window under the header: the map fills it, and the column beside it scrolls inside it, the one scroll for what it holds. */
  @media (width >= 720px) {
    .work {
      flex: 1 1 0;
      grid-template-rows: minmax(0, 1fr);
      min-height: 360px;
    }
    .side {
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
  }

  /* The map, then the column below it. */
  @media (width < 720px) {
    .work,
    .work.side-open,
    .work.open {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
  }
</style>
