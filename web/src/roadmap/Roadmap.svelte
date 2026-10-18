<script lang="ts">
  // The Project's Roadmap from /api/roadmap/<project>, refetched on every
  // `changed`: every open issue of its Repos the loop does not work, a lane
  // per label left to right, its Blockers' arrows drawn as the map's. A node
  // opens a read-only panel. Nothing on it writes anywhere.
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

  // How far the field is scrolled sideways, and how wide it shows: a fade at an edge with more past it.
  let scrolled = $state(0);
  let shown = $state(0);
  const past = $derived({ left: scrolled > 0, right: !!drawn && scrolled + shown < drawn.width - 1 });

  const said = (key: string, repo: string, title: string, lane: string) => [numbered(key, repo, project.repos), title, lane].join(", ");
</script>

<div class="work" class:open={opened}>
  <section
    class="field"
    aria-label="Roadmap of {project.name}"
    bind:clientWidth={shown}
    onscroll={(e) => (scrolled = e.currentTarget.scrollLeft)}
  >
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
          <button
            type="button"
            class="node-card"
            class:selected={open === n.key}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{CARD.width}px"
            style:height="{CARD.height}px"
            aria-label={said(n.key, n.repo, n.title, n.lane)}
            aria-pressed={open === n.key}
            title={n.title}
            onclick={() => (open = open === n.key ? null : n.key)}
          >
            <span class="title">{n.title}</span>
            <span class="ref">{number(n.key, n.repo)}{#if repo}<span class="muted">{` · ${repo}`}</span>{/if}</span>
          </button>
        {/each}
        {#if past.left}<div class="past left" aria-hidden="true"></div>{/if}
        {#if past.right}<div class="past right" aria-hidden="true"></div>{/if}
      </div>
      {#if failure}<p class="errata stale" role="status">Showing the last Roadmap read. {failure}</p>{/if}
    {:else if drawn}
      <p class="note">Nothing on this Roadmap: every open issue of its Repos is labelled <code>ready-for-agent</code>, or none is open.</p>
    {:else}
      {#if failure}
        <p class="note errata" role="status"><strong>Could not read the Roadmap.</strong> {failure}</p>
      {:else}
        <p class="note">Reading the Roadmap…</p>
      {/if}
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
    gap: 16px;
  }
  .work.open {
    grid-template-columns: minmax(0, 1fr) clamp(320px, 30vw, 400px);
  }
  /* The rest of the window under the header, as the map's: the page never scrolls past it. */
  @media (width >= 720px) {
    .work {
      flex: 1 1 0;
      grid-template-rows: minmax(0, 1fr);
      min-height: 360px;
    }
  }
  /* At full size; a Roadmap wider or taller than the field scrolls inside it. */
  .field {
    position: relative;
    container-type: inline-size;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  /* Its fades sit in a row in it, each held to an edge of the field's view. */
  .drawn {
    position: relative;
    display: flex;
  }
  /* More of the Roadmap past this edge: what runs under it fades into the field, never cut mid-word. */
  .past {
    position: sticky;
    flex: none;
    width: 64px;
    pointer-events: none;
  }
  .past.left {
    left: 0;
    background: linear-gradient(to left, transparent, var(--surface));
  }
  .past.right {
    left: calc(100cqw - 64px);
    background: linear-gradient(to right, transparent, var(--surface));
  }
  svg {
    position: absolute;
    inset: 0;
  }
  .note {
    margin: 16px;
    color: var(--ink-muted);
    max-width: 70ch;
  }
  .errata.note {
    color: var(--ink);
  }
  .stale {
    position: sticky;
    left: 8px;
    bottom: 8px;
    margin: 8px;
  }
  .lane {
    fill: var(--ground);
    stroke: var(--hairline);
    rx: 8px;
  }
  /* A lane's name on its frame's top line, the line knocked out behind it. */
  .lane-name {
    fill: var(--ink-muted);
    font-size: 13px;
    font-weight: 600;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 6px;
  }
  /* A Blocker's line, as on the map. */
  .arrow {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }
  marker path {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }

  /* The Roadmap, then the sheet over it. */
  @media (width < 720px) {
    .work,
    .work.open {
      grid-template-columns: minmax(0, 1fr);
    }
    .field {
      height: 60vh;
      min-height: 0;
    }
  }
</style>
