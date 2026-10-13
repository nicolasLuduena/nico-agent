<script lang="ts">
  // A Project's Wiki view: a picker of its Repos' Wikis, the open one's
  // header, its Component tree and the open Component in a reading column.
  import { onMount } from "svelte";
  import { watch } from "../live";
  import { hash } from "../route";
  import { selection } from "../selection.svelte";
  import type { Project } from "../status";
  import { clock } from "../time";
  import Reading from "./Reading.svelte";
  import type { Component, Listed, Wiki } from "./wiki";

  let { project }: { project: Project } = $props();

  let listed = $state<Listed[] | null>(null);
  let wiki = $state<Wiki | null>(null);
  /** Why the Wikis, or the open one, could not be read; each cleared by its next answer. */
  let failure = $state<string | null>(null);
  let wikiFailure = $state<string | null>(null);
  /** On a phone, the tree shows over the column only once asked for. */
  let treeOpen = $state(false);

  onMount(() =>
    watch<Listed[]>(
      "/api/wikis",
      (got) => {
        listed = got;
        failure = null;
      },
      (why) => (failure = why),
    ),
  );

  const wikis = $derived((listed ?? []).filter((w) => project.repos.includes(w.target.repo)));
  /** The Wiki the hash names, or the Project's first. */
  const id = $derived((wikis.find((w) => w.id === selection.wiki) ?? wikis[0])?.id ?? null);

  $effect(() => {
    if (id === null) return;
    // An answer for the Wiki shown before is dropped.
    let shown = true;
    wiki = null;
    const stop = watch<Wiki>(
      `/api/wiki/${encodeURIComponent(id)}`,
      (got) => {
        if (!shown) return;
        wiki = got;
        wikiFailure = null;
      },
      (why) => shown && (wikiFailure = why),
    );
    return () => {
      shown = false;
      stop();
    };
  });

  /** Each Component's sub-Components, by its id; the top one's under null. */
  const children = $derived.by(() => {
    const by = new Map<string | null, Component[]>();
    for (const c of wiki?.components ?? []) by.set(c.parent, [...(by.get(c.parent) ?? []), c]);
    return by;
  });
  /** The Component the hash names, or the top one. */
  const open = $derived(wiki?.components.find((c) => c.id === selection.component) ?? children.get(null)?.[0]);
  const link = (component: string) => hash({ project: project.name, view: "wiki", wiki: id, component });

  function pick(chosen: string) {
    Object.assign(selection, { wiki: chosen, component: null });
  }
</script>

{#snippet branch(parent: string | null)}
  <ul>
    {#each children.get(parent) ?? [] as c (c.id)}
      <li>
        <a href={link(c.id)} aria-current={c.id === open?.id ? "page" : undefined} onclick={() => (treeOpen = false)}>{c.name}</a>
        {#if children.has(c.id)}
          {@render branch(c.id)}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="wiki">
  {#if failure ?? wikiFailure}
    <p class="errata" role="status"><strong>{failure ?? wikiFailure}</strong></p>
  {/if}

  {#if listed === null}
    {#if !failure}
      <p class="none">Reading the Wikis…</p>
    {/if}
  {:else if wikis.length === 0}
    <div class="none">
      <p>No Wiki of {project.name} yet. Build one by Repo; it describes the code at the Repo's Base, each claim citing its lines:</p>
      {#each project.repos as slug (slug)}
        <p><code>nico-agent wiki build {slug}</code></p>
      {/each}
    </div>
  {:else}
    <header>
      <label class="pick">
        <span class="label">Wiki</span>
        <select value={id} onchange={(e) => pick(e.currentTarget.value)}>
          {#each wikis as w (w.id)}
            <option value={w.id}>{w.id}</option>
          {/each}
        </select>
      </label>
      {#if wiki}
        <p class="built">
          Describes <a href="https://github.com/{wiki.target.repo}/commit/{wiki.commit}" target="_blank" rel="noreferrer"
            >{wiki.commit.slice(0, 7)}</a
          >
          · Built {clock(wiki.builtAt)}
        </p>
      {/if}
    </header>

    {#if wiki && open}
      <div class="read" class:tree-open={treeOpen}>
        <button type="button" class="quiet toggle" aria-expanded={treeOpen} aria-controls="wiki-tree" onclick={() => (treeOpen = !treeOpen)}
          >Components</button
        >
        <nav id="wiki-tree" class="tree" aria-label="Components">
          {@render branch(null)}
        </nav>
        <Reading {wiki} component={open} parts={children.get(open.id) ?? []} {link} />
      </div>
    {:else if !wikiFailure}
      <p class="none">Reading the Wiki of {id}…</p>
    {/if}
  {/if}
</div>

<style>
  .wiki {
    display: grid;
    gap: 16px;
    padding: 16px var(--gutter) var(--gutter);
  }
  .none {
    display: grid;
    gap: 8px;
    color: var(--ink-muted);
  }
  /* The picker on the left, the commit and build time in the right column. */
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 24px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  select {
    min-width: 0;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
    font-weight: 600;
  }
  .built {
    margin-left: auto;
    color: var(--ink-muted);
    text-align: right;
  }
  .built a {
    font-weight: 600;
  }

  /* The tree beside the reading column, staying in view beside a long Component. */
  .read {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    align-items: start;
    gap: 24px;
  }
  .toggle {
    display: none;
  }
  .tree {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .tree ul {
    padding: 0;
    list-style: none;
  }
  .tree ul ul {
    margin-left: 4px;
    padding-left: 8px;
    border-left: 1px solid var(--hairline);
  }
  .tree a {
    display: block;
    padding: 4px 0 4px 4px;
    color: var(--ink);
    text-decoration: none;
  }
  .tree a:hover {
    text-decoration: underline;
  }
  /* The open Component, underlined with the rule as the active tab is. */
  .tree a[aria-current="page"] {
    font-weight: 600;
    text-decoration: underline 3px var(--rule);
    text-underline-offset: 5px;
  }

  /* The tree folds behind a button over the column. */
  @media (width < 720px) {
    .built {
      margin-left: 0;
      text-align: left;
    }
    .read {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    .toggle {
      display: block;
      justify-self: start;
    }
    .tree {
      display: none;
      position: static;
      max-height: none;
      padding: 8px 12px;
      background: var(--surface);
      border: 1px solid var(--hairline);
    }
    .tree-open .tree {
      display: block;
    }
  }
</style>
