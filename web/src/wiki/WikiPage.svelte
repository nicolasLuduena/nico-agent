<script lang="ts">
  // A Wiki's own page, `/wiki/<id>`, the Wiki alone: a masthead with the way
  // back to the Board, the Wiki and its build in one quiet line (Update,
  // Rebuild and Continue in it), then its Component tree with search beside
  // the open Component and its outline; the tree and the outline as sheets
  // once the window is too narrow for them. The URL's fragment is the open
  // Component, so a link points at one and back and forward move between them.
  import { onMount } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import Refused, { ticked } from "../controls/Refused.svelte";
  import { send, type Sent } from "../controls/send";
  import { reload, watch } from "../live";
  import { fragment, reading } from "../route";
  import { clock } from "../time";
  import Reading from "./Reading.svelte";
  import Sheet from "./Sheet.svelte";
  import { freshness, outline, progressed, search, unexplored, type Component, type Hit, type Listed, type Wiki } from "./wiki";

  /** The Wiki the path names, and the Component the fragment does, which back and forward change. */
  const start = reading(location.pathname, location.hash);
  const id = start?.wiki ?? "";
  let component = $state(start?.component ?? null);

  let listed = $state<Listed[] | null>(null);
  let wiki = $state<Wiki | null>(null);
  /** Why the Wikis, or this one, could not be read; each cleared by its next answer. */
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

  const picked = $derived(listed?.find((w) => w.id === id) ?? null);
  /** Whether it has a Wiki to read: none till its first build ends built. */
  const readable = $derived(picked?.commit != null);
  /** The build a button is asking for, and the answer to the last one asked. */
  let asking = $state<string | null>(null);
  let sent = $state<Sent | null>(null);

  /** Queue its build first, `how` the button asks it. */
  async function build(how: "update" | "rebuild" | "continue") {
    asking = how;
    sent = null;
    sent = await send("POST", `/api/wiki/${encodeURIComponent(id)}/${how}`);
    asking = null;
    reload("/api/wikis");
  }

  $effect(() => {
    if (!readable) return;
    return watch<Wiki>(
      `/api/wiki/${encodeURIComponent(id)}`,
      (got) => {
        wiki = got;
        wikiFailure = null;
      },
      (why) => (wikiFailure = why),
    );
  });

  /** Each Component's sub-Components, by its id; the top one's under null. */
  const children = $derived.by(() => {
    const by = new Map<string | null, Component[]>();
    for (const c of wiki?.components ?? []) by.set(c.parent, [...(by.get(c.parent) ?? []), c]);
    return by;
  });
  /** The Component the fragment names, or the top one. */
  const open = $derived(wiki?.components.find((c) => c.id === component) ?? children.get(null)?.[0]);
  const parts = $derived(open ? (children.get(open.id) ?? []) : []);
  /** Whether a Relationship joins it to another Component, either way. */
  const related = $derived(
    !!open && (open.relationships.length > 0 || (wiki?.components ?? []).some((c) => c.relationships.some((r) => r.to === open.id))),
  );

  const hits = $derived(wiki && query.trim() ? search(wiki, query) : []);
  /** The open Component's name, then each section it shows, with how many it holds: the heads Reading gives ids. */
  const heads = $derived(open ? outline(open, related, parts.length) : []);

  function follow(hit: Hit) {
    opened = null;
    // A copy, so following the same hit again scrolls to it again.
    found = { ...hit };
  }
  function bring(head: string) {
    opened = null;
    const to = document.getElementById(head);
    to?.scrollIntoView();
    to?.focus({ preventScroll: true });
  }
</script>

<svelte:window onhashchange={() => (component = reading(location.pathname, location.hash)?.component ?? null)} />
<svelte:head><title>{open ? `${open.name} · ${id}` : id}</title></svelte:head>

