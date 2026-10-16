<script lang="ts">
  import { gauge, until } from "./budget";
  import type { RateLimits } from "./status";
  import { clock } from "./time";

  let { limits, pausedUntil }: { limits: RateLimits; pausedUntil: string | null } = $props();

  // "in N min" counts down between refetches.
  let now = $state(new Date());
  $effect(() => {
    const ticking = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(ticking);
  });

  const shown = $derived(gauge(limits, pausedUntil, now));
  const percent = $derived(Math.round(shown.fill * 100));
  const IDENTITIES: Record<string, string> = { gh: "You", ghbot: "Bot" };
  const BUDGETS = [
    ["core", "REST"],
    ["graphql", "GraphQL"],
  ] as const;
  const count = (n: number) => n.toLocaleString("en-GB");

  // Open while hovered with a mouse, or pinned by a click or a tap till clicked again, Escape or a click elsewhere.
  let hovered = $state(false);
  let pinned = $state(false);
  let root: HTMLElement;
  const open = $derived(hovered || pinned);
</script>

<svelte:window
  onkeydown={(e) => e.key === "Escape" && (pinned = hovered = false)}
  onpointerdown={(e) => !root.contains(e.target as Node) && (pinned = false)}
/>

<div
  class="gauge"
  role="group"
  aria-label="GitHub rate limits"
  bind:this={root}
  onpointerenter={(e) => e.pointerType === "mouse" && (hovered = true)}
  onpointerleave={(e) => e.pointerType === "mouse" && (hovered = false)}
>
  <button
    type="button"
    class="tone-{shown.tone}"
    aria-expanded={open}
    aria-controls="rate-limits"
    aria-label={shown.tone === "paused"
      ? `GitHub paused until ${clock(pausedUntil!, now)}`
      : `GitHub rate limits: ${percent}% of the tightest budget used`}
    onclick={() => (pinned = !pinned)}
  >
    <span class="ball" aria-hidden="true"><span class="level" style:height="{percent}%"></span></span>
    {#if shown.tone === "paused"}
      <span class="label">Paused</span>
    {:else}
      <strong>{percent}%</strong>
    {/if}
  </button>

  {#if open}
    <div class="panel" id="rate-limits">
      <h2 class="label">GitHub rate limits</h2>
      {#if pausedUntil}
        <p class="paused"><strong>Paused</strong> <span>until {clock(pausedUntil, now)}</span></p>
      {/if}
      {#each Object.entries(limits) as [identity, limit] (identity)}
        <section>
          <h3>{IDENTITIES[identity] ?? identity} <span>· {identity}</span></h3>
          {#each BUDGETS as [key, name] (key)}
            {@const b = limit[key]}
            <dl>
              <dt>{name}</dt>
              <dd class="used"><strong>{count(b.used)}</strong> / {count(b.limit)}</dd>
              <dd class="left">{count(b.remaining)} left</dd>
              <dd class="reset">resets {clock(b.reset, now)} · {until(b.reset, now)}</dd>
            </dl>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .gauge {
    position: relative;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 8px;
    border: 0;
    border-radius: 2px;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  button:hover {
    background: var(--surface);
  }
  /* The ball: a disc that fills from the bottom as the tightest budget is used. */
  .ball {
    position: relative;
    width: 22px;
    height: 22px;
    border: 2px solid var(--tone);
    border-radius: 50%;
    overflow: hidden;
  }
  .level {
    position: absolute;
    inset: auto 0 0;
    background: var(--tone);
  }
  .tone-calm {
    --tone: var(--ink);
  }
  .tone-near {
    --tone: var(--waiting);
  }
  .tone-full,
  .tone-paused {
    --tone: var(--failed);
  }
  .tone-paused .ball {
    background: var(--tone);
  }
  button strong,
  button .label {
    color: var(--tone);
    font-variant-numeric: tabular-nums;
  }
  .panel {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    width: 320px;
    max-width: calc(100vw - 2 * var(--gutter));
    padding: 16px;
    background: var(--surface);
    color: var(--ink);
    border-top: 1px solid var(--rule);
    box-shadow: 0 0 0 1px var(--hairline);
  }
  h2 {
    font-size: 14px;
  }
  .paused {
    margin-top: 8px;
    color: var(--failed);
  }
  .paused span {
    float: right;
    font-variant-numeric: tabular-nums;
  }
  section {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--hairline);
  }
  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  h3 span {
    color: var(--ink-muted);
    font-weight: 400;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 12px;
    margin: 4px 0 0;
    font-variant-numeric: tabular-nums;
  }
  dt {
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
    text-align: right;
  }
  .left,
  .reset {
    color: var(--ink-muted);
  }
  .left {
    grid-column: 1;
    text-align: left;
  }
  /* On a phone the panel spans the header between its gutters, as the gauge sits too far in to hang it from. */
  @media (width < 720px) {
    button {
      min-height: 44px;
    }
    .gauge {
      position: static;
    }
    .panel {
      left: var(--gutter);
      right: var(--gutter);
      width: auto;
      max-width: none;
    }
  }
</style>
