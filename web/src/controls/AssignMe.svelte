<script lang="ts">
  // "Assign to me": the issue assigned to the user on its Source, which the
  // page shows once it refetches; a refusal inline under it, on the errata
  // rule. What `children` puts there sits left of the button.
  import type { Snippet } from "svelte";
  import { reload } from "../live";
  import { Assigning } from "./assign.svelte";
  import Refused from "./Refused.svelte";

  let { issue, onassigned, children }: { issue: string; onassigned?: () => void; children?: Snippet } = $props();
  const assigning = new Assigning();

  async function assign() {
    if (!(await assigning.run(issue)).ok) return;
    onassigned?.();
    reload();
  }
</script>

<div class="row">
  {@render children?.()}
  <button type="button" class="quiet" disabled={assigning.busy} aria-busy={assigning.busy} onclick={assign}>{assigning.label}</button>
</div>
{#if assigning.refused}
  <Refused error={assigning.refused.error} help={assigning.refused.help} />
{/if}

<style>
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .row + :global(.errata) {
    margin-top: 8px;
  }
</style>
