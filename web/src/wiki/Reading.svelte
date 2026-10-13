<script lang="ts">
  // The open Component of a Wiki, in a reading column: its overview, its
  // Interpretations by kind, each with its Anchors on GitHub, its
  // Relationship diagram, its Explainer, its sub-Components and its Gaps.
  import { blocks, firstLine, spans, type Span } from "../markdown";
  import Anchors from "./Anchors.svelte";
  import Explainer from "./Explainer.svelte";
  import Relationships from "./Relationships.svelte";
  import { KINDS, REASONS, type Component, type Wiki } from "./wiki";

  let {
    wiki,
    component,
    parts,
    link,
  }: { wiki: Wiki; component: Component; parts: Component[]; link: (component: string) => string } = $props();

  const kinds = $derived(
    KINDS.map((kind) => ({ kind, interpretations: component.interpretations.filter((i) => i.kind === kind) })).filter(
      (k) => k.interpretations.length > 0,
    ),
  );

  // Another Component opened takes focus to its name, which scrolls it into view; the first one shown does not.
  let heading: HTMLElement;
  let shown: string | undefined;
  $effect(() => {
    if (shown !== undefined && shown !== component.id) heading.focus();
    shown = component.id;
  });
</script>

{#snippet line(spans: Span[])}{#each spans as span, i (i)}{#if span.kind === "strong"}<strong>{span.text}</strong>{:else if span.kind === "code"}<code>{span.text}</code>{:else if span.kind === "link"}<a href={span.href} target="_blank" rel="noreferrer">{span.text}</a>{:else}{span.text}{/if}{/each}{/snippet}

<article class="reading" aria-labelledby="component-name">
  <h2 id="component-name" class="head" tabindex="-1" bind:this={heading}>{component.name}</h2>

  {#each blocks(component.overview) as block, i (i)}
    {#if block.kind === "list"}
      <svelte:element this={block.ordered ? "ol" : "ul"} class="overview">
        {#each block.items as item, j (j)}
          <li>{@render line(item)}</li>
        {/each}
      </svelte:element>
    {:else}
      <p class="overview">{@render line(block.spans)}</p>
    {/if}
  {/each}

  {#each kinds as { kind, interpretations } (kind)}
    <section aria-labelledby="kind-{kind}">
      <h3 id="kind-{kind}" class="label">{kind}s</h3>
      <ul class="rows">
        {#each interpretations as interpretation (interpretation.id)}
          <li class="interpretation">
            <p>{@render line(spans(interpretation.text))}</p>
            <p class="anchors"><Anchors {wiki} anchors={interpretation.anchors} /></p>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <section aria-labelledby="relationships">
    <h3 id="relationships" class="label">Relationships</h3>
    <Relationships {wiki} {component} {link} />
  </section>

  {#if component.explainer}
    <section aria-labelledby="explainer">
      <h3 id="explainer" class="label">Explainer</h3>
      {#key component.id}
        <Explainer {wiki} explainer={component.explainer} />
      {/key}
    </section>
  {/if}

  {#if parts.length > 0}
    <section aria-labelledby="parts">
      <h3 id="parts" class="label">Components</h3>
      <ul class="rows">
        {#each parts as part (part.id)}
          <li class="part">
            <a href={link(part.id)}>{part.name}</a>
            <span class="gist">{@render line(firstLine(part.overview))}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if component.gaps.length > 0}
    <section aria-labelledby="gaps">
      <h3 id="gaps" class="label">Gaps</h3>
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
</article>

<style>
  /* A sheet laid on the page, as the panel is, its prose at a reading measure. */
  .reading {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 24px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    overflow-wrap: anywhere;
  }
  .head {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
  }
  .overview {
    max-width: 70ch;
  }
  ol.overview {
    margin: 0;
    padding-left: 3ch;
  }
  ul.overview {
    padding-left: 2ch;
  }
  section {
    margin-top: 8px;
  }
  /* A timetable's column head: full ink, on a rule. */
  h3 {
    margin: 0;
    padding: 6px 0 4px;
    border-top: 3px solid var(--rule);
    font-size: 14px;
  }
  .rows {
    padding: 0;
    list-style: none;
  }
  .rows > li {
    padding: 8px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .rows > li:last-child {
    border-bottom: 0;
  }
  /* An Interpretation on the left, the lines it cites in the right column. */
  .interpretation {
    display: grid;
    grid-template-columns: minmax(0, 70ch) minmax(16ch, 1fr);
    gap: 4px 24px;
  }
  .anchors {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-content: start;
    gap: 4px;
  }
  /* A sub-Component's name, then the first line of its overview, on one line. */
  .part {
    display: flex;
    gap: 12px;
    min-width: 0;
  }
  .part a {
    flex: none;
    max-width: 50%;
    font-weight: 600;
  }
  .gist {
    min-width: 0;
    overflow: hidden;
    color: var(--ink-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
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
    padding: 4px 0 0 2ch;
  }

  /* The lines an Interpretation cites go under it. */
  @media (width < 720px) {
    .reading {
      padding: 16px;
    }
    .interpretation {
      grid-template-columns: minmax(0, 1fr);
    }
    .anchors {
      justify-content: flex-start;
    }
  }
</style>
