<script lang="ts">
  import { ticked } from "./controls/Refused.svelte";
  import { flash } from "./motion";
  import type { Need } from "./toasts";
  import { clock } from "./time";

  let { needs }: { needs: Need[] } = $props();

  // Each dismissed for this page load only; a Check's comes back when another of its checks fails.
  const key = (need: Need) => `${need.kind} ${need.repo} ${need.kind === "Check" ? need.checks.join("\n") : need.text}`;
  let dismissed = $state(new Set<string>());
  const notices = $derived(needs.filter((n) => !dismissed.has(key(n))));
  /** The band folded to its head, for this page load: the work under it moves up again. */
  let folded = $state(false);
  /** The Check notices showing their checks, for this page load: each opens on its own, folded to its count by default. */
  let shown = $state(new Set<string>());
  function toggle(need: Need) {
    const next = new Set(shown);
    if (!next.delete(key(need))) next.add(key(need));
    shown = next;
  }

  /** A notice the page did not have: it flashes once as it arrives, not on the first read. */
  function arrive(row: Element) {
    flash(row);
    return {};
  }

</script>

{#if notices.length}
  <div class="band">
    <!-- The amber is the badge's alone, as on a node. -->
    <span class="needs">Needs you</span>
    <ul class="notices" aria-label="Needs you" hidden={folded}>
      {#each notices as need (key(need))}
        <!-- One row each: its kind, its name, a muted word, its buttons at the end; what opens or helps drops under it. -->
        <li class="notice" role="status" in:arrive>
          <span class="label">{need.kind}</span>
          <span class="ref">{need.kind === "Check" || need.kind === "Install" ? need.repo : need.text}</span>
          {#if need.kind === "Check"}
            <span class="muted">{need.checks.length} check{need.checks.length === 1 ? " fails" : "s fail"} · {need.help}</span>
          {:else if need.kind !== "Install" && need.at}
            <!-- `Paused GitHub until HH:MM`; `Blocked <agent> HH:MM` for an agent of the loop's own with no node. -->
            <span class="muted">{need.kind === "Paused" ? "until " : ""}{clock(need.at)}</span>
          {/if}
          <span class="end">
            {#if need.kind === "Check"}
              <button type="button" class="quiet more" aria-expanded={shown.has(key(need))} aria-controls="checks-{need.repo}" onclick={() => toggle(need)}>
                {shown.has(key(need)) ? "Hide the checks" : "Show the checks"}
              </button>
            {/if}
            <button
              type="button"
              class="close"
              aria-label="Dismiss {need.kind} {need.kind === 'Check' ? need.repo : (need.repo ?? need.text)}"
              onclick={() => (dismissed = new Set(dismissed).add(key(need)))}
            >
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M3 3 L11 11 M11 3 L3 11" /></svg>
            </button>
          </span>
          {#if need.kind === "Check"}
            <!-- What each says, whole; their fixes are in the Repo's Readiness. -->
            <ul class="under checks" id="checks-{need.repo}" hidden={!shown.has(key(need))}>
              {#each need.checks as said, i (i)}<li>{@render ticked(said)}</li>{/each}
            </ul>
          {:else if need.kind === "Install"}
            <!-- Its output's last line, and the command that runs it again: the fix, both read whole. -->
            <span class="under muted">{@render ticked(need.text)}{#if need.help}<span class="help">{@render ticked(need.help)}</span>{/if}</span>
          {/if}
        </li>
      {/each}
    </ul>
    <button type="button" class="quiet fold" aria-expanded={!folded} onclick={() => (folded = !folded)}>
      {folded ? `Show ${notices.length} notice${notices.length === 1 ? "" : "s"}` : "Hide notices"}
    </button>
  </div>
{/if}

<style>
  /* In the page's flow under the view tabs, so it never covers the work: the badge, the notices and Hide notices on one row. */
  .band {
    --row: 42px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
    padding-bottom: 12px;
  }
  /* Centred on the first row of notices. */
  .needs {
    margin-top: calc((var(--row) - 20px) / 2);
  }
  .fold {
    min-height: 32px;
    margin: calc((var(--row) - 32px) / 2) 0 0 auto;
  }
  /* At most a third of the window: past that the notices scroll inside, the map still on the first screen. */
  .notices {
    display: flex;
    flex: 1 1 0;
    flex-wrap: wrap;
    gap: 8px;
    min-width: min(320px, 100%);
    max-height: 33vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }
  .notices[hidden] {
    display: none;
  }
  .notice {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 8px;
    min-width: 0;
    max-width: 100%;
    min-height: var(--row);
    padding: 4px 4px 4px 12px;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .ref {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    min-width: 0;
    color: var(--ink-muted);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .end {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .under {
    flex-basis: 100%;
    padding: 0 8px 6px 0;
  }
  .help {
    display: block;
  }
  .checks {
    display: grid;
    gap: 2px;
    margin: 0;
    padding-left: 16px;
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .checks[hidden] {
    display: none;
  }
  .checks li::marker {
    color: var(--ink-muted);
  }
  /* Smaller than a form's quiet button, so a notice stays one row. */
  .more {
    min-height: 28px;
    padding: 0 10px;
    font-size: 13px;
  }
  .close {
    display: grid;
    place-items: center;
    min-width: 32px;
    min-height: 32px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .close:hover {
    background: var(--raised);
    color: var(--ink);
  }
  /* The Stage icons' stroke (map/Mark.svelte). */
  .close path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  /* The badge and Hide notices on their own line, the notices under them full width. */
  @media (width < 720px) {
    .band {
      --row: 54px;
      align-items: center;
    }
    .needs,
    .fold {
      margin-top: 0;
    }
    .fold,
    .more,
    .close {
      min-width: 44px;
      min-height: 44px;
    }
    .notices {
      order: 1;
      flex-basis: 100%;
    }
    .notice {
      flex-basis: 100%;
    }
  }
</style>
