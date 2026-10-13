<script lang="ts">
  // A Component's Explainer: its title, then its steps as numbered boxes
  // laid out and drawn as the map's nodes are, each lane framing its own. A
  // step opens the Anchors it cites under the drawing.
  import { NODE } from "../map/layout";
  import Anchors from "./Anchors.svelte";
  import { explainer as layout, LINE, type Placed } from "./layout";
  import type { Explainer, Wiki } from "./wiki";

  let { wiki, explainer }: { wiki: Wiki; explainer: Explainer } = $props();

  let room = $state(0);
  const drawn = $derived(room ? layout(explainer, room) : null);
  /** The step whose Anchors show. */
  let open = $state<number | null>(null);
  const step = $derived(explainer.steps.find((s) => s.n === open));

  const toggle = (n: number) => (open = open === n ? null : n);
  const said = (s: Placed) => `Step ${s.n}${s.lane ? `, ${s.lane}` : ""}: ${s.caption}`;
</script>

<p class="title"><strong>{explainer.title}</strong></p>

<div class="room" bind:clientWidth={room}>
  {#if drawn}
    <svg role="presentation" viewBox="0 0 {drawn.width} {drawn.height}" width={drawn.width} height={drawn.height}>
      <defs>
        <marker id="arrow-step" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M2 1 L9 5 L2 9" />
        </marker>
      </defs>
      {#each drawn.lanes as lane (lane.name)}
        <rect class="lane" x={lane.x + 0.5} y={lane.y + 0.5} width={lane.width - 1} height={lane.height - 1} />
        <text class="lane-name" x={lane.x + 12} y={lane.y} aria-hidden="true">{lane.name}</text>
      {/each}
      {#each drawn.arrows as a, i (i)}
        <polyline class="arrow" points={a.points.map((p) => `${p.x},${p.y}`).join(" ")} marker-end="url(#arrow-step)" />
        {#if a.label}<text class="label-on" x={a.at.x} y={a.at.y} aria-hidden="true">{a.label}</text>{/if}
      {/each}
      {#each drawn.steps as s (s.n)}
        <g
          class="step"
          class:selected={open === s.n}
          transform="translate({s.x} {s.y})"
          role="button"
          tabindex="0"
          aria-label={said(s)}
          aria-expanded={open === s.n}
          aria-controls="explainer-step"
          onclick={() => toggle(s.n)}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(s.n))}
        >
          <rect class="ring" x="-3.5" y="-3.5" width={s.width + 7} height={s.height + 7} />
          <rect class="frame" x="0.5" y="0.5" width={s.width - 1} height={s.height - 1} />
          <text class="number" x="12" y="30">{s.n}</text>
          <text class="cites" x={NODE.width - 12} y="27">{s.anchors.length === 1 ? "1 Anchor" : `${s.anchors.length} Anchors`}</text>
          <text x="12" y="53">{#each s.lines as line, i (i)}<tspan x="12" dy={i ? LINE : 0}>{line}</tspan>{/each}</text>
        </g>
      {/each}
    </svg>
  {/if}
</div>

<div id="explainer-step" class="opened">
  {#if step}
    <p><strong class="n">{step.n}</strong> {step.caption}</p>
    <p class="anchors"><Anchors {wiki} anchors={step.anchors} /></p>
  {:else}
    <p class="none">Open a step for the lines it cites.</p>
  {/if}
</div>

<style>
  .title {
    max-width: 70ch;
  }
  /* Fitted to the column, never past full size. */
  svg {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .lane {
    fill: none;
    stroke: var(--hairline);
  }
  /* A lane's name on its frame's top line, the line knocked out behind it. */
  .lane-name,
  .label-on {
    fill: var(--ink-muted);
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 6px;
  }
  .lane-name {
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .label-on {
    text-anchor: middle;
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
  }
  .step {
    cursor: pointer;
    outline: none;
  }
  .frame {
    fill: var(--surface);
    stroke: var(--hairline);
  }
  .step:hover .frame {
    stroke: var(--rule);
  }
  .ring {
    fill: none;
    stroke: none;
    stroke-width: 2;
  }
  .step:focus-visible .ring {
    stroke: var(--focus);
  }
  /* The step's number, set as a map node's issue number: its departure time. */
  .number {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .cites {
    fill: var(--ink-muted);
    text-anchor: end;
  }
  /* The open step: reversed, as the map's selected node. */
  .selected .frame {
    fill: var(--reversed);
    stroke: var(--reversed);
  }
  .selected text {
    fill: var(--reversed-ink);
  }
  .opened {
    display: grid;
    gap: 4px;
    max-width: 70ch;
  }
  .n {
    margin-right: 4px;
  }
  .anchors {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .none {
    color: var(--ink-muted);
  }
</style>
