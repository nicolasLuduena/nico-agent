<script lang="ts">
  import { onMount } from "svelte";
  import AddRepo from "./controls/AddRepo.svelte";
  import Libraries from "./Libraries.svelte";
  import Refresh from "./controls/Refresh.svelte";
  import { watch } from "./live";
  import Morning from "./Morning.svelte";
  import { flash } from "./motion";
  import NeedsYou from "./NeedsYou.svelte";
  import ProjectTab from "./ProjectTab.svelte";
  import { hash, movedTo, route } from "./route";
  import { selection } from "./selection.svelte";
  import type { Status } from "./status";
  import { needsYou } from "./strip";
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

  /** A tab per Project with a Repo: a Repo naming none is its own; then the Libraries tab, of no Project. */
  const projects = $derived(status?.projects.filter((p) => p.repos.length > 0) ?? []);
  const onLibraries = $derived(selection.project === null && selection.view === "libraries");
  const project = $derived(projects.find((p) => p.name === selection.project) ?? projects[0]);
  const at = $derived(onLibraries ? projects.length : projects.indexOf(project));
  /** The Project's oldest time of `key`, which holds for each of its Repos; none while any has none. */
  const oldest = (key: "read_at" | "prs_checked_at") => {
    const times = (status?.repos ?? []).filter((r) => project.repos.includes(r.slug)).map((r) => r[key]);
    return times.includes(null) ? null : times.sort()[0];
  };

  /** The tab at `i`: a Project's, its view kept, or past them the Libraries tab. */
  function show(i: number) {
    const libraries = i === projects.length;
    const view = libraries ? "libraries" : selection.view === "libraries" ? "map" : selection.view;
    Object.assign(selection, { project: libraries ? null : projects[i].name, view, issue: null });
  }

  /** The read times flash once when a read moves them, not when another Project's tab shows its own. */
  function moved(el: HTMLElement, [name, times]: [string, string]) {
    return {
      update([nextName, nextTimes]: [string, string]) {
        if (nextName === name && nextTimes !== times) flash(el);
        [name, times] = [nextName, nextTimes];
      },
    };
  }

  /** The tabs' arrow keys, Home and End: the next tab shows, and takes focus. */
  function step(event: KeyboardEvent) {
    const tabs = projects.length + 1;
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = (to + tabs) % tabs;
    show(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
</script>

<svelte:window onhashchange={follow} />

<header class="top">
  <h1 class="label">nico-agent</h1>
  <ThemeSwitch />
</header>

<main>
  <!-- The Morning summary: the page's first section, nothing until morning.md exists. -->
  {#if status?.morning_summary?.trim()}
    <Morning text={status.morning_summary} />
  {/if}

  {#if failure}
    <p class="errata" role="status"><strong>{failure}</strong></p>
  {/if}

  {#if status}
    <NeedsYou needs={needsYou(status)} projects={status.projects} />

    {#if project}
      {@const read = oldest("read_at")}
      {@const checked = oldest("prs_checked_at")}
      <div class="bar">
        <div class="tabs" role="tablist" aria-label="Projects">
          {#each projects as p, i (p.name)}
            <button
              type="button"
              role="tab"
              id="tab-{i}"
              aria-selected={i === at}
              aria-controls="project-tab"
              tabindex={i === at ? 0 : -1}
              onclick={() => show(i)}
              onkeydown={step}>{p.name}</button
            >
          {/each}
          <button
            type="button"
            role="tab"
            id="tab-{projects.length}"
            aria-selected={onLibraries}
            aria-controls="project-tab"
            tabindex={onLibraries ? 0 : -1}
            onclick={() => show(projects.length)}
            onkeydown={step}>Libraries</button
          >
        </div>
        <label class="pick">
          <span class="label">Project</span>
          <select value={at} onchange={(e) => show(Number(e.currentTarget.value))}>
            {#each projects as p, i (p.name)}
              <option value={i}>{p.name}</option>
            {/each}
            <option value={projects.length}>Libraries</option>
          </select>
        </label>
        <!-- Beside the tabs; above them when long Project names leave no room, so the tabs stay on the baseline. -->
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
      <div role="tabpanel" id="project-tab" aria-labelledby="tab-{at}">
        {#if onLibraries}
          <Libraries {status} />
        {:else}
          <ProjectTab {project} {status} />
        {/if}
      </div>
    {:else}
      <p class="none">No Repo yet. Add one here, or with <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code>.</p>
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
    padding: 12px var(--gutter);
  }
  h1 {
    font-size: 14px;
  }
  .errata {
    margin: 0 var(--gutter) 12px;
  }
  .none {
    padding: 16px var(--gutter);
    color: var(--ink-muted);
  }
  /* Wrapping in reverse: a line that does not fit goes above the tabs, never between them and their baseline. */
  .bar {
    display: flex;
    flex-wrap: wrap-reverse;
    align-items: center;
    gap: 12px 16px;
    margin: 0 var(--gutter);
    padding-top: 8px;
    border-bottom: 1px solid var(--hairline);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    column-gap: 24px;
    margin-right: auto;
  }
  /* Each Project's name heads its work, set as DESIGN.md's `head`, its rule as wide as the name. */
  [role="tab"] {
    padding: 10px 0 8px;
    border: 0;
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--ink-muted);
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
  }
  [role="tab"]:hover {
    color: var(--ink);
  }
  [role="tab"][aria-selected="true"] {
    color: var(--ink);
    border-bottom-color: var(--rule);
  }
  [role="tab"]:focus-visible {
    outline-offset: 2px;
  }
  .pick {
    display: none;
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

  /* The tabs become one select named Project; the read times and Refresh wrap under it. */
  @media (width < 720px) {
    .bar {
      flex-wrap: wrap;
      gap: 8px 16px;
      padding-top: 0;
      padding-bottom: 12px;
    }
    .read {
      flex: 1 1 100%;
      margin-left: 0;
    }
    .tabs {
      display: none;
    }
    .pick {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1 1 100%;
      padding-top: 4px;
    }
    select {
      flex: 1;
      min-width: 0;
      min-height: 36px;
      padding: 0 8px;
      border: 1px solid var(--ink-muted);
      border-radius: 2px;
      background: var(--surface);
      font-weight: 600;
    }
    .times {
      margin-right: auto;
      text-align: left;
    }
  }
</style>