{#snippet branch(parent: string | null)}
  <ul>
    {#each children.get(parent) ?? [] as c (c.id)}
      <li>
        <a
          href={fragment(c.id)}
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

<header class="masthead">
  <a class="board label" href="/">Board</a>
  <p class="id"><strong>{id}</strong></p>
  {#if open && toggles.length > 0}
    <div class="toggles">
      {#each toggles as sheet (sheet)}
        <button type="button" class="quiet" aria-expanded={opened === sheet} aria-controls="wiki-{sheet}" onclick={() => (opened = opened === sheet ? null : sheet)}
          >{TITLES[sheet]}</button
        >
      {/each}
    </div>
  {/if}
  {#if picked}
    <div class="build">
      {#if picked.state === "building"}
        <p role="status">
          <span class="label">Building</span>
          {#if picked.pane}in herdr pane {picked.pane}{/if}
          {#if picked.progress}since {clock(picked.progress.at)}{/if}
        </p>
      {:else if picked.state === "queued"}
        <p role="status"><span class="label">Queued</span></p>
      {/if}
      {#if wiki}
        <p>
          Describes <a href="https://github.com/{wiki.target.repo}/commit/{wiki.commit}" target="_blank" rel="noreferrer">{wiki.commit.slice(0, 7)}</a>
          · Built {clock(wiki.builtAt)}{#if !wiki.target.tag}{" "}· {freshness(wiki)}{/if}{#if picked.budget > 0}{" "}· <span class="kept">{unexplored(picked.budget)}</span>{/if}
        </p>
      {/if}
      <div class="buttons">
        {#if !picked.target.tag}
          <button type="button" class="quiet" disabled={asking !== null} aria-busy={asking === "update"} onclick={() => build("update")}>Update</button>
        {/if}
        <button type="button" class="quiet" disabled={asking !== null} aria-busy={asking === "rebuild"} onclick={() => build("rebuild")}>Rebuild</button>
        {#if picked.budget > 0}
          <button type="button" class="quiet" disabled={asking !== null} aria-busy={asking === "continue"} onclick={() => build("continue")}
            >Continue +{picked.calls} calls</button
          >
        {/if}
      </div>
    </div>
  {/if}
  {#if picked?.state === "failed"}
    <p class="errata whole" role="status"><strong>Last build failed</strong> {@render ticked(picked.why ?? "")}</p>
  {/if}
  {#if picked?.progress}
    <p class="whole progress">
      <span>
        {#each progressed(picked.progress) as segment, n (n)}{n > 0 ? " · " : ""}<span class="kept">{segment}</span>{/each}
      </span>
      {#if picked.progress.now.length > 0}<span class="now">Now on {picked.progress.now.join(", ")}</span>{/if}
    </p>
  {/if}
  {#if sent && !sent.ok}
    <div class="whole">
      <Refused error={sent.error} help={sent.help} />
    </div>
  {/if}
  {#if failure ?? wikiFailure}
    <p class="errata whole" role="status"><strong>{failure ?? wikiFailure}</strong></p>
  {/if}
</header>

<main>
  {#if listed === null}
    {#if !failure}
      <p class="none">Reading the Wiki…</p>
    {/if}
  {:else if !picked}
    <p class="none">No Wiki is named {id}. Each Project's Wikis are listed in its Wiki view on the <a href="/">Board</a>.</p>
  {:else if !readable}
    <p class="none">No Wiki of {id} to read yet: it shows here once a build of it ends built.</p>
  {:else if wiki && open}
    <div class="read">
      <Sheet id="wiki-tree" title={TITLES.tree} folded={phone.current} open={opened === "tree"} close={() => (opened = null)}>
        <input class="find" type="search" placeholder="Search this Wiki" aria-label="Search this Wiki" bind:value={query} />
        {#if query.trim()}
          <p class="found" role="status">{hits.length === 0 ? "Nothing found" : `${hits.length} found`}</p>
          {#if hits.length > 0}
            <nav aria-label="Found">
              <ul class="hits">
                {#each hits as hit, n (n)}
                  <li>
                    <a href={fragment(hit.component.id)} onclick={() => follow(hit)}>
                      <span class="where"
                        ><strong>{hit.component.name}</strong>
                        {#if hit.interpretation}<span class="label">{hit.interpretation.kind}</span>{:else if hit.term}<span class="label">Term</span>{/if}</span
                      >
                      <span class="text"
                        >{#if hit.term}<b>{hit.term.name}</b>:{" "}{/if}{hit.text}</span
                      >
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
      <Reading {wiki} component={open} {parts} {related} link={fragment} {found} />
      <Sheet id="wiki-outline" title={TITLES.outline} folded={narrow.current} open={opened === "outline"} close={() => (opened = null)}>
        <nav aria-label="Outline">
          <ul class="outline">
            {#each heads as head (head.id)}
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
</main>

<style>
  /* One quiet line: the way back and the Wiki on the left, its build on the right; what a build says at length under it. */
  .masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 8px var(--gutter);
    border-bottom: 1px solid var(--hairline);
  }
  .board {
    color: var(--ink);
    text-decoration: none;
  }
  .board:hover {
    text-decoration: underline;
  }
  .id {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .build {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    margin-left: auto;
    color: var(--ink-muted);
  }
  .build a {
    font-weight: 600;
  }
  .buttons,
  .toggles {
    display: flex;
    gap: 8px;
  }
  /* Out of the way of the reading: a size down from the Board's buttons, on a hairline. */
  .masthead .quiet {
    min-height: 28px;
    padding: 0 12px;
    border-color: var(--hairline);
  }
  .masthead .quiet:hover:not(:disabled) {
    border-color: var(--rule);
  }
  .whole {
    flex-basis: 100%;
    order: 2;
  }
  .errata {
    display: block;
  }
  .progress {
    display: flex;
    flex-wrap: wrap;
    gap: 0 16px;
    min-width: 0;
  }
  .kept {
    white-space: nowrap;
  }
  .now {
    min-width: 0;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  .none {
    padding: 24px var(--gutter);
    color: var(--ink-muted);
  }

  /* The tree, the Component and its outline, side by side, the three together centred on a wide screen. */
  .read {
    display: grid;
    grid-template-columns: 240px minmax(0, 880px) 200px;
    justify-content: center;
    align-items: start;
    gap: 32px;
    padding: 24px var(--gutter) 32px;
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
  /* A Term's name in its hit, as the sheet sets it. */
  .text b {
    font-weight: 600;
    color: var(--ink);
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
      gap: 24px;
    }
  }
  /* The tree too, and the sheet goes edge to edge; the build takes a line of its own under the Wiki, its buttons running on at the end of its words. */
  @media (width < 720px) {
    .build {
      display: block;
      order: 1;
      flex-basis: 100%;
      margin-left: 0;
    }
    .build > p {
      display: inline;
      margin-right: 12px;
    }
    .buttons {
      display: inline-flex;
      vertical-align: middle;
    }
    .toggles {
      margin-left: auto;
    }
    .read {
      grid-template-columns: minmax(0, 1fr);
      padding: 0 0 32px;
    }
  }
</style>
