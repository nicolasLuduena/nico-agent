<script lang="ts">
  // The Repo's room as /api/status shows it, written to config.toml on change
  // (Enter or blur); the Repo's own goes back to its Project's or the default.
  import type { Project, Repo, Status } from "../status";
  import From from "./From.svelte";
  import { inFlight } from "./launch";
  import Refused from "./Refused.svelte";
  import { patch, type Sent } from "./send";
  import { unset } from "./settings";

  let { repo, status, project }: { repo: Repo; status: Status; project: Project | undefined } = $props();

  // The PATCH's answer, until /api/status's next one.
  let room = $derived(repo.room);
  let saving = $state(false);
  let refused = $state<Sent | null>(null);
  let live = $derived(inFlight(repo, status.dispatches));
  let input: HTMLInputElement;

  async function save(body: Record<string, unknown>) {
    saving = true;
    refused = null;
    const sent = await patch(repo.slug, body);
    saving = false;
    if (sent.ok) room = sent.answer.room;
    else refused = sent;
    // A refused value goes back to the room set.
    input.value = String(room.value);
  }
</script>

<section>
  <div class="row">
    <label for="room">Room</label>
    <From setting={room} {project} keys={["room"]} name="Room" busy={saving} onundo={() => save(unset(["room"]))} />
    <!-- An empty or partial number is sent as "" and refused: null would remove the room. -->
    <input
      id="room"
      type="number"
      min="1"
      value={room.value}
      disabled={saving}
      aria-busy={saving}
      aria-describedby="room-live"
      bind:this={input}
      onchange={(e) => save({ room: Number.isNaN(e.currentTarget.valueAsNumber) ? "" : e.currentTarget.valueAsNumber })}
    />
  </div>
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
