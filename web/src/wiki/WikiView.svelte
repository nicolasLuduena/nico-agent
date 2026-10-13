<script lang="ts">
  // A Project's Wiki view: a picker of its Repos' Wikis and of the Library
  // versions they link, the open one's
  // header, its Component tree with search over it, the open Component in a
  // reading column and its outline; the tree and the outline as sheets once
  // the window is too narrow for them beside the Component.
  import { onMount } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { watch } from "../live";
  import { hash } from "../route";
  import { selection } from "../selection.svelte";
  import type { Project } from "../status";
  import { clock } from "../time";
  import Reading from "./Reading.svelte";
  import Sheet from "./Sheet.svelte";
  import { byKind, search, type Component, type Hit, type Listed, type Wiki } from "./wiki";

  let { project, libraries }: { project: Project; libraries: string[] } = $props();

  let listed = $state<Listed[] | null>(null);
  let wiki = $state<Wiki | null>(null);
  /** Why the Wikis, or the open one, could not be read; each cleared by its next answer. */
  let failure = $state<string | null>(null);
  let wikiFailure = $state<string | null>(null);
  /** The tree folds into a sheet on a phone, the outline under 1080px too; at most one is open. */
  const TITLES = { tree: "Components", outline: "Outline" } as const;
  type Fold = keyof typeof TITLES;
  const phone = new MediaQuery("(width < 720px)");
  const narrow = new MediaQuery("(width < 1080px)");
  let opened = $state<Fold | null>(null);
  const toggles = $derived<Fold[]>(phone.current ? ["tree", "outline"] : narrow.current ? ["outline"] : []);
  let query = $state("");
  /** The search hit last followed, for Reading to scroll to. */
  let found = $state.raw<Hit | null>(null);

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

  /** The built Wikis of its Repos, then of the Library versions they link, by id. */
  const wikis = $derived([...project.repos, ...libraries].flatMap((id) => (listed ?? []).filter((w) => w.id === id)));
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
  const parts = $derived(open ? (children.get(open.id) ?? []) : []);
  const link = (component: string) => hash({ project: project.name, view: "wiki", wiki: id, component });

  const hits = $derived(wiki && query.trim() ? search(wiki, query) : []);
  /** The open Component's name, then each section it shows, with how many it holds: the heads Reading gives ids. */
  const outline = $derived(
    open
      ? [
          { id: "component-name", name: open.name, count: null },
          ...byKind(open).map((k) => ({ id: `kind-${k.kind}`, name: `${k.kind[0].toUpperCase()}${k.kind.slice(1)}s`, count: k.interpretations.length })),
          { id: "relationships", name: "Relationships", count: null },
          ...(open.explainer ? [{ id: "explainer", name: "Explainer", count: open.explainer.steps.length }] : []),
          ...(parts.length > 0 ? [{ id: "parts", name: "Components", count: parts.length }] : []),
          ...(open.gaps.length > 0 ? [{ id: "gaps", name: "Gaps", count: open.gaps.length }] : []),
        ]
      : [],
  );

  function pick(chosen: string) {
    found = null;
    Object.assign(selection, { wiki: chosen, component: null });
  }
  function follow(hit: Hit) {
    opened = null;
    // A copy, so following the same hit again scrolls to it again.
    found = { ...hit };
  }
  function bring(head: string) {
    opened = null;
    const at = document.getElementById(head);
    at?.scrollIntoView();
    at?.focus({ preventScroll: true });
  }
</script>

{#snippet branch(parent: string | null)}
  <ul>
    {#each children.get(parent) ?? [] as c (c.id)}
      <li>
        <a
          href={link(c.id)}
          aria-current={c.id === open?.id ? "page" : undefined}
          onclick={() => {
            opened = null;
            found = null;
          }}>{c.name}</a
        >
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
      {#if open && toggles.length > 0}
        <div class="toggles">
          {#each toggles as sheet (sheet)}
            <button
              type="button"
              class="quiet"
              aria-expanded={opened === sheet}
              aria-controls="wiki-{sheet}"
              onclick={() => (opened = opened === sheet ? null : sheet)}>{TITLES[sheet]}</button
            >
          {/each}
        </div>
      {/if}
    </header>

    {#if wiki && open}
      <div class="read">
        <Sheet id="wiki-tree" title={TITLES.tree} folded={phone.current} open={opened === "tree"} close={() => (opened = null)}>
          <input class="find" type="search" placeholder="Search this Wiki" aria-label="Search this Wiki" bind:value={query} />
          {#if query.trim()}
            <p class="found" role="status">{hits.length === 0 ? "Nothing found" : `${hits.length} found`}</p>
            {#if hits.length > 0}
              <nav aria-label="Found">
                <ul class="hits">
                  {#each hits as hit (`${hit.component.id} ${hit.interpretation?.id ?? ""}`)}
                    <li>
                      <a href={link(hit.component.id)} onclick={() => follow(hit)}>
                        <span class="where"
                          ><strong>{hit.component.name}</strong>
                          {#if hit.interpretation}<span class="label">{hit.interpretation.kind}</span>{/if}</span
                        >
                        <span class="text">{hit.text}</span>
                      </a>
                    </li>
                  {/each}
                </ul>
              </nav>
            {/if}
          {:else}
            <nav class="tree" aria-label="Components">
              {@render branch(null)}
            </nav>
          {/if}
        </Sheet>
        <Reading {wiki} component={open} {parts} {link} {found} />
        <Sheet id="wiki-outline" title={TITLES.outline} folded={narrow.current} open={opened === "outline"} close={() => (opened = null)}>
          <nav aria-label="Outline">
            <ul class="outline">
              {#each outline as head (head.id)}
                <li>
                  <button type="button" onclick={() => bring(head.id)}
                    >{head.name}{#if head.count !== null}{" "}<span class="count">{head.count}</span>{/if}</button
                  >
                </li>
              {/each}
            </ul>
          </nav>
        </Sheet>
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

  /* The tree, the Component and its outline, side by side. */
  .read {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 200px;
    align-items: start;
    gap: 24px;
  }
  .toggles {
    display: flex;
    gap: 8px;
  }
  .find {
    width: 100%;
    min-height: 36px;
    margin-bottom: 8px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
  }
  .find::placeholder {
    color: var(--ink-muted);
  }
  .found {
    padding-bottom: 4px;
    color: var(--ink-muted);
  }
  .tree ul,
  .hits,
  .outline {
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
  .tree a:hover,
  .hits a:hover strong,
  .outline button:hover {
    text-decoration: underline;
  }
  /* The open Component, underlined with the rule as the active tab is. */
  .tree a[aria-current="page"] {
    font-weight: 600;
    text-decoration: underline 3px var(--rule);
    text-underline-offset: 5px;
  }
  /* A hit: where it is, then its text in two lines at most. */
  .hits a {
    display: grid;
    gap: 2px;
    padding: 8px 0;
    border-bottom: 1px solid var(--hairline);
    color: var(--ink);
    text-decoration: none;
  }
  .where {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .where .label,
  .text {
    color: var(--ink-muted);
  }
  .text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .outline button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 4px 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .outline li:first-child button {
    font-weight: 600;
  }
  .count {
    color: var(--ink-muted);
  }

  /* The outline goes behind its button. */
  @media (width < 1080px) {
    .read {
      grid-template-columns: 240px minmax(0, 1fr);
    }
  }
  /* The tree too; the header's two lines stack. */
  @media (width < 720px) {
    .built {
      margin-left: 0;
      text-align: left;
    }
    .read {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
    .toggles {
      flex-basis: 100%;
    }
  }
</style>
