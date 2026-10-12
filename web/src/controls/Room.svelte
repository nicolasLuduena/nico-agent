<script lang="ts">
  // The Repo's room as /api/status shows it, written to config.toml on change (Enter or blur).
  import type { Repo, Status } from "../status";
  import { inFlight } from "./launch";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { repo, status }: { repo: Repo; status: Status } = $props();

  // The PATCH's answer, until /api/status's next one.
  let room = $derived(repo.room);
  let saving = $state(false);
  let refused = $state<Sent | null>(null);
  let live = $derived(inFlight(repo, status.dispatches));

  async function save(input: HTMLInputElement) {
    saving = true;
    refused = null;
    // An empty or partial number is NaN, sent as null and refused.
    const sent = await send("PATCH", `/api/repo/${repo.slug}`, { room: input.valueAsNumber });
    saving = false;
    if (sent.ok) room = sent.answer.room;
    else {
      refused = sent;
      input.value = String(room);
    }
  }
</script>

<section>
  <label>
    <span>Room</span>
    <input
      type="number"
      min="1"
      value={room}
      disabled={saving}
      aria-busy={saving}
      aria-describedby="room-live"
      onchange={(e) => save(e.currentTarget)}
    />
  </label>
  <p id="room-live">{live} in flight; each Dispatch holds its room until its PR merges or closes</p>
  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
  }
  label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    font-weight: 600;
  }
  input {
    width: 72px;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
    font-variant-numeric: tabular-nums;
  }
  input:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  p {
    color: var(--ink-muted);
  }
</style>
