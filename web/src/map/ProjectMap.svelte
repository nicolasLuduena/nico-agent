<script module lang="ts">
  import type { MapData } from "./layout";

  /** The map on show, for the panel to read what a node already knows. */
  export const shown = $state<{ map: MapData | null }>({ map: null });
</script>

<script lang="ts">
  // The Project's map from /api/map/<project>, refetched on every `changed`:
  // dagre lays it out left to right, the field pans and zooms, a node opens its
  // panel. Each node is tinted with its Stage's hue; with more than one Repo,
  // it names its Repo after its number, on that Repo's line colour; an agent
  // at work is a diamond in its Harness's hue.
  import { tick, untrack } from "svelte";
  import { watch } from "../live";
  import { still } from "../motion";
  import { selection } from "../selection.svelte";
  import { harnessHue, repoLine, stageHue } from "../hues";
  import { number, repoName, type Dispatch, type Project } from "../status";
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

  $effect(() => {
    const name = project.name;
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

  // A strip item opens its node: pan to it, once per opening.
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

  /** Fit `text`, ellipsized, to end by the node's `end` px, once the font is in; a tspan starts after what comes before it. */
  function fit_text(el: SVGTextContentElement, [text, end]: [string, number]) {
    const set = () => {
      el.textContent = text;
      const room = end - el.getStartPositionOfChar(0).x;
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
        [text, end] = next;
        set();
      },
    };
  }

  /** The room a Repo's 10px square takes before its name: its own width and 4px to the name. */
  const SQUARE = 14;

  /**
   * Set the Repo's square, drawn right after the first row's text, just before
   * the Repo's name in it, once the name is laid out; again as `_node` changes.
   */
  function beforeRepoName(square: SVGRectElement, _node: string) {
    const place = () => {
      const name = square.previousElementSibling?.querySelector<SVGTextContentElement>(".repo");
      if (name?.getNumberOfChars()) square.setAttribute("x", String(name.getStartPositionOfChar(0).x - SQUARE));
    };
    place();
    void document.fonts.ready.then(place);
    return { update: place };
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

  /** The Harness of the agent at work on `n`: its Reviewer's while that one works alone, else its Implementer's. */
  function harnessAt(n: Placed): string | null {
    const d = dispatches.filter((d) => d.issue === n.key && d.closed_at === null).at(-1);
    const reviewing = n.agent_state?.implementer !== "working" && n.agent_state?.reviewer === "working";
    return (reviewing ? d?.review?.harness : d?.implementer.harness) ?? null;
  }

  /** What a screen reader hears for a node: the same rows, in words. */
  function said(n: Placed) {
    const a = agent(n);
    const harness = a && harnessAt(n);
    return [
      [number(n.key, n.repo ?? ""), repoName(n.repo, project.repos)].filter(Boolean).join(" "),
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
          {@const repo = repoName(n.repo, project.repos)}
          {@const line = repoLine(n.repo, project)}
          <g
            class="node"
            data-key={n.key}
            class:selected={selection.issue === n.key}
            class:faded={n.faded}
            transform="translate({n.x} {n.y})"
            style:--hue={stageHue(n.stage)}
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
            {#if repo}
              <text x="12" y="30"
                ><tspan class="number">{number(n.key, n.repo ?? "")}</tspan><tspan class="repo" dx={line ? 8 + SQUARE : 8} use:fit_text={[repo, 152]}
                ></tspan></text
              >
              {#if line}<rect class="swatch" y="20" width="10" height="10" style:--line={line} use:beforeRepoName={`${n.key} ${repo}`} />{/if}
            {:else}
              <text class="number" x="12" y="30" use:fit_text={[number(n.key, n.repo ?? ""), 152]}></text>
            {/if}
            <!-- Nearly every node is code: only the exception is labelled. -->
            {#if n.kind !== "code"}<text class="kind" x="236" y="27">{n.kind.toUpperCase()}</text>{/if}
            {#if n.title}
              <text class="title" x="12" y="53" use:fit_text={[n.title, 236]}></text>
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
            {#if a}<rect
                class="agent {a}"
                x="-4"
                y="-4"
                width="8"
                height="8"
                transform="translate(231 71) rotate(45)"
                style:--harness={harnessHue(harnessAt(n))}
              />{/if}
            {#if n.line}<text class="line" x="32" y="98" use:fit_text={[n.line, 236]}></text>{/if}
          </g>
        {/each}
      </g>
    </svg>
    <button type="button" class="quiet fit" onclick={() => glide(home())}>Fit</button>
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
    <button type="button" class="quiet fit merged" onclick={toggleMerged}>{hideMerged ? `Show ${merged} merged` : "Hide merged"}</button>
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
  }
  .merged {
    right: auto;
    left: 8px;
  }

  .edge {
    fill: none;
  }
  /* A chain's line in full ink, so it reads as a route between its stops. */
  .blocker {
    stroke: var(--ink);
    stroke-width: 2;
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
  /* A light tint of its Stage's hue; a Blocker with none stays the sheet's white. */
  .frame {
    fill: color-mix(in srgb, var(--hue, var(--surface)) var(--tint), var(--surface));
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
  .repo {
    fill: var(--ink-muted);
    font-weight: 600;
  }
  .kind {
    fill: var(--ink-muted);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-anchor: end;
  }
  /* The Stage word in its mark's hue, like a departures board's status column. */
  .stage {
    fill: var(--hue, var(--ink));
    font-weight: 600;
  }
  .swatch {
    fill: var(--line);
  }
  .unknown,
  .draft,
  .line {
    fill: var(--ink-muted);
  }
  .pr {
    text-anchor: end;
  }
  .agent {
    stroke-width: 1.5;
  }
  .agent.working {
    fill: var(--harness);
    stroke: var(--harness);
  }
  .agent.idle {
    fill: none;
    stroke: var(--harness);
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
  .selected .stage,
  .selected .repo,
  .selected .unknown,
  .selected .draft,
  .selected .line {
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
