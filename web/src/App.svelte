<script lang="ts">
  import { onMount } from "svelte";
  import AddRepo from "./controls/AddRepo.svelte";
  import Libraries from "./Libraries.svelte";
  import Refresh from "./controls/Refresh.svelte";
  import { watch } from "./live";
  import { flash } from "./motion";
  import NeedsYou from "./NeedsYou.svelte";
  import ProjectTab from "./ProjectTab.svelte";
  import RateGauge from "./RateGauge.svelte";
  import { hash, movedTo, route } from "./route";
  import { selection } from "./selection.svelte";
  import type { Status } from "./status";
  import { needsYou } from "./toasts";
  import ThemeSwitch from "./ThemeSwitch.svelte";
  import { clock } from "./time";

  let status = $state<Status | null>(null);
  let failure = $state<string | null>(null);

  // The hash selects as a link opens the page, and as back and forward move through it; the selection writes it back.
  // An old link to a Wiki's Component on the Board opens its page instead.
  function follow() {
    const to = movedTo(location.hash);
    if (to) return location.replace(to);
    const at = route(location.hash);
    if (at.project !== selection.project) selection.issue = null;
    Object.assign(selection, at);
  }
  follow();
  $effect(() => {
    const want = hash(selection);
    if (want !== hash(route(location.hash))) location.hash = want;
  });

  onMount(() =>
    watch<Status>(
      "/api/status",
      (got) => {
        status = got;
        failure = null;
      },
      (why) => (failure = why),
    ),
  );

  /** An option per Project with a Repo: a Repo naming none is its own; then Libraries, of no Project. */
  const projects = $derived(status?.projects.filter((p) => p.repos.length > 0) ?? []);
  const onLibraries = $derived(selection.project === null && selection.view === "libraries");
  const project = $derived(projects.find((p) => p.name === selection.project) ?? projects[0]);
  const at = $derived(onLibraries ? projects.length : projects.indexOf(project));
  /** The Project's oldest time of `key`, which holds for each of its Repos; none while any has none. */
  const oldest = (key: "read_at" | "prs_checked_at") => {
    const times = (status?.repos ?? []).filter((r) => project.repos.includes(r.slug)).map((r) => r[key]);
    return times.includes(null) ? null : times.sort()[0];
  };

  /** The option at `i`: a Project's, its view kept, or past them Libraries. */
  function show(i: number) {
    const libraries = i === projects.length;
    const view = libraries ? "libraries" : selection.view === "libraries" ? "map" : selection.view;
    Object.assign(selection, { project: libraries ? null : projects[i].name, view, issue: null });
  }

  /** The read times flash once when a read moves them, not when another Project shows its own. */
  function moved(el: HTMLElement, [name, times]: [string, string]) {
    return {
      update([nextName, nextTimes]: [string, string]) {
        if (nextName === name && nextTimes !== times) flash(el);
        [name, times] = [nextName, nextTimes];
      },
    };
  }

</script>

<svelte:window onhashchange={follow} />

<header class="top">
  <h1 class="label">nico-agent</h1>
  <div class="tools">
    {#if status && Object.keys(status.rate_limits).length}
      <RateGauge limits={status.rate_limits} pausedUntil={status.sources.github.paused_until} />
    {/if}
    <ThemeSwitch />
  </div>
</header>

<main>
  {#if failure}
    <p class="errata" role="status"><strong>{failure}</strong></p>
  {/if}

  {#if status}
    <NeedsYou needs={needsYou(status)} projects={status.projects} />

    {#if project}
      {@const read = oldest("read_at")}
      {@const checked = oldest("prs_checked_at")}
      <div class="bar">
        <label class="pick">
          <span class="label">Project</span>
          <select value={at} onchange={(e) => show(Number(e.currentTarget.value))}>
            {#each projects as p, i (p.name)}
              <option value={i}>{p.name}</option>
            {/each}
            <option value={projects.length}>Libraries</option>
          </select>
        </label>
        {#if !onLibraries}
          <nav class="views" aria-label="View">
            {#each [["map", "Map"], ["wiki", "Wiki"], ["roadmap", "Roadmap"]] as const as [view, name] (view)}
              <a
                class="label"
                href={hash({ project: project.name, view })}
                aria-current={selection.view === view ? "page" : undefined}>{name}</a
              >
            {/each}
          </nav>
        {/if}
        <!-- At the row's right; under the select and the views when they leave it no room. -->
        <div class="read">
          {#if !onLibraries}
            <p class="times" use:moved={[project.name, `${read} ${checked}`]}>
              {read ? `Source read ${clock(read)}` : "Source not read yet"}
              · {checked ? `PRs checked ${clock(checked)}` : "PRs not checked yet"}
            </p>
          {/if}
          <Refresh />
        </div>
      </div>
      {#if onLibraries}
        <Libraries {status} />
      {:else}
        <ProjectTab {project} {status} />
      {/if}
    {:else}
      <p class="none">No Repo yet. Add one below, or with <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code>.</p>
    {/if}
    <AddRepo {status} />
  {:else if !failure}
    <p class="none">Reading nico-agent…</p>
  {/if}
</main>

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    position: relative;
    padding: 12px var(--gutter);
  }
  /* Under the wordmark, at the right, when the phone leaves them no room beside it. */
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  h1 {
    font-size: 14px;
    white-space: nowrap;
  }
  .errata {
    margin: 0 var(--gutter) 12px;
  }
  .none {
    padding: 16px var(--gutter);
    color: var(--ink-muted);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 24px;
    margin: 0 var(--gutter);
    padding: 8px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  select {
    min-width: 0;
    font-weight: 600;
  }
  /* Map | Wiki | Roadmap: the Project's three views. */
  .views {
    display: flex;
    gap: 24px;
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
  .read {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0 16px;
    margin-left: auto;
  }
  .times {
    color: var(--ink-muted);
    text-align: right;
  }

  /* The select takes its own line; the read times and Refresh wrap under the views. */
  @media (width < 720px) {
    .pick {
      flex: 1 1 100%;
    }
    select {
      flex: 1;
    }
  }
</style>
