<script lang="ts">
  // Take the Repo out of config.toml, as `repo rm` does, once asked twice; its
  // clone stays. serve refuses while it has a Dispatch In flight.
  import { reload } from "../live";
  import type { Repo } from "../status";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { repo }: { repo: Repo } = $props();

  let asking = $state(false);
  let running = $state(false);
  let refused = $state<Sent | null>(null);

  async function remove() {
    running = true;
    refused = null;
    const sent = await send("DELETE", `/api/repo/${repo.slug}`);
    running = false;
    asking = false;
    if (sent.ok) reload();
    else refused = sent;
  }
</script>

<section>
  {#if asking}
    <p role="status">Remove {repo.slug} from nico-agent? Its clone stays.</p>
    <div class="buttons">
      <button type="button" class="quiet" disabled={running} aria-busy={running} onclick={remove}>
        {running ? "Removing…" : `Remove ${repo.slug}`}
      </button>
      <button type="button" class="quiet" disabled={running} onclick={() => (asking = false)}>Keep it</button>
    </div>
  {:else}
    <button type="button" class="quiet" onclick={() => ((asking = true), (refused = null))}>Remove {repo.slug}…</button>
  {/if}
  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
    justify-items: start;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
</style>
