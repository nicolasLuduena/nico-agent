<script lang="ts">
  // #253 owns this file: the open node's panel (desktop) or sheet (phone),
  // from /api/node/<issue>. It takes the 400px column in place of the
  // switches and form while `selection.issue` is set; closing clears it.
  import { selection } from "../selection.svelte";

  let { issue }: { issue: string } = $props();
</script>

<section class="panel" aria-label={issue}>
  <h2>{issue}</h2>
  <button type="button" onclick={() => (selection.issue = null)}>Close</button>
</section>

<style>
  .panel {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 24px;
    background: var(--surface);
    border-left: 1px solid var(--rule);
    box-shadow: 0 0 0 1px var(--hairline);
  }
  h2 {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  button {
    min-height: 36px;
    padding: 0 16px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
</style>
