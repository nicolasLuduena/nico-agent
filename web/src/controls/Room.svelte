<script lang="ts">
  // A Repo's room, or its Project's default, as /api/status shows it, folded
  // under its value; written to config.toml as it is entered (Enter or
  // leaving it); its own goes back to its Project's or the default. A Repo's
  // counts its Dispatches In flight.
  import { Input } from "$lib/components/ui/input/index.js";
  import { fromAction } from "svelte/attachments";
  import { entered, whole } from "./field";
  import Fold from "./Fold.svelte";
  import From from "./From.svelte";
  import Refused from "./Refused.svelte";
  import Save from "./Save.svelte";
  import { Saves } from "./saves.svelte";
  import { type Holder, unset } from "./settings";

  let { holder, live }: { holder: Holder; live?: number } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let room = $derived(holder.settings.room);
  const saves = new Saves();
  let input = $state<HTMLInputElement | null>(null);

  async function save(body: Record<string, unknown>) {
    const sent = await saves.run("room", () => holder.patch(body));
    if (sent.ok) room = sent.answer.room;
    // A refused value goes back to the room set.
    if (input) input.value = String(room.value);
  }
</script>

<Fold panel={holder.panel} title="Room" summary={live === undefined ? `${room.value}` : `${room.value} · ${live} in flight`} alarm={saves.refused !== null}>
  <div class="setting">
    <span>
      <label class="field-name" for="{id}-room">Room</label>
      <Save state={saves.of("room")}>
        <From setting={room} {holder} keys={["room"]} name="Room" onundo={() => save(unset(["room"]))} />
      </Save>
    </span>
    <Input
      class="w-20 flex-none"
      id="{id}-room"
      type="number"
      min="1"
      value={room.value}
      aria-invalid={saves.invalid("room")}
      aria-busy={saves.busy("room")}
      aria-describedby={live === undefined ? undefined : `${id}-live`}
      bind:ref={input}
      {@attach fromAction(entered, () => ({ set: String(room.value), save: (value: string) => save({ room: whole(value) }) }))}
    />
  </div>
  {#if live !== undefined}
    <p id="{id}-live">{live} in flight; each Dispatch holds its room until its PR merges or closes</p>
  {/if}
  {#if saves.refused}
    <Refused error={saves.refused.error} help={saves.refused.help} />
  {/if}
</Fold>

<style>
  p {
    color: var(--ink-muted);
  }
</style>
