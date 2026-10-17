<script lang="ts">
  // The Project's Roadmap from /api/roadmap/<project>, refetched on every
  // `changed`: every open issue of its Repos the loop does not work, a lane
  // per label left to right, its Blockers' arrows drawn as the map's. A node
  // opens a read-only panel. Nothing on it writes anywhere.
  import { repoLine } from "../hues";
  import { watch } from "../live";
  import { number, numbered, repoName, type Project } from "../status";
  import Issue from "./Issue.svelte";
  import { CARD, layoutRoadmap, type RoadmapData } from "./layout";

  let { project }: { project: Project } = $props();

  let data = $state<RoadmapData | null>(null);
  let failure = $state<string | null>(null);
  let open = $state<string | null>(null);
  const drawn = $derived(data && layoutRoadmap(data));
  const opened = $derived(data?.nodes.find((n) => n.key === open) ?? null);

  // The Project's name, not its object: each status read makes a new one.
  const name = $derived(project.name);
  $effect(() => {
    data = null;
    failure = null;
    open = null;
    return watch<RoadmapData>(
      `/api/roadmap/${encodeURIComponent(name)}`,
      (got) => {
        data = got;
        failure = null;
      },
      (why) => (failure = why),
    );
  });

  const said = (key: string, repo: string, title: string, lane: string) => [numbered(key, repo, project.repos), title, lane].join(", ");
</script>

<div class="work" class:open={opened}>
  <section class="field" aria-label="Roadmap of {project.name}">
    {#if drawn && drawn.nodes.length > 0}
      <div class="drawn" style:width="{drawn.width}px" style:height="{drawn.height}px">
        <svg role="presentation" width={drawn.width} height={drawn.height}>
          <defs>
            <marker id="arrow-roadmap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M2 1 L9 5 L2 9" />
            </marker>
          </defs>
          {#each drawn.lanes as lane (lane.name)}
            <rect class="lane" x={lane.x + 0.5} y={lane.y + 0.5} width={lane.width - 1} height={lane.height - 1} />
            <text class="lane-name" x={lane.x + 12} y={lane.y}>{lane.name}</text>
          {/each}
          {#each drawn.arrows as a (`${a.from} ${a.to}`)}
            <polyline class="arrow" points={a.points.map((p) => `${p.x},${p.y}`).join(" ")} marker-end="url(#arrow-roadmap)" />
          {/each}
        </svg>
        {#each drawn.nodes as n (n.key)}
          {@const repo = repoName(n.repo, project.repos)}
          {@const line = repoLine(n.repo, project)}
          <button
            type="button"
            class="node"
            class:selected={open === n.key}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{CARD.width}px"
            style:height="{CARD.height}px"
            aria-label={said(n.key, n.repo, n.title, n.lane)}
            aria-pressed={open === n.key}
            onclick={() => (open = open === n.key ? null : n.key)}
          >
            <span class="first">
              <span class="number">{number(n.key, n.repo)}</span>
              {#if repo}<span class="repo">{#if line}<span class="swatch" style:--line={line}></span>{/if}{repo}</span>{/if}
            </span>
            <span class="title">{n.title}</span>
          </button>
        {/each}
      </div>
    {:else if drawn}
      <p class="note">Nothing on this Roadmap: every open issue of its Repos is labelled <code>ready-for-agent</code>, or none is open.</p>
    {:else}
      <p class="note">{failure ?? "Reading the Roadmap…"}</p>
    {/if}
  </section>
  {#if opened}
    {#key opened.key}
      <Issue node={opened} {project} close={() => (open = null)} />
    {/key}
  {/if}
</div>

<style>
  .work {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    padding: 16px var(--gutter) var(--gutter);
  }
  .work.open {
    grid-template-columns: minmax(0, 1fr) 400px;
  }
  /* At full size; a Roadmap wider or taller than the field scrolls inside it. */
  .field {
    min-height: 60vh;
    max-height: calc(100vh - 32px);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  .drawn {
    position: relative;
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .note {
    padding: 16px;
    color: var(--ink-muted);
    max-width: 70ch;
  }
  .lane {
    fill: none;
    stroke: var(--hairline);
  }
  /* A lane's name on its frame's top line, the line knocked out behind it, as the Explainer's. */
  .lane-name {
    fill: var(--ink-muted);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 6px;
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

  /* The map's node: its number and Repo on the first row, its title on the second. */
  .node {
    position: absolute;
    display: grid;
    align-content: start;
    gap: 6px;
    padding: 8px 12px;
    text-align: left;
    color: var(--ink);
    font: inherit;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 0;
    cursor: pointer;
  }
  .node:hover {
    border-color: var(--rule);
  }
  .node:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .first {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .number {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .repo {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-muted);
    font-weight: 600;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 4px;
    background: var(--line);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The selected node: the page's one reversed element. */
  .node.selected {
    color: var(--reversed-ink);
    background: var(--reversed);
    border-color: var(--reversed);
  }
  .node.selected .repo {
    color: var(--reversed-ink);
  }

  /* The Roadmap, then the sheet over it. */
  @media (width < 720px) {
    .work,
    .work.open {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
    .field {
      height: 60vh;
      min-height: 0;
    }
  }
</style>
