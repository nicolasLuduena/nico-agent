<script lang="ts">
  // The one way to ask GitHub and Linear again: `refresh`, then the page
  // refetches so the read times beside it move.
  import { reload } from "../live";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let running = $state(false);
  let sent = $state<Sent | null>(null);

  async function refresh() {
    running = true;
    sent = null;
    sent = await send("POST", "/api/refresh");
    running = false;
    reload();
  }
</script>

<button type="button" disabled={running} aria-busy={running} onclick={refresh}>
  {running ? "Refreshing…" : "Refresh"}
</button>
{#if sent && !sent.ok}
  <!-- On a line of its own under the tabs row. -->
  <div class="refused">
    <Refused error={sent.error} help={sent.help} />
  </div>
{/if}

<style>
  button {
    flex: none;
    min-height: 36px;
    padding: 8px 16px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--ground);
  }
  button:disabled {
    color: var(--ink-muted);
    cursor: progress;
  }
  .refused {
    flex: 1 1 100%;
    padding-bottom: 12px;
  }
</style>
