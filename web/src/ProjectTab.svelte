<script lang="ts">
  // One Project's tab, its map or its Wiki view, the list of its Wikis
  // (wiki/), each read on its own page. The map on the left;
  // on the right its defaults, unless it is a Repo's own, then a panel per
  // Repo with its switches, settings and Dispatch form (controls/), or the
  // open node's panel (#253, map/).
  import Controls from "./controls/Controls.svelte";
  import ProjectDefaults from "./controls/ProjectDefaults.svelte";
  import Panel from "./map/Panel.svelte";
  import ProjectMap from "./map/ProjectMap.svelte";
  import { hash } from "./route";
  import { selection } from "./selection.svelte";
  import type { Project, Status } from "./status";
  import { libraryId } from "./wiki/wiki";
  import WikiView from "./wiki/WikiView.svelte";

  let { project, status }: { project: Project; status: Status } = $props();

  const repos = $derived(status.repos.filter((r) => project.repos.includes(r.slug)));
  /** The Library versions its Repos link, by id, each once. */
  const linked = $derived([...new Set(repos.flatMap((r) => r.libraries.value.map(libraryId)))]);
  /** A Repo's own Project: its panel is the tab's, as before Projects. */
  const own = $derived(project.repos.length === 1 && project.repos[0] === project.name);
</script>

<nav class="views" aria-label="View">
  {#each [["map", "Map"], ["wiki", "Wiki"]] as const as [view, name] (view)}
    <a
      class="label"
      href={hash({ project: project.name, view })}
      aria-current={selection.view === view ? "page" : undefined}>{name}</a
    >
  {/each}
</nav>

{#if selection.view === "wiki"}
  <WikiView {project} libraries={linked} settings={status.wiki_settings} />
{:else}
  <div class="work" class:open={selection.issue}>
    <ProjectMap {project} dispatches={status.dispatches} />
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
{/if}

<style>
  /* Map | Wiki: the tab's two views, set as the Project tabs are, a size down. */
  .views {
    display: flex;
    gap: 24px;
    padding: 12px var(--gutter) 0;
  }
  .views a {
    padding: 4px 0;
    border-bottom: 3px solid transparent;
    color: var(--ink-muted);
    text-decoration: none;
  }
  .views a:hover {
    color: var(--ink);
  }
  .views a[aria-current="page"] {
    color: var(--ink);
    border-bottom-color: var(--rule);
  }
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
