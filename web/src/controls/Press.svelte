<script lang="ts">
  // A button-quiet asking serve one thing of the issue, which the page shows
  // once it refetches; a refusal inline under it, on the errata rule, kept
  // while the button is not `offered`. What `children` puts there sits left of it.
  import { Button } from "$lib/components/ui/button/index.js";
  import type { Snippet } from "svelte";
  import { reload } from "../live";
  import { Pressing, type Action } from "./press.svelte";
  import Refused from "./Refused.svelte";

  let {
    issue,
    action,
    offered = true,
    ondone,
    children,
  }: { issue: string; action: Action; offered?: boolean; ondone?: () => void; children?: Snippet } = $props();
  // An Action is a constant: the one it is first given is the one it presses.
  // svelte-ignore state_referenced_locally
  const pressing = new Pressing(action);

  async function press() {
    if (!(await pressing.run(issue)).ok) return;
    ondone?.();
    reload();
  }
</script>

<div class="row">
  {@render children?.()}
  {#if offered}
    <Button variant="outline" disabled={pressing.busy} aria-busy={pressing.busy} onclick={press}>{pressing.label}</Button>
  {/if}
</div>
{#if pressing.refused}
  <Refused error={pressing.refused.error} help={pressing.refused.help} />
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
