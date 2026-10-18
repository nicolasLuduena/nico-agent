<script module lang="ts">
  import type { MapData } from "./layout";

  /** The map on show, for the panel to read what a node already knows. */
  export const shown = $state<{ map: MapData | null }>({ map: null });
</script>

<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  // The Project's map from /api/map/<project>, refetched on every `changed`:
  // dagre lays out each group of linked issues left to right, the groups packed
  // to the field's shape (layout.ts); the field pans and zooms, a node opens its
  // inspector. Each node is a card: its title first, then its number and Repo,
  // then its Stage in words beside its mark and its PR, then a row per live
  // agent, which opens that agent's panel.
  import { flushSync, tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { watch } from "../live";
  import { still } from "../motion";
  import { selection } from "../selection.svelte";
  import { stageHue } from "../hues";
  import { number, numbered, repoName, type Project } from "../status";
  import AgentDot from "./AgentDot.svelte";
  import { layout, NODE, ROLE, SAYS, withoutMerged, type Placed, type Role } from "./layout";
  import Mark from "./Mark.svelte";

  let { project }: { project: Project } = $props();

  /** A phone's agent rows are 44px targets at the map's least scale. */
  const phone = new MediaQuery("(width < 720px)");

  const PAD = 16;
  let failure = $state<string | null>(null);
  /** The nodes whose Stage the last refetch changed: their Stage cell flashes once. */
  let flashed = $state(new Set<string>());
  let width = $state(0);
  let height = $state(0);
  /** The map's scale; the field's own scroll is where it is panned to. */
  let k = $state(1);
  /** The room the map was last packed into: the field, less its padding, when it was last fitted, and since, while no one has zoomed it. */
  let room = $state({ width: 0, height: 0 });
  /** The Project (and Hide merged) the map was last fitted to, and the issue it last panned to. */
  let fitted: string | null = null;
  let panned: string | null = null;

  // "Hide merged", remembered in this browser for every Project's map.
  const HIDE_MERGED = "nico-agent.hide-merged";
  let hideMerged = $state(remembered());
  function remembered() {
    try {
      return localStorage.getItem(HIDE_MERGED) === "1";
    } catch {
      return false;
    }
  }
  function toggleMerged() {
    hideMerged = !hideMerged;
    try {
      localStorage.setItem(HIDE_MERGED, hideMerged ? "1" : "0");
    } catch {
      // Kept for this visit only.
    }
  }
  const merged = $derived(shown.map?.nodes.filter((n) => n.stage === "Merged").length ?? 0);

  const agentRow = $derived(phone.current ? NODE.touchAgent : NODE.agent);
  const drawn = $derived(shown.map && room.width ? layout(hideMerged ? withoutMerged(shown.map) : shown.map, room, agentRow) : null);

  // The Project's name, not its object: each status read makes a new one, and the map
  // (and the panel reading it) must not start over on every change.
  const name = $derived(project.name);
  $effect(() => {
    shown.map = null;
    failure = null;
    return watch<MapData>(
      `/api/map/${encodeURIComponent(name)}`,
      (got) => {
        const before = new Map(shown.map?.nodes.map((n) => [n.key, n.stage]));
        flashed = new Set(got.nodes.filter((n) => before.has(n.key) && before.get(n.key) !== n.stage).map((n) => n.key));
        shown.map = got;
        failure = null;
      },
      (why) => (failure = why),
    );
  });

  /** The least the map fits at: a node's 15px title at 13px on screen. */
  const FLOOR = 0.87;

  /**
   * The scale that fits the map to the field, at most full size; when that is
   * under the floor, it fits the width only, never under the floor, and the
   * rest pans inside the field from its top left.
   */
  const scale = $derived.by(() => {
    if (!drawn) return 1;
    const across = (width - 2 * PAD) / drawn.width;
    const fit = Math.min(1, across, (height - 2 * PAD) / drawn.height);
    return fit >= FLOOR ? fit : Math.max(FLOOR, Math.min(1, across));
  });

  /** Where the drawing sits in the field's scroll: padded, or centred while it is smaller than the field. */
  const off = $derived({
    x: drawn ? Math.max(PAD, (width - drawn.width * k) / 2) : PAD,
    y: drawn ? Math.max(PAD, (height - drawn.height * k) / 2) : PAD,
  });

  const behavior = (): ScrollBehavior => (still() ? "auto" : "smooth");

  /** The scale the last Fit set: while the map is still at it, it follows the field's size. */
  let fitK = 1;

  /** Fit: the fitting scale, the map from its top left. */
  function fit(smooth = true) {
    k = fitK = scale;
    field.scrollTo({ left: 0, top: 0, behavior: smooth ? behavior() : "auto" });
  }

  /** Zoom by `by` about the field's middle: the zoom buttons. */
  function zoomStep(by: number) {
    const rect = field.getBoundingClientRect();
    zoom(by, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  $effect(() => {
    if (shown.map && width && height && fitted !== `${project.name} ${hideMerged}`) {
      fitted = `${project.name} ${hideMerged}`;
      untrack(() => {
        room = { width: width - 2 * PAD, height: height - 2 * PAD };
        fit(false);
      });
    }
  });

  // The field resized (the inspector opened, the window changed): a map no one has zoomed since its Fit is
  // packed to the field's new shape and fits it again, so it scrolls only when even that is past the floor.
  $effect(() => {
    const now = { width: width - 2 * PAD, height: height - 2 * PAD };
    untrack(() => {
      if (fitted && k === fitK && (now.width !== room.width || now.height !== room.height)) room = now;
    });
  });
  $effect(() => {
    const now = scale;
    untrack(() => {
      if (fitted && k === fitK) k = fitK = now;
    });
  });

  /** Scroll `key`'s node into the middle of the field, and the field onto the screen, when any of it is out of view. */
  function reveal(key: string) {
    const node = field.querySelector(`[data-key="${key}"]`);
    if (!node) return;
    const [box, view] = [node.getBoundingClientRect(), field.getBoundingClientRect()];
    const inside = box.left >= view.left && box.top >= view.top && box.right <= view.left + field.clientLeft + field.clientWidth && box.bottom <= view.top + field.clientTop + field.clientHeight;
    const at: ScrollLogicalPosition = inside ? "nearest" : "center";
    node.scrollIntoView({ block: at, inline: at, behavior: behavior() });
  }

  // An opened node: scroll to it, once per opening, once the inspector has narrowed the field.
  let field: HTMLElement;
  $effect(() => {
    const key = selection.issue;
    const n = drawn?.nodes.find((n) => n.key === key);
    if (!key) panned = null;
    if (!n || panned === key) return;
    panned = key;
    void tick().then(() => reveal(n.key));
  });

  /** Open `key`'s panel, or with `agent` that agent's, in its place. */
  function open(key: string, agent: Role | null = null) {
    // The Project named too: none is chosen yet while the first one shows by default.
    Object.assign(selection, { project: project.name, issue: key, agent });
  }

  // A mouse drag pans the field's scroll, a finger's scrolls it natively; pinch, or Ctrl and the
  // wheel, zoom. A drag only takes the pointer once it has moved, so a click on a node stays a click.
  const pointers = new Map<number, { x: number; y: number }>();
  /** Zoom by `by` about `at` (client px), the map's point under it kept there. */
  function zoom(by: number, at: { x: number; y: number }) {
    const rect = field.getBoundingClientRect();
    const [px, py] = [at.x - rect.left - field.clientLeft, at.y - rect.top - field.clientTop];
    const [mx, my] = [(field.scrollLeft + px - off.x) / k, (field.scrollTop + py - off.y) / k];
    // The sizer grows or shrinks first, so the scroll it is set to is not clamped to the old one.
    flushSync(() => (k = Math.min(2, Math.max(0.2, k * by))));
    field.scrollLeft = mx * k + off.x - px;
    field.scrollTop = my * k + off.y - py;
  }
  function down(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function move(e: PointerEvent) {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    const now = { x: e.clientX, y: e.clientY };
    const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      zoom(Math.hypot(now.x - other.x, now.y - other.y) / Math.hypot(was.x - other.x, was.y - other.y), {
        x: (now.x + other.x) / 2,
        y: (now.y + other.y) / 2,
      });
    } else if (e.pointerType !== "touch") {
      // Captured by the field these handlers are on, so the rest of the drag, and its end, still reach them,
      // and the click a drag ends in lands on the field, not on the node under it.
      if (!field.hasPointerCapture(e.pointerId)) {
        if (Math.hypot(now.x - was.x, now.y - was.y) < 4) return;
        field.setPointerCapture(e.pointerId);
      }
      field.scrollLeft -= now.x - was.x;
      field.scrollTop -= now.y - was.y;
    }
    pointers.set(e.pointerId, now);
  }
  function up(e: PointerEvent) {
    pointers.delete(e.pointerId);
  }
  /** Ctrl or Cmd and the wheel zoom, as a trackpad's pinch does; the wheel alone scrolls the field, then the page. */
  function wheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
  }

  const prNumber = (url: string) => url.split("/").pop();

  /** What a screen reader hears for a node: the same rows, in words; each agent's row says its own. */
  function said(n: Placed) {
    return [
      numbered(n.key, n.repo, project.repos),
      n.title ?? "",
      n.stage ?? "Blocker",
      n.pr && `PR ${prNumber(n.pr.url)}${n.pr.draft ? " draft" : ""}`,
      n.line,
      n.needs && "needs you",
    ]
      .filter(Boolean)
      .join(", ");
  }
</script>

<section class="map" aria-label="Map of {project.name}">
  <div
    class="field"
    role="presentation"
    bind:this={field}
    bind:clientWidth={width}
    bind:clientHeight={height}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onwheel={wheel}
  >
    {#if drawn && drawn.nodes.length > 0}
      <!-- As large as the map at its scale, so the field scrolls over all of it and a node scrolls into view. -->
      <div class="sizer" style:width="{drawn.width * k + 2 * off.x}px" style:height="{drawn.height * k + 2 * off.y}px">
        <div class="plane" style:left="{off.x}px" style:top="{off.y}px" style:width="{drawn.width}px" style:height="{drawn.height}px" style:transform="scale({k})">
          <svg class="edges" role="presentation">
            <defs>
              {#each ["blocker", "stack"] as kind (kind)}
                <marker
                  id="arrow-{kind}"
                  class={kind}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="10"
                  markerHeight="10"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M2 1 L9 5 L2 9" />
                </marker>
              {/each}
            </defs>
            {#each drawn.edges as e (`${e.kind} ${e.from} ${e.to}`)}
              <polyline class="edge {e.kind}" points={e.points.map((p) => `${p.x},${p.y}`).join(" ")} marker-end="url(#arrow-{e.kind})" />
            {/each}
          </svg>
          {#each drawn.nodes as n (n.key)}
            {@const repo = repoName(n.repo, project.repos)}
            {@const opened = selection.issue === n.key}
            <div
              class="node-card"
              data-key={n.key}
              class:selected={opened}
              class:faded={n.faded}
              style:left="{n.x}px"
              style:top="{n.y}px"
              style:width="{NODE.width}px"
              style:height="{n.height}px"
              style:--hue={stageHue(n.stage)}
              style:--agent-row="{agentRow}px"
            >
              <!-- The card is its open button, but for its agents' rows, each a button of its own. -->
              <button
                type="button"
                class="open"
                aria-label={said(n)}
                aria-pressed={opened && !selection.agent}
                title={n.title ?? n.key}
                onclick={() => open(n.key)}
                onfocus={() => reveal(n.key)}
              >
                {#if n.title}
                  <span class="title">{n.title}</span>
                {:else}
                  <span class="title unknown">Title not read</span>
                {/if}
                <span class="row">
                  <span class="ref">{number(n.key, n.repo ?? "")}<span class="muted">{[repo, n.kind !== "code" && n.kind].filter(Boolean).map((part) => ` · ${part}`).join("")}</span></span>
                  {#if n.needs}<span class="needs">Needs you</span>{/if}
                </span>
                {#key n.stage}
                  <span class="row stage" class:flash={flashed.has(n.key)}>
                    <span class="word">
                      {#if n.stage}<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><Mark stage={n.stage} /></svg>{/if}
                      <span class:unknown={!n.stage}>{n.stage ?? "Blocker"}</span>
                    </span>
                    {#if n.pr}<span class="muted">PR {prNumber(n.pr.url)}{n.pr.draft ? " draft" : ""}</span>{/if}
                  </span>
                {/key}
                {#if n.line}<span class="detail">{n.line}</span>{/if}
              </button>
              {#each n.agents as a (a.role)}
                <button
                  type="button"
                  class="agent"
                  data-says={SAYS[a.state]}
                  aria-label="{ROLE[a.role]}, {SAYS[a.state].toLowerCase()}"
                  aria-pressed={opened && selection.agent === a.role}
                  onclick={() => open(n.key, a.role)}
                  onfocus={() => reveal(n.key)}
                >
                  <AgentDot state={a.state} />{ROLE[a.role]}
                </button>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {:else if drawn}
      {#if hideMerged && merged > 0}
        <p class="note">Nothing on this map but merged issues.</p>
      {:else}
        <p class="note">Nothing on this map: no open <code>ready-for-agent</code> issue, nothing in flight or merged in the last 7 days.</p>
      {/if}
    {:else if failure}
      <p class="note errata" role="status"><strong>Could not read the map.</strong> {failure}</p>
    {:else}
      <p class="note">Reading the map…</p>
    {/if}
  </div>
  {#if drawn && drawn.nodes.length > 0 && failure}<p class="errata stale" role="status">Showing the last map read. {failure}</p>{/if}
  <!-- The map's tools, in a bar under the field so nothing covers a node: the legend and Hide merged left, the zoom right. -->
  {#if (drawn && drawn.nodes.length > 0) || merged > 0}
    {@const kinds = new Set(drawn?.edges.map((e) => e.kind))}
    <div class="tools">
      {#if kinds.size}
        <p class="legend" aria-label="Edges">
          {#if kinds.has("blocker")}<span><svg width="24" height="8" aria-hidden="true"><line class="edge blocker" x1="0" y1="4" x2="24" y2="4" /></svg>Blocks</span>{/if}
          {#if kinds.has("stack")}<span><svg width="24" height="8" aria-hidden="true"><line class="edge stack" x1="0" y1="4" x2="24" y2="4" /></svg>Stacked on</span>{/if}
        </p>
      {/if}
      {#if merged > 0}
        <Button variant="outline" onclick={toggleMerged}>{hideMerged ? `Show ${merged} merged` : "Hide merged"}</Button>
      {/if}
      {#if drawn && drawn.nodes.length > 0}
        <div class="zoom" role="group" aria-label="Zoom">
          <Button variant="outline" aria-label="Zoom out" onclick={() => zoomStep(1 / 1.25)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7 H11.5" /></svg>
          </Button>
          <span class="readout">{Math.round(k * 100)}%</span>
          <Button variant="outline" aria-label="Zoom in" onclick={() => zoomStep(1.25)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7 H11.5 M7 2.5 V11.5" /></svg>
          </Button>
          <Button variant="outline" onclick={() => fit()}>Fit</Button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .map {
    /* The tools bar's height: 36px controls and 8px above and below them, the hairline over it. */
    --bar: 53px;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  .field {
    position: relative;
    /* What the work area leaves after the tools bar, so the page itself never scrolls past the map. */
    flex: 1 1 0;
    min-height: 0;
    /* Panned by its own scroll, so a node scrolled into view (focus, find, a test's click) is in it; past its ends a scroll goes on to the page. */
    overflow: auto;
    scrollbar-width: thin;
    touch-action: pan-x pan-y;
    cursor: grab;
    user-select: none;
    background: var(--surface);
    background-image: radial-gradient(circle, var(--hairline) 1px, transparent 1px);
    background-size: 24px 24px;
    /* The dot grid moves with the map. */
    background-attachment: local;
    /* Inside the region's frame; rounded at its foot too while no tools bar is under it. */
    border-radius: calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0;
  }
  .field:last-child {
    border-radius: calc(var(--radius) - 1px);
  }
  /* Fitted to the width, 60vh tall, the Repos column below it. */
  @media (width < 720px) {
    .field {
      flex: none;
      height: 60vh;
    }
  }
  .sizer {
    position: relative;
  }
  /* The drawing at full size, scaled from its top left. */
  .plane {
    position: absolute;
    transform-origin: 0 0;
  }
  .edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .note {
    margin: 16px;
    color: var(--ink-muted);
    max-width: 70ch;
  }
  .errata.note {
    color: var(--ink);
  }
  /* Kept on screen with the map it says is stale. */
  .stale {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    min-height: var(--bar);
    box-sizing: border-box;
    padding: 8px;
    border-top: 1px solid var(--hairline);
  }
  .legend {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 0 0 0 4px;
    color: var(--ink-muted);
    font-size: 13px;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .zoom {
    display: flex;
    margin-left: auto;
  }
  .zoom :global(button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    padding: 0 10px;
    border-radius: 0;
  }
  /* Drawn as the Stage marks are: a 1.5px stroke in the button's ink. */
  .zoom svg path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  /* The scale on show, so a shrunk map says so; text between the buttons, not one of them. */
  .readout {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 52px;
    padding: 0 8px;
    border-block: 1px solid var(--rule);
    background: var(--surface);
    color: var(--ink-muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .zoom :global(button:first-child) {
    border-radius: var(--radius-control) 0 0 var(--radius-control);
  }
  .zoom :global(button:last-child) {
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
  }
  .zoom > :global(*) + :global(*) {
    margin-left: -1px;
  }
  .zoom :global(button:focus-visible) {
    position: relative;
  }
  /* On a phone the legend is hidden and the buttons 44px; the bar wraps rather than overflow. */
  @media (width < 720px) {
    .zoom :global(button) {
      min-width: 44px;
    }
    .legend {
      display: none;
    }
  }

  .edge {
    fill: none;
  }
  /* A Blocker: a solid line, the blocked issue at its arrow. */
  .blocker {
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }
  /* Stacked on: a dashed line in the accent, never a heavier Blocker line. */
  .stack {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  marker path {
    fill: none;
    stroke-width: 1.5;
    stroke-dasharray: none;
  }
  marker.blocker path {
    stroke: var(--ink-muted);
  }
  marker.stack path {
    stroke: var(--accent);
  }

  /* The card frames its open button and its agents' rows; the open button's click reaches over all of it but the rows. */
  .node-card {
    display: flex;
    flex-direction: column;
    padding: 0;
    cursor: default;
  }
  .open {
    flex: 1;
    display: grid;
    align-content: start;
    row-gap: 4px;
    min-height: 0;
    padding: 8px 12px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .open::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .open:focus-visible {
    outline: none;
  }
  .node-card:has(.open:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  /* An agent's row: its dot and role; what its state means on hover and focus, as its accessible name says it. */
  .agent {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: var(--agent-row);
    padding: 0 12px;
    border: 0;
    border-top: 1px solid var(--hairline);
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .agent:last-child {
    border-radius: 0 0 calc(var(--radius) - 1px) calc(var(--radius) - 1px);
  }
  .agent:hover {
    background: var(--raised);
  }
  .agent[aria-pressed="true"] {
    background: var(--accent-soft);
    font-weight: 600;
  }
  .agent:focus-visible {
    outline-offset: -2px;
  }
  .agent::after {
    content: attr(data-says);
    position: absolute;
    top: calc(100% + 4px);
    left: 8px;
    z-index: 20;
    padding: 4px 8px;
    background: var(--surface);
    color: var(--ink);
    font-weight: 400;
    white-space: nowrap;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    box-shadow: var(--shadow-pop);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 120ms ease-out, visibility 0s 120ms;
  }
  .agent:hover::after,
  .agent:focus-visible::after {
    opacity: 1;
    visibility: visible;
    transition: opacity 120ms ease-out 300ms, visibility 0s 300ms;
  }
  .agent:focus-visible::after {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .agent::after {
      transition: none !important;
    }
  }

  /* Merged: set back on the page's ground, dashed, its text still full contrast. */
  .node-card.faded {
    background: var(--ground);
    border-style: dashed;
    box-shadow: none;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .unknown,
  .detail {
    color: var(--ink-muted);
    font-weight: 400;
  }
  .stage {
    border-radius: 4px;
  }
  .word {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--hue, var(--ink));
    font-weight: 600;
    white-space: nowrap;
  }
  .word svg {
    flex: none;
  }
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A refetch that changed its Stage: the row flashes once. */
  .flash {
    animation: flash 200ms ease-out;
  }
  @keyframes flash {
    from {
      background: color-mix(in srgb, var(--ink) 14%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flash {
      animation: none;
    }
  }
</style>
