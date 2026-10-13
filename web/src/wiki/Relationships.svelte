<script lang="ts">
  // A Component's Relationship diagram, laid out and drawn as the map is: what
  // uses it on the left, what it uses on the right, each arrow naming its kind.
  // Another Component opens it. Shown only for a Component with one.
  import { layoutRelationships, LINE, type Related } from "./layout";
  import type { Component, Wiki } from "./wiki";

  let { wiki, component, link }: { wiki: Wiki; component: Component; link: (component: string) => string } = $props();

  let room = $state(0);
  const drawn = $derived(room ? layoutRelationships(wiki, component, room) : null);

  /** What a Component's box says of it, in words: each Relationship between it and this one, with its description. */
  function said(c: Related) {
    const name = (id: string) => wiki.components.find((x) => x.id === id)?.name ?? id;
    return (drawn?.arrows ?? [])
      .filter((a) => a.from === c.id || a.to === c.id)
      .map((a) => `${name(a.from)} ${a.kind} ${name(a.to)}${a.description ? `: ${a.description}` : ""}`)
      .join("; ");
  }
</script>

{#snippet box(c: Related)}
  <rect class="ring" x="-3.5" y="-3.5" width={c.width + 7} height={c.height + 7} />
  <rect class="frame" x="0.5" y="0.5" width={c.width - 1} height={c.height - 1} />
  <text x="12" y="26">{#each c.lines as line, i (i)}<tspan x="12" dy={i ? LINE : 0}>{line}</tspan>{/each}</text>
{/snippet}

<div class="room" bind:clientWidth={room}>
  {#if drawn && drawn.arrows.length > 0}
    <svg role="presentation" viewBox="0 0 {drawn.width} {drawn.height}" width={drawn.width} height={drawn.height}>
      <defs>
        <marker id="arrow-relationship" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M2 1 L9 5 L2 9" />
        </marker>
      </defs>
      {#each drawn.arrows as a, i (i)}
        <polyline class="arrow" points={a.points.map((p) => `${p.x},${p.y}`).join(" ")} marker-end="url(#arrow-relationship)" />
        <text class="kind" x={a.at.x} y={a.at.y} aria-hidden="true">{a.label}</text>
      {/each}
      {#each drawn.components as c (c.id)}
        {#if c.here}
          <g class="component here" transform="translate({c.x} {c.y})" aria-hidden="true">{@render box(c)}</g>
        {:else}
          <a class="component" href={link(c.id)} aria-label={said(c)}>
            <title>{said(c)}</title>
            <g transform="translate({c.x} {c.y})">{@render box(c)}</g>
          </a>
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  /* Fitted to the column, never past full size. */
  svg {
    display: block;
    max-width: 100%;
    height: auto;
  }
  /* A blocker's line on the map: a route between its stops. */
  .arrow {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
  }
  marker path {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  text {
    fill: var(--ink);
    font-size: 14px;
    font-weight: 600;
  }
  /* A kind, set on its line, the line knocked out behind it. */
  .kind {
    fill: var(--ink-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-anchor: middle;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 6px;
  }
  .component {
    outline: none;
  }
  .frame {
    fill: var(--surface);
    stroke: var(--hairline);
  }
  a:hover .frame {
    stroke: var(--rule);
  }
  .ring {
    fill: none;
    stroke: none;
    stroke-width: 2;
  }
  a:focus-visible .ring {
    stroke: var(--focus);
  }
  /* The Component whose page it is, framed in full ink. */
  .here .frame {
    stroke: var(--ink);
    stroke-width: 2;
  }
</style>
