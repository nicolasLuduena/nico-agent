<script lang="ts">
  import { onMount } from "svelte";
  import AddRepo from "./controls/AddRepo.svelte";
  import Refresh from "./controls/Refresh.svelte";
  import { watch } from "./live";
  import { flash } from "./motion";
  import NeedsYou from "./NeedsYou.svelte";
  import ProjectTab from "./ProjectTab.svelte";
  import RateGauge from "./RateGauge.svelte";
  import { hash, route } from "./route";
  import { selection } from "./selection.svelte";
  import type { Status } from "./status";
  import { needsYou } from "./toasts";
  import ThemeSwitch from "./ThemeSwitch.svelte";
  import { clock } from "./time";

  let status = $state<Status | null>(null);
  let failure = $state<string | null>(null);

  // The Repos column, its controls secondary to the work: closed until asked for, on each page load.
  let reposOpen = $state(false);
  /** On the Roadmap, which is read-only, Repos opens beside the map. */
  function toggleRepos() {
    reposOpen = !reposOpen || selection.view !== "map";
    if (reposOpen) Object.assign(selection, { view: "map", issue: null, agent: null });
  }

  // The hash selects as a link opens the page, and as back and forward move through it; the selection writes it back,
  // so opening and closing a panel are steps of the history.
  function follow() {
    Object.assign(selection, route(location.hash));
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

  /** An option per Project with a Repo: a Repo naming none is its own. */
  const projects = $derived(status?.projects.filter((p) => p.repos.length > 0) ?? []);
  const project = $derived(projects.find((p) => p.name === selection.project) ?? projects[0]);
  const at = $derived(projects.indexOf(project));
  /** The Project's oldest time of `key`, which holds for each of its Repos; none while any has none. */
  const oldest = (key: "read_at" | "prs_checked_at") => {
    const times = (status?.repos ?? []).filter((r) => project.repos.includes(r.slug)).map((r) => r[key]);
    return times.includes(null) ? null : times.sort()[0];
  };

  /** The option at `i`: a Project's, its view kept. */
  function show(i: number) {
    Object.assign(selection, { project: projects[i].name, issue: null, agent: null });
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

<div class="shell">
  <!-- The Projects on the left; on a phone a bar at the top, the Project chosen in the header's select. -->
  <aside class="rail">
    <p class="brand"><span class="logo" aria-hidden="true">n</span><span class="wordmark">nico-agent</span></p>
    {#if projects.length}
      <nav class="projects" aria-label="Projects">
        <h2 class="rail-head">Projects</h2>
        <ul>
          {#each projects as p (p.name)}
            <li>
              <a href={hash({ project: p.name, view: selection.view })} aria-current={p === project ? "page" : undefined}>
                <span class="name">{p.name}</span>
                {#if p.repos.length > 1 || p.repos[0] !== p.name}<span class="count" aria-hidden="true">{p.repos.length} Repo{p.repos.length === 1 ? "" : "s"}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      </nav>
    {/if}
    <div class="tools">
      {#if status && Object.keys(status.rate_limits).length}
        <RateGauge limits={status.rate_limits} pausedUntil={status.sources.github.paused_until} />
      {/if}
      <ThemeSwitch />
    </div>
  </aside>

  <main>
    {#if failure}
      <p class="errata banner" role="status"><strong>{failure}</strong>{#if status}<span> Showing what was last read.</span>{/if}</p>
    {/if}

    {#if status}
      {#if project}
        {@const read = oldest("read_at")}
        {@const checked = oldest("prs_checked_at")}
        <header class="head">
          <div class="what">
            <label class="pick">
              <span class="field-name">Project</span>
              <select value={at} onchange={(e) => show(Number(e.currentTarget.value))}>
                {#each projects as p, i (p.name)}
                  <option value={i}>{p.name}</option>
                {/each}
              </select>
            </label>
            <h1>{project.name}</h1>
            <p class="times" use:moved={[project.name, `${read} ${checked}`]}>
              {project.repos.length} Repo{project.repos.length === 1 ? "" : "s"}
              · {read ? `Source read ${clock(read)}` : "Source not read yet"}
              · {checked ? `PRs checked ${clock(checked)}` : "PRs not checked yet"}
            </p>
          </div>
          <div class="actions">
            <Refresh />
            <button type="button" class="quiet" aria-expanded={reposOpen && selection.view === "map"} aria-controls="repos" onclick={toggleRepos}>Repos</button>
          </div>
        </header>
        <nav class="views" aria-label="View">
          {#each [["map", "Map"], ["roadmap", "Roadmap"]] as const as [view, name] (view)}
            <a href={hash({ project: project.name, view })} aria-current={selection.view === view ? "page" : undefined}>{name}</a>
          {/each}
        </nav>
        <!-- Between the tabs and the work, in the flow: what needs you without a node, never over the map. -->
        <NeedsYou needs={needsYou(status)} />
        <ProjectTab {project} {status} repos={reposOpen} />
      {:else}
        <NeedsYou needs={needsYou(status)} />
        <section class="empty" aria-labelledby="empty-head">
          <h1 id="empty-head">No Repo yet</h1>
          <p>
            Add a Repo to see its <code>ready-for-agent</code> issues here, on a map of what blocks what. Name it on GitHub, say where
            its clone is, and, to see it with others, the Project it joins. Or run
            <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code>.
          </p>
          <AddRepo {status} />
        </section>
      {/if}
    {:else if !failure}
      <p class="none">Reading nico-agent…</p>
    {/if}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 100vh;
  }
  /* Over the work, so the rate-limit panel it opens is never painted under the map. */
  .rail {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100vh;
    padding: 16px 12px;
    background: var(--surface);
    border-right: 1px solid var(--hairline);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
  }
  .logo {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-control);
    background: var(--ink);
    color: var(--surface);
    font-weight: 700;
  }
  .rail-head {
    padding: 0 8px 6px;
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 600;
  }
  .projects {
    min-height: 0;
    overflow-y: auto;
  }
  .projects ul {
    display: grid;
    gap: 2px;
    padding: 0;
    list-style: none;
  }
  .projects a {
    display: grid;
    gap: 0 8px;
    padding: 8px;
    border-radius: var(--radius-control);
    color: var(--ink);
    text-decoration: none;
  }
  .projects a:hover {
    background: var(--raised);
  }
  .projects a[aria-current="page"] {
    background: var(--accent-soft);
    color: var(--ink);
    font-weight: 600;
  }
  .name {
    overflow-wrap: anywhere;
  }
  .count {
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 400;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: auto;
  }
  main {
    min-width: 0;
    padding: 16px var(--gutter) var(--gutter);
  }
  .banner {
    margin-bottom: 12px;
  }
  .none {
    color: var(--ink-muted);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px 24px;
  }
  .what {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .pick {
    display: none;
  }
  .times {
    color: var(--ink-muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  .actions [aria-expanded="true"] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  /* Map | Roadmap: the Project's two views, as tabs on the header's foot. */
  .views {
    display: flex;
    gap: 4px;
    margin: 12px 0 16px;
    border-bottom: 1px solid var(--hairline);
  }
  .views a {
    padding: 8px 12px;
    margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    color: var(--ink-muted);
    font-weight: 600;
    text-decoration: none;
  }
  .views a:hover {
    color: var(--ink);
  }
  .views a[aria-current="page"] {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .empty {
    display: grid;
    gap: 12px;
    max-width: 720px;
    padding-top: 24px;
  }
  .empty p {
    color: var(--ink-muted);
    max-width: 70ch;
  }

  /* The rail becomes a bar at the top; the Project is chosen in the header's select. */
  @media (width < 720px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      position: relative;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      height: auto;
      padding: 8px var(--gutter);
      border-right: 0;
      border-bottom: 1px solid var(--hairline);
    }
    .brand {
      padding: 0;
    }
    /* The logo alone, so the gauge and the theme switch keep the bar's one line; still read out. */
    .wordmark {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .projects {
      display: none;
    }
    .tools {
      margin: 0 0 0 auto;
    }
    .pick {
      display: grid;
      gap: 4px;
      margin-bottom: 8px;
    }
    h1 {
      display: none;
    }
    .head,
    .what {
      width: 100%;
    }
    .actions {
      justify-content: flex-start;
    }
    .views a {
      flex: 1;
      min-height: 44px;
      display: grid;
      place-items: center;
    }
  }
</style>
