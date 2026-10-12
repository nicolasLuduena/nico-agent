<script module lang="ts">
  import type { MapData } from "./layout";

  /** The map on show, for the panel to read what a node already knows. */
  export const shown = $state<{ map: MapData | null }>({ map: null });
</script>

<script lang="ts">
  // The Repo's map from /api/map/<repo>, refetched on every `changed`: dagre
  // lays it out left to right, the field pans and zooms, a node opens its panel.
  import { tick, untrack } from "svelte";
  import { watch } from "../live";
  import { selection } from "../selection.svelte";
  import { number, type Repo } from "../status";
  import { layout, NODE, withoutMerged, type Placed } from "./layout";
  import Mark from "./Mark.svelte";

  let { repo }: { repo: Repo } = $props();

  const PAD = 16;
  let failure = $state<string | null>(null);
  /** The nodes whose Stage the last refetch changed: their Stage cell flashes once. */
  let flashed = $state(new Set<string>());
  let width = $state(0);
  let height = $state(0);
  let view = $state({ x: PAD, y: PAD, k: 1 });
  /** The Repo the view was last fitted to, and the issue it last panned to. */
  let fitted: string | null = null;
  let panned: string | null = null;

  // "Hide merged", remembered in this browser for every Repo's map.
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

  $effect(() => {
    const slug = repo.slug;
    shown.map = null;
    failure = null;
    return watch<MapData>(
      `/api/map/${slug}`,
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

  function fit() {
    view = { x: PAD, y: PAD, k: scale };
  }

  /** Zoomed in past the fit, a finger's every drag pans the map; fitted, a vertical swipe scrolls the page past it. */
  const closer = $derived(view.k > scale);

  $effect(() => {
    if (drawn && width && fitted !== repo.slug) {
      fitted = repo.slug;
      untrack(fit);
    }
  });

  /** Pan `n` into the middle of the field when any of it is out of view. */
  function reveal(n: Placed) {
    const { x, y, k } = view;
    const [left, top] = [x + n.x * k, y + n.y * k];
    if (left >= 0 && top >= 0 && left + NODE.width * k <= width && top + n.height * k <= height) return;
    view = { k, x: width / 2 - (n.x + NODE.width / 2) * k, y: height / 2 - (n.y + n.height / 2) * k };
  }

  // A strip item opens its node: pan to it, once per opening.
  let field: HTMLElement;
  $effect(() => {
    const key = selection.issue;
    const n = drawn?.nodes.find((n) => n.key === key);
    if (!key) panned = null;
    if (!n || panned === key) return;
    panned = key;
    untrack(() => reveal(n));
    // And bring it onto the screen, when the page is scrolled away from it.
    void tick().then(() => field.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: "nearest" }));
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
    const k = Math.min(2, Math.max(0.2, view.k * by));
    view = { k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k };
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
    } else {
      // Captured by the svg these handlers are on, so the rest of the drag, and its end, still reach them.
      const svg = e.currentTarget as SVGSVGElement;
      if (!svg.hasPointerCapture(e.pointerId)) {
        if (Math.hypot(now.x - was.x, now.y - was.y) < 4) return;
        svg.setPointerCapture(e.pointerId);
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

  /** Fit `text` into `room` px, ellipsized, once the font is in. */
  function fit_text(el: SVGTextElement, [text, room]: [string, number]) {
    const set = () => {
      el.textContent = text;
      if (el.getComputedTextLength() <= room) return;
      let n = text.length;
      try {
        while (n > 0 && el.getSubStringLength(0, n) > room - 12) n--;
      } catch {
        // shortcut: a title with astral characters may miscount; it is cut short, not wrong.
      }
      el.textContent = `${text.slice(0, n).trimEnd()}…`;
    };
    set();
    void document.fonts.ready.then(set);
    return {
      update(next: [string, number]) {
        [text, room] = next;
        set();
      },
    };
  }

  const prNumber = (url: string) => url.split("/").pop();

  /** The Agent state mark: Asking, working, idle, or no agent. */
  function agent(n: Placed): "asking" | "working" | "idle" | null {
    const a = n.agent_state;
    if (!a) return null;
    if (a.implementer === "blocked") return "asking";
    if (a.implementer === "working" || a.reviewer === "working") return "working";
    if (["idle", "done"].includes(a.implementer) || ["idle", "done"].includes(a.reviewer ?? "")) return "idle";
    return null;
  }

  /** What a screen reader hears for a node: the same rows, in words. */
  function said(n: Placed) {
    const a = agent(n);
    return [
      number(n.key, repo.slug),
      n.title ?? "",
      n.stage ?? "Blocker",
      a && `agent ${a}`,
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
  aria-label="Map of {repo.slug}"
  style:--drawn={tall}
  bind:this={field}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  {#if drawn && drawn.nodes.length > 0}
    <svg
      role="presentation"
      style:touch-action={closer ? "none" : "pan-y"}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onwheel={wheel}
    >
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
          {@const points = e.points.map((p) => `${p.x},${p.y}`).join(" ")}
          <polyline class="edge {e.kind}" {points} marker-end="url(#arrow-{e.kind})" />
          {#if e.kind === "stack"}<polyline class="edge rail" {points} />{/if}
        {/each}
        {#each drawn.nodes as n (n.key)}
          {@const a = agent(n)}
          <g
            class="node"
            data-key={n.key}
            class:selected={selection.issue === n.key}
            class:faded={n.faded}
            transform="translate({n.x} {n.y})"
            role="button"
            tabindex="0"
            aria-label={said(n)}
            aria-pressed={selection.issue === n.key}
            onclick={() => open(n.key)}
            onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(n.key))}
            onfocus={() => reveal(n)}
          >
            <rect class="ring" x="-3.5" y="-3.5" width={NODE.width + 7} height={n.height + 7} />
            <rect class="frame" x="0.5" y="0.5" width={NODE.width - 1} height={n.height - 1} />
            {#if n.needs}<rect class="flag" width={NODE.width} height="4" />{/if}
            {#if n.stage === "Failed"}<rect class="failed" width="4" height={n.height} />{/if}
            <text class="number" x="12" y="30" use:fit_text={[number(n.key, repo.slug), 140]}></text>
            <text class="kind" x="236" y="27">{n.kind.toUpperCase()}</text>
            {#if n.title}
              <text class="title" x="12" y="53" use:fit_text={[n.title, 224]}></text>
            {:else}
              <text class="title unknown" x="12" y="53">Title not read</text>
            {/if}
            {#key n.stage}
              <rect class="flash" class:on={flashed.has(n.key)} x="4" y="60" width={NODE.width - 8} height="22" />
            {/key}
            <g transform="translate(12 64)"><Mark stage={n.stage} /></g>
            <text class="stage" class:unknown={!n.stage} x="32" y="76">{n.stage ?? "Blocker"}</text>
            {#if n.pr}
              <text class="pr" x="218" y="76"
                >PR {prNumber(n.pr.url)}{#if n.pr.draft}<tspan class="draft" dx="4">draft</tspan>{/if}</text
              >
            {/if}
            {#if a}<circle class="agent {a}" cx="231" cy="71" r="4" />{/if}
            {#if n.line}<text class="review" x="32" y="98">{n.line}</text>{/if}
          </g>
        {/each}
      </g>
    </svg>
    <button type="button" class="fit" onclick={fit}>Fit</button>
  {:else if drawn}
    {#if hideMerged && merged > 0}
      <p class="note">Nothing on this map but merged issues.</p>
    {:else}
      <p class="note">Nothing on this map: no open <code>ready-for-agent</code> issue, nothing in flight or merged in the last 7 days.</p>
    {/if}
  {:else}
    <p class="note">{failure ?? "Reading the map…"}</p>
  {/if}
  {#if merged > 0}
    <button type="button" class="fit merged" onclick={toggleMerged}>{hideMerged ? `Show ${merged} merged` : "Hide merged"}</button>
  {/if}
</section>

<style>
  .field {
    position: relative;
    min-height: max(60vh, var(--drawn, 0px));
    height: 100%;
    overflow: clip;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  /* Fitted to the width, 60vh tall, the switches and form below it. */
  @media (width < 720px) {
    .field {
      height: 60vh;
      min-height: 0;
    }
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: grab;
    user-select: none;
  }
  .note {
    padding: 16px;
    color: var(--ink-muted);
    max-width: 70ch;
  }
  .fit {
    position: absolute;
    right: 8px;
    bottom: 8px;
    min-height: 36px;
    padding: 0 16px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  .fit:hover {
    background: var(--ground);
  }
  .merged {
    right: auto;
    left: 8px;
  }

  .edge {
    fill: none;
  }
  .blocker {
    stroke: var(--ink-muted);
    stroke-width: 1.5;
  }
  /* Double rails: a through-coach connection, never a heavier Blocker line. */
  .stack {
    stroke: var(--live);
    stroke-width: 5;
  }
  .rail {
    stroke: var(--surface);
    stroke-width: 2;
  }
  marker path {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: miter;
  }

  .node {
    cursor: pointer;
    outline: none;
  }
  .node.faded {
    opacity: 0.45;
  }
  .frame {
    fill: var(--surface);
    stroke: var(--hairline);
  }
  .node:hover .frame {
    stroke: var(--rule);
  }
  .ring {
    fill: none;
    stroke: none;
    stroke-width: 2;
  }
  .node:focus-visible .ring {
    stroke: var(--focus);
  }
  .flag {
    fill: var(--signal);
  }
  .failed {
    fill: var(--failed);
  }
  text {
    fill: var(--ink);
    font-size: 14px;
  }
  .number {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .kind {
    fill: var(--ink-muted);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-anchor: end;
  }
  .stage {
    font-weight: 600;
  }
  .unknown,
  .draft,
  .review {
    fill: var(--ink-muted);
  }
  .pr {
    text-anchor: end;
  }
  .agent {
    stroke-width: 1.5;
  }
  .agent.working {
    fill: var(--live);
    stroke: var(--live);
  }
  .agent.idle {
    fill: none;
    stroke: var(--live);
  }
  .agent.asking {
    fill: var(--signal);
    stroke: var(--signal-ink);
    stroke-width: 1;
  }
  .flash {
    fill: none;
  }
  /* Like a board updating a single line. */
  .flash.on {
    animation: flash 200ms ease-out;
  }
  @keyframes flash {
    from {
      fill: color-mix(in srgb, var(--ink) 18%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flash.on {
      animation: none;
    }
  }

  /* The selected node: the page's one reversed element. */
  .selected .frame {
    fill: var(--reversed);
    stroke: var(--reversed);
  }
  .selected text,
  .selected .unknown,
  .selected .draft,
  .selected .review {
    fill: var(--reversed-ink);
  }
  .selected .agent.working,
  .selected .agent.idle {
    stroke: var(--reversed-ink);
  }
  .selected .agent.working {
    fill: var(--reversed-ink);
  }
</style>
