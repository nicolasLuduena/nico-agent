<script lang="ts">
  // The open Component of a Wiki, as a page to read: its trail, its name,
  // its overview, its Interpretations in the build's order, each with its
  // kind in the margin and its Anchors quietly under it, then whichever of
  // its Relationship diagram, its Explainer, its sub-Components and its Gaps
  // it has, and the next Component in the tree's order.
  import { blocks, spans, type Span } from "../markdown";
  import { flash } from "../motion";
  import Anchors from "./Anchors.svelte";
  import Explainer from "./Explainer.svelte";
  import Relationships from "./Relationships.svelte";
  import { cited, fileUrl, gist, named, next, REASONS, trail, type Component, type Hit, type Wiki } from "./wiki";

  let {
    wiki,
    component,
    parts,
    related,
    link,
    found,
  }: {
    wiki: Wiki;
    component: Component;
    parts: Component[];
    /** Whether a Relationship joins it to another Component, either way. */
    related: boolean;
    link: (component: string) => string;
    /** The search hit last followed: a new one each time, shown once its Component is. */
    found: Hit | null;
  } = $props();

  const above = $derived(trail(wiki, component));
  const after = $derived(next(wiki, component));
  /** The one file its Anchors cite, said once above them; else each Anchor names its file. */
  const file = $derived(cited(component));
  const name = $derived.by(() => {
    if (file) return null;
    const anchors = [...component.interpretations, ...(component.explainer?.steps ?? [])].flatMap((x) => x.anchors);
    return named([...new Set(anchors.map((a) => a.path))]);
  });

  // Another Component opened takes focus to its name, which scrolls it into view; the first one shown does not.
  // A search hit, once its Component shows, scrolls to its Interpretation, focuses it and flashes it, once.
  let heading: HTMLElement;
  let shown: string | undefined;
  let followed: Hit | null = null;
  $effect(() => {
    const id = component.id;
    if (found && found !== followed && found.component.id === id) {
      followed = found;
      const row = found.interpretation && document.getElementById(`interpretation-${found.interpretation.id}`);
      if (row) {
        row.scrollIntoView({ block: "center" });
        row.focus({ preventScroll: true });
        flash(row);
      } else heading.focus();
    } else if (shown !== undefined && shown !== id) heading.focus();
    shown = id;
  });
</script>

