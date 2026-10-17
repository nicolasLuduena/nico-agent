<script module lang="ts">
  import type { MapData } from "./layout";

  /** The map on show, for the panel to read what a node already knows. */
  export const shown = $state<{ map: MapData | null }>({ map: null });
</script>

<script lang="ts">
  // The Project's map from /api/map/<project>, refetched on every `changed`:
  // dagre lays it out left to right, the field pans and zooms, a node opens its
  // inspector. Each node is a card: its title first, then its number and Repo,
  // then its Stage in words beside its mark, its PR, and its agent's state.
  import { tick, untrack } from "svelte";
  import { watch } from "../live";
  import { still } from "../motion";
  import { selection } from "../selection.svelte";
  import { stageHue } from "../hues";
  import { number, numbered, repoName, type Dispatch, type Project } from "../status";
  import { layout, NODE, withoutMerged, type Placed } from "./layout";
  import Mark from "./Mark.svelte";

  let { project, dispatches }: { project: Project; dispatches: Dispatch[] } = $props();

  const PAD = 16;
  let failure = $state<string | null>(null);
  /** The nodes whose Stage the last refetch changed: their Stage cell flashes once. */
  let flashed = $state(new Set<string>());
  let width = $state(0);
  let height = $state(0);
  let view = $state({ x: PAD, y: PAD, k: 1 });
  /** The Project the view was last fitted to, and the issue it last panned to. */
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
    fitted = null;
    try {
      localStorage.setItem(HIDE_MERGED, hideMerged ? "1" : "0");
    } catch {
      // Kept for this visit only.
    }
  }
  const merged = $derived(shown.map?.nodes.filter((n) => n.stage === "Merged").length ?? 0);

  const drawn = $derived(shown.map && layout(hideMerged ? withoutMerged(shown.map) : shown.map));

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

  /** The scale that fits the map to the field's width, at most full size. */
  const scale = $derived(drawn ? Math.min(1, (width - 2 * PAD) / drawn.width) : 1);
  /** On desktop the field grows to the fitted map's height; on a phone it stays 60vh. */
  const tall = $derived(drawn && width ? `${drawn.height * scale + 2 * PAD}px` : null);

  const home = () => ({ x: PAD, y: PAD, k: scale });

  /** Zoom by `by` about the field's middle: the zoom buttons. */
  function zoomStep(by: number) {
    const rect = field.getBoundingClientRect();
    zoom(by, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  /** Zoomed in past the fit, a finger's every drag pans the map; fitted, a vertical swipe scrolls the page past it. */
  const closer = $derived(view.k > scale);

  $effect(() => {
    if (drawn && width && fitted !== project.name) {
      fitted = project.name;
      untrack(() => (view = home()));
    }
  });

  /** The glide under way; a drag or zoom stops it where it is. */
  let gliding = 0;
  $effect(() => () => cancelAnimationFrame(gliding));

  /** Move the view to `to` over 300ms, easing out, so the map shows where it went; then `done`. */
  function glide(to: typeof view, done?: () => void) {
    cancelAnimationFrame(gliding);
    if (still()) {
      view = to;
      return done?.();
    }
    const from = view;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 300);
      const e = t === 1 ? 1 : 1 - 2 ** (-10 * t);
      view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      if (t < 1) gliding = requestAnimationFrame(step);
      else done?.();
    };
    gliding = requestAnimationFrame(step);
  }

  /** Pan `n` into the middle of the field when any of it is out of view; then `done`. */
  function reveal(n: Placed, done?: () => void) {
    const { x, y, k } = view;
    const [left, top] = [x + n.x * k, y + n.y * k];
    if (left >= 0 && top >= 0 && left + NODE.width * k <= width && top + n.height * k <= height) return done?.();
    glide({ k, x: width / 2 - (n.x + NODE.width / 2) * k, y: height / 2 - (n.y + n.height / 2) * k }, done);
  }

  // An opened node: pan to it, once per opening.
  let field: HTMLElement;
  $effect(() => {
    const key = selection.issue;
    const n = drawn?.nodes.find((n) => n.key === key);
    if (!key) panned = null;
    if (!n || panned === key) return;
    panned = key;
    // Then bring it onto the screen, where the map's glide left it, when the page is scrolled away from it.
    const onScreen = () =>
      field.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
    void tick().then(() => reveal(n, onScreen));
  });

  function open(key: string) {
    selection.issue = key;
  }

  // Drag to pan; pinch, or Ctrl and the wheel, to zoom. A drag only takes the pointer once it
  // has moved, so a tap on a node stays a click.
  const pointers = new Map<number, { x: number; y: number }>();
  function zoom(by: number, at: { x: number; y: number }) {
    const rect = field.getBoundingClientRect();
    const [px, py] = [at.x - rect.left, at.y - rect.top];
    cancelAnimationFrame(gliding);
    const k = Math.min(2, Math.max(0.2, view.k * by));
    view = { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
  }
  function down(e: PointerEvent) {
    cancelAnimationFrame(gliding);
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
    } else {
      // Captured by the plane these handlers are on, so the rest of the drag, and its end, still reach them,
      // and the click a drag ends in lands on the plane, not on the node under it.
      const plane = e.currentTarget as HTMLElement;
      if (!plane.hasPointerCapture(e.pointerId)) {
        if (Math.hypot(now.x - was.x, now.y - was.y) < 4) return;
        plane.setPointerCapture(e.pointerId);
      }
      const dy = closer || e.pointerType !== "touch" ? now.y - was.y : 0;
      view = { ...view, x: view.x + now.x - was.x, y: view.y + dy };
    }
    pointers.set(e.pointerId, now);
  }
  function up(e: PointerEvent) {
    pointers.delete(e.pointerId);
  }
  /** Ctrl or Cmd and the wheel zoom, as a trackpad's pinch does; the wheel alone scrolls the page. */
  function wheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
  }

  const prNumber = (url: string) => url.split("/").pop();

  /** The Harness of the agent at work on `n`: its Reviewer's while that one works alone, else its Implementer's. */
  function harnessAt(n: Placed): string | null {
    const d = dispatches.filter((d) => d.issue === n.key && d.closed_at === null).at(-1);
    const reviewing = n.agent_state?.implementer !== "working" && n.agent_state?.reviewer === "working";
    return (reviewing ? d?.review?.harness : d?.implementer.harness) ?? null;
  }

  /** What its agent is doing, in words: `Asking · claude`, `Working · codex`, `Idle`. */
  function doing(n: Placed) {
    const harness = n.agent && harnessAt(n);
    const word = { asking: "Asking", working: "Working", idle: "Idle" }[n.agent!];
    return harness ? `${word} · ${harness}` : word;
  }

  /** The row under the Stage: its agent's state, then its line. */
  const detail = (n: Placed) => [n.agent && doing(n), n.line].filter(Boolean).join(" · ");

  /** What a screen reader hears for a node: the same rows, in words. */
  function said(n: Placed) {
    const a = n.agent;
    const harness = a && harnessAt(n);
    return [
      numbered(n.key, n.repo, project.repos),
      n.title ?? "",
      n.stage ?? "Blocker",
      a && `agent ${a}${harness ? ` on ${harness}` : ""}`,
      n.pr && `PR ${prNumber(n.pr.url)}${n.pr.draft ? " draft" : ""}`,
      n.line,
      n.needs && "needs you",
    ]
      .filter(Boolean)
      .join(", ");
  }
