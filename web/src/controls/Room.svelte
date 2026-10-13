<script lang="ts">
  // A Repo's room, or its Project's default, as /api/status shows it, written
  // to config.toml on change (Enter or blur); its own goes back to its
  // Project's or the default. A Repo's counts its Dispatches In flight.
  import From from "./From.svelte";
  import Refused from "./Refused.svelte";
  import type { Sent } from "./send";
  import { type Holder, unset } from "./settings";

  let { holder, live }: { holder: Holder; live?: number } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let room = $derived(holder.settings.room);
  let saving = $state(false);
  let refused = $state<Sent | null>(null);
  let input: HTMLInputElement;

  async function save(body: Record<string, unknown>) {
    saving = true;
    refused = null;
    const sent = await holder.patch(body);
    saving = false;
    if (sent.ok) room = sent.answer.room;
    else refused = sent;
    // A refused value goes back to the room set.
    input.value = String(room.value);
  }
</script>

<section>
  <div class="row">
    <label for="{id}-room">Room</label>
    <From setting={room} {holder} keys={["room"]} name="Room" busy={saving} onundo={() => save(unset(["room"]))} />
    <!-- An empty or partial number is sent as "" and refused: null would remove the room. -->
    <input
      id="{id}-room"
      type="number"
      min="1"
      value={room.value}
      disabled={saving}
      aria-busy={saving}
      aria-describedby={live === undefined ? undefined : `${id}-live`}
      bind:this={input}
      onchange={(e) => save({ room: Number.isNaN(e.currentTarget.valueAsNumber) ? "" : e.currentTarget.valueAsNumber })}
    />
  </div>
  {#if live !== undefined}
    <p id="{id}-live">{live} in flight; each Dispatch holds its room until its PR merges or closes</p>
  {/if}
  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    min-height: 40px;
  }
  label {
    margin-right: auto;
    font-weight: 600;
  }
  input {
    width: 72px;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
  }
  input:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  p {
    color: var(--ink-muted);
  }
</style>
