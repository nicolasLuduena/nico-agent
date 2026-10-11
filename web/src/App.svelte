<script lang="ts">
  import { onMount } from "svelte";
  import Refresh from "./controls/Refresh.svelte";
  import { watch } from "./live";
  import NeedsYou from "./NeedsYou.svelte";
  import RepoTab from "./RepoTab.svelte";
  import { selection } from "./selection.svelte";
  import type { Status } from "./status";
  import { needsYou } from "./strip";
  import ThemeSwitch from "./ThemeSwitch.svelte";
  import { clock } from "./time";

  let status = $state<Status | null>(null);
  let failure = $state<string | null>(null);

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

  const repos = $derived(status?.repos ?? []);
  const repo = $derived(repos.find((r) => r.slug === selection.repo) ?? repos[0]);

  function show(slug: string) {
    selection.repo = slug;
    selection.issue = null;
  }

  /** The tabs' arrow keys, Home and End: the next tab shows, and takes focus. */
  function step(event: KeyboardEvent) {
    const at = repos.indexOf(repo);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: repos.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const slug = repos[(to + repos.length) % repos.length].slug;
    show(slug);
    document.getElementById(`tab-${slug}`)?.focus();
  }
</script>

<header class="top">
  <h1 class="label">nico-agent</h1>
  <ThemeSwitch />
</header>

<main>
  <!-- The morning summary's slot (spec 3): the page's first section, nothing until morning.md exists. -->

  {#if failure}
    <p class="errata" role="status">{failure}</p>
  {/if}

  {#if status}
    <NeedsYou needs={needsYou(status)} />

    {#if repo}
      <div class="bar">
        <div class="tabs" role="tablist" aria-label="Repos">
          {#each repos as r (r.slug)}
            <button
              type="button"
              role="tab"
              id="tab-{r.slug}"
              aria-selected={r === repo}
              aria-controls="repo-tab"
              tabindex={r === repo ? 0 : -1}
              onclick={() => show(r.slug)}
              onkeydown={step}>{r.slug}</button
            >
          {/each}
        </div>
        <label class="pick">
          <span class="label">Repo</span>
          <select value={repo.slug} onchange={(e) => show(e.currentTarget.value)}>
            {#each repos as r (r.slug)}
              <option value={r.slug}>{r.slug}</option>
            {/each}
          </select>
        </label>
        <p class="times">
          {repo.read_at ? `Source read ${clock(repo.read_at)}` : "Source not read yet"}
          · {repo.prs_checked_at ? `PRs checked ${clock(repo.prs_checked_at)}` : "PRs not checked yet"}
        </p>
        <Refresh />
      </div>
      <div role="tabpanel" id="repo-tab" aria-labelledby="tab-{repo.slug}">
        <RepoTab {repo} {status} />
      </div>
    {:else}
      <p class="none">No Repo yet. Add one with <code>nico-agent repo add &lt;owner/name&gt; --path &lt;clone&gt;</code>.</p>
    {/if}
  {:else if !failure}
    <p class="none">Reading the status…</p>
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
    padding: 0 var(--gutter) 12px;
    color: var(--failed);
    font-weight: 600;
  }
  .none {
    padding: 16px var(--gutter);
    color: var(--ink-muted);
  }
  code {
    font: inherit;
    font-weight: 600;
    color: var(--ink);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0 var(--gutter);
    border-bottom: 1px solid var(--hairline);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    margin-right: auto;
  }
  [role="tab"] {
    padding: 12px 16px;
    border: 0;
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--ink-muted);
    font-weight: 600;
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
    outline-offset: -4px;
  }
  .pick {
    display: none;
  }
  .times {
    color: var(--ink-muted);
    text-align: right;
  }

  /* The tabs become one select named Repo; the read times and Refresh wrap under it. */
  @media (width < 720px) {
    .bar {
      flex-wrap: wrap;
      gap: 8px 16px;
      padding-bottom: 12px;
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
      border: 1px solid var(--rule);
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