</script>

<section
  class="field"
  aria-label="Map of {project.name}"
  style:--drawn={tall}
  bind:this={field}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  {#if drawn && drawn.nodes.length > 0}
    {@const kinds = new Set(drawn.edges.map((e) => e.kind))}
    <div
      class="plane"
      role="presentation"
      style:touch-action={closer ? "none" : "pan-y"}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onwheel={wheel}
    >
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
        <g transform="translate({view.x} {view.y}) scale({view.k})">
          {#each drawn.edges as e (`${e.kind} ${e.from} ${e.to}`)}
            <polyline class="edge {e.kind}" points={e.points.map((p) => `${p.x},${p.y}`).join(" ")} marker-end="url(#arrow-{e.kind})" />
          {/each}
        </g>
      </svg>
      <div class="nodes" style:transform="translate({view.x}px, {view.y}px) scale({view.k})">
        {#each drawn.nodes as n (n.key)}
          {@const repo = repoName(n.repo, project.repos)}
          {@const more = detail(n)}
          <button
            type="button"
            class="node"
            data-key={n.key}
            class:selected={selection.issue === n.key}
            class:faded={n.faded}
            class:failed={n.stage === "Failed"}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{NODE.width}px"
            style:height="{n.height}px"
            style:--hue={stageHue(n.stage)}
            aria-label={said(n)}
            aria-pressed={selection.issue === n.key}
            title={n.title ?? n.key}
            onclick={() => open(n.key)}
            onfocus={() => reveal(n)}
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
            {#if more}<span class="detail" class:asking={n.agent === "asking"}>{more}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
    {#if failure}<p class="stale" role="status">Showing the last map read. {failure}</p>{/if}
    <div class="tools">
      {#if kinds.size}
        <p class="legend" aria-label="Edges">
          {#if kinds.has("blocker")}<span><svg width="24" height="8" aria-hidden="true"><line class="edge blocker" x1="0" y1="4" x2="24" y2="4" /></svg>Blocks</span>{/if}
          {#if kinds.has("stack")}<span><svg width="24" height="8" aria-hidden="true"><line class="edge stack" x1="0" y1="4" x2="24" y2="4" /></svg>Stacked on</span>{/if}
        </p>
      {/if}
      <div class="zoom" role="group" aria-label="Zoom">
        <button type="button" class="quiet" aria-label="Zoom out" onclick={() => zoomStep(1 / 1.25)}>−</button>
        <button type="button" class="quiet" aria-label="Zoom in" onclick={() => zoomStep(1.25)}>+</button>
        <button type="button" class="quiet" onclick={() => glide(home())}>Fit</button>
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
  {#if merged > 0}
    <button type="button" class="quiet merged" onclick={toggleMerged}>{hideMerged ? `Show ${merged} merged` : "Hide merged"}</button>
  {/if}
</section>

<style>
  .field {
    position: relative;
    min-height: max(60vh, var(--drawn, 0px));
    height: 100%;
    overflow: clip;
    background: var(--surface);
    background-image: radial-gradient(circle, var(--hairline) 1px, transparent 1px);
    background-size: 24px 24px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  /* Fitted to the width, 60vh tall, the Repos column below it. */
  @media (width < 720px) {
    .field {
      height: 60vh;
      min-height: 0;
    }
  }
  .plane,
  .edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .plane {
    cursor: grab;
    user-select: none;
  }
  .nodes {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
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
    padding: 6px 10px;
    border: 1px solid var(--hairline);
    border-left: 4px solid var(--failed);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .tools {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  .legend {
    display: flex;
    gap: 12px;
    min-height: 36px;
    align-items: center;
    padding: 0 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--surface);
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
  }
  .zoom button {
    min-width: 36px;
    padding: 0 10px;
    border-radius: 0;
  }
  .zoom button:first-child {
    border-radius: var(--radius-control) 0 0 var(--radius-control);
  }
  .zoom button:last-child {
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
  }
  .zoom button + button {
    margin-left: -1px;
  }
  .zoom button:focus-visible {
    position: relative;
  }
  .merged {
    position: absolute;
    left: 8px;
    bottom: 8px;
  }
  /* At the field's top on a phone, clear of the notices across its foot. */
  @media (width < 720px) {
    .tools {
      top: 8px;
      bottom: auto;
    }
    .merged {
      top: 8px;
      bottom: auto;
    }
    .zoom button {
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

  /* A card: its title first, then its number and Repo, then its Stage. */
  .node {
    position: absolute;
    display: grid;
    align-content: start;
    row-gap: 4px;
    padding: 9px 12px;
    text-align: left;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    line-height: 18px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    cursor: pointer;
  }
  .node:hover {
    border-color: var(--rule);
  }
  .node:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  /* Merged: set back on the page's ground, dashed, its text still full contrast. */
  .node.faded {
    background: var(--ground);
    border-style: dashed;
    box-shadow: none;
  }
  /* Failed: the red rule down its left edge, as an errata's. */
  .node.failed {
    border-left: 4px solid var(--failed);
    padding-left: 9px;
  }
  /* The open node: the one selection accent, its frame doubled. */
  .node.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), var(--shadow);
  }
  .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
    line-height: 20px;
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .ref {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted,
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
  .detail.asking {
    color: var(--ink);
    font-weight: 600;
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
