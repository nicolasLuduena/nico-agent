<script lang="ts">
  // The Repo's Readiness checks as /api/status shows them: each failing one
  // on the errata rule with its help, the passing ones folded under a count.
  import type { Repo } from "../status";
  import { clock } from "../time";
  import { ticked } from "./Refused.svelte";

  let { repo }: { repo: Repo } = $props();

  const failing = $derived(repo.checks?.results.filter((c) => !c.ok) ?? []);
  const passing = $derived(repo.checks?.results.filter((c) => c.ok) ?? []);
</script>

<section aria-labelledby="readiness-head">
  <h2 class="label" id="readiness-head">Readiness</h2>
  {#if repo.checks}
    {#each failing as check (check.name)}
      <div class="errata">
        <p class="said">{@render ticked(check.said)}</p>
        {#if check.help}<p>{@render ticked(check.help)}</p>{/if}
      </div>
    {/each}
    {#if passing.length > 0}
      <details>
        <summary>{passing.length} of {repo.checks.results.length} pass</summary>
        <ul>
          {#each passing as check (check.name)}
            <li>{check.said}</li>
          {/each}
        </ul>
      </details>
    {/if}
    <p class="muted">Unchanged since {clock(repo.checks.at)}</p>
  {:else}
    <p class="muted">Not checked yet: serve checks it when it starts and on Refresh</p>
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
  }
  .said {
    font-weight: 600;
  }
  summary {
    cursor: pointer;
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