{#snippet line(spans: Span[])}{#each spans as span, i (i)}{#if span.kind === "strong"}<strong>{span.text}</strong>{:else if span.kind === "code"}<code>{span.text}</code>{:else if span.kind === "link"}<a href={span.href} target="_blank" rel="noreferrer">{span.text}</a>{:else}{span.text}{/if}{/each}{/snippet}

<article class="reading" aria-labelledby="component-name">
  <div class="inner">
    {#if above.length > 0}
      <nav class="trail" aria-label="Trail">
        <ol>
          {#each above as c (c.id)}
            <li><a href={link(c.id)}>{c.name}</a><span class="by" aria-hidden="true">›</span></li>
          {/each}
        </ol>
      </nav>
    {/if}
    <h1 id="component-name" class="title" tabindex="-1" bind:this={heading}>{component.name}</h1>
    {#if file}
      <p class="file">
        Every line it cites is in <a href={fileUrl(wiki, file)} target="_blank" rel="noreferrer">{file}</a>
      </p>
    {/if}

    <div class="text">
      {#each blocks(component.overview) as block, i (i)}
        {#if block.kind === "list"}
          <svelte:element this={block.ordered ? "ol" : "ul"} class="overview">
            {#each block.items as item, j (j)}
              <li>{@render line(item)}</li>
            {/each}
          </svelte:element>
        {:else}
          <p>{@render line(block.spans)}</p>
        {/if}
      {/each}
    </div>

    {#if component.interpretations.length > 0}
      <section aria-labelledby="head-interpretations">
        <h2 id="head-interpretations" class="label" tabindex="-1">Interpretations</h2>
        <ol class="claims">
          {#each component.interpretations as interpretation (interpretation.id)}
            <li class="claim" id="interpretation-{interpretation.id}" tabindex="-1">
              <span class="label kind">{interpretation.kind}</span>
              <div class="said">
                <p>
                  {#if interpretation.stale}<span class="label stale">Stale</span>{" "}{/if}{@render line(spans(interpretation.text))}
                </p>
                <p class="cites"><Anchors {wiki} anchors={interpretation.anchors} {name} /></p>
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if related}
      <section class="wide" aria-labelledby="head-relationships">
        <h2 id="head-relationships" class="label" tabindex="-1">Relationships</h2>
        <Relationships {wiki} {component} {link} />
      </section>
    {/if}

    {#if component.explainer}
      <section class="wide" aria-labelledby="head-explainer">
        <h2 id="head-explainer" class="label" tabindex="-1">Explainer</h2>
        {#key component.id}
          <Explainer {wiki} explainer={component.explainer} {name} />
        {/key}
      </section>
    {/if}

    {#if parts.length > 0}
      <section aria-labelledby="head-parts">
        <h2 id="head-parts" class="label" tabindex="-1">Components</h2>
        <ul class="rows">
          {#each parts as part (part.id)}
            <li>
              <a class="part" href={link(part.id)}>{part.name}</a>
              <p>{@render line(spans(gist(part.overview)))}</p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if component.gaps.length > 0}
      <section aria-labelledby="head-gaps">
        <h2 id="head-gaps" class="label" tabindex="-1">Gaps</h2>
        <ul class="rows">
          {#each component.gaps as gap, n (n)}
            <li class="gap">
              <strong>{REASONS[gap.reason]}</strong>
              <details>
                <summary>{gap.paths.length} {gap.paths.length === 1 ? "file" : "files"}</summary>
                <ul>
                  {#each gap.paths as path (path)}
                    <li>{path}</li>
                  {/each}
                </ul>
              </details>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if after}
      <a class="next" href={link(after.id)}><span class="label">Next</span> <span class="name">{after.name}</span></a>
    {/if}
  </div>
</article>

<style>
  /* A sheet laid on the page, its text at a reading size and measure; each
     kind hangs in a margin left of its sentence once the sheet has room for
     one, and the diagrams and the way on take the margin too. */
  .reading {
    container-type: inline-size;
    min-width: 0;
    padding: 32px 40px 40px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    font-size: 18px;
    line-height: 1.6;
    overflow-wrap: break-word;
  }
  .inner {
    --margin: 0px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    padding-left: var(--margin);
  }
  .inner > :not(.wide, .next) {
    max-width: 68ch;
  }
  /* The outline brings a head to the top of the window, a little below its edge. */
  .title,
  h2 {
    scroll-margin-top: 16px;
  }
  .trail ol {
    display: flex;
    flex-wrap: wrap;
    padding: 0;
    margin: 0 0 8px;
    list-style: none;
    font-size: 14px;
    line-height: 1.45;
  }
  .trail a {
    color: var(--ink-muted);
    text-decoration: none;
  }
  .trail a:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .by {
    padding: 0 8px;
    color: var(--ink-muted);
  }
  .title {
    font-size: 32px;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  /* Its name takes focus as it opens, for the keyboard's sake; only a keyboard's focus is ringed. */
  .title:focus:not(:focus-visible),
  h2:focus:not(:focus-visible) {
    outline: none;
  }
  .file {
    margin-top: 8px;
    color: var(--ink-muted);
    font-size: 14px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .file a {
    color: inherit;
    font-weight: 600;
  }
  .text {
    display: grid;
    gap: 16px;
    margin-top: 24px;
  }
  .text ol,
  .text ul {
    margin: 0;
    padding-left: 1.5em;
  }
  section {
    margin-top: 40px;
  }
  /* A diagram takes the margin too: it needs the room more than the measure. */
  .wide {
    margin-left: calc(-1 * var(--margin));
  }
  /* Each section's head at the sheet's edge, over the margin, as a timetable's section heads are. */
  h2 {
    margin: 0 0 8px calc(-1 * var(--margin));
    font-size: 14px;
  }
  .wide h2 {
    margin-left: 0;
  }
  .claims,
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .claims > li,
  .rows > li {
    padding: 12px 0;
    border-top: 1px solid var(--hairline);
  }
  .rows > li {
    margin-left: calc(-1 * var(--margin));
    padding-left: var(--margin);
  }
  /* The kind above its sentence; in the margin, on the sentence's baseline, once there is one, as a timetable's row head. */
  .claim {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: baseline;
    margin-left: calc(-1 * var(--margin));
  }
  .kind {
    color: var(--ink-muted);
    font-size: 14px;
  }
  @container (width >= 600px) {
    .inner {
      --margin: 144px;
    }
    .claim {
      grid-template-columns: var(--margin) minmax(0, 1fr);
    }
  }
  /* A search hit keeps its focus ring until focus moves on, so the eye finds it. */
  .claim:focus {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
  }
  /* A file it cites changed on the Base: said before the sentence, never hidden. */
  .stale {
    margin-right: 4px;
    color: var(--ink-muted);
    font-size: 14px;
  }
  .cites {
    display: flex;
    flex-wrap: wrap;
    gap: 0 16px;
    margin-top: 2px;
    font-size: 14px;
    line-height: 1.45;
  }
  .part {
    font-weight: 600;
  }
  .gap {
    display: grid;
    gap: 4px;
  }
  summary {
    color: var(--ink-muted);
    cursor: pointer;
  }
  details ul {
    margin: 0;
    padding: 4px 0 0 1.5em;
    font-size: 14px;
  }
  /* The way on, as a book's last page names the next chapter: the word and the name on one line. */
  .next {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: baseline;
    gap: 4px 12px;
    margin-top: 48px;
    margin-left: calc(-1 * var(--margin));
    padding-top: 16px;
    border-top: 1px solid var(--rule);
    text-align: right;
    text-decoration: none;
  }
  .next .label {
    color: var(--ink-muted);
    font-size: 14px;
  }
  .next .name {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
  }
  .next:hover .name {
    text-decoration: underline;
  }

  /* Edge to edge on a phone, the text a size down. */
  @media (width < 720px) {
    .reading {
      padding: 24px var(--gutter) 32px;
      border-width: 1px 0;
      font-size: 17px;
      line-height: 1.55;
    }
    .title {
      font-size: 26px;
    }
  }
</style>
