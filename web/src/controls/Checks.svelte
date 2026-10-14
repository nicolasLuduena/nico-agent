<script lang="ts">
  // The Repo's Readiness checks as /api/status shows them, folded under how
  // many pass: each failing one on the errata rule with its help, which opens
  // the section by itself, then the passing ones.
  import type { Repo } from "../status";
  import { clock } from "../time";
  import Fold from "./Fold.svelte";
  import { ticked } from "./Refused.svelte";

  let { repo, panel }: { repo: Repo; panel: string } = $props();

  const failing = $derived(repo.checks?.results.filter((c) => !c.ok) ?? []);
  const passing = $derived(repo.checks?.results.filter((c) => c.ok) ?? []);
  const summary = $derived(repo.checks ? `${passing.length} of ${repo.checks.results.length} pass` : "Not checked yet");
</script>

<Fold {panel} title="Readiness" {summary} alarm={failing.length > 0}>
  {#if repo.checks}
    {#each failing as check (check.name)}
      <div class="errata">
        <p class="said">{@render ticked(check.said)}</p>
        {#if check.help}<p>{@render ticked(check.help)}</p>{/if}
      </div>
    {/each}
    {#if passing.length > 0}
      <ul aria-label="Passing">
        {#each passing as check (check.name)}
          <li>{check.said}</li>
        {/each}
      </ul>
    {/if}
    <p class="muted">Unchanged since {clock(repo.checks.at)}</p>
  {:else}
    <p class="muted">Not checked yet: serve checks it when it starts and on Refresh</p>
  {/if}
</Fold>

<style>
  .said {
    font-weight: 600;
  }
  ul {
    padding-left: 20px;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-muted);
  }
</style>
