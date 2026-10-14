<script lang="ts">
  // What every Wiki is built on, `[wiki]` in config.toml, each setting
  // written as it changes through PATCH /api/wiki/settings, a text or number
  // field on Enter or on leaving it. The model and the Effort are picked from
  // the Harness's own where it lists them, and typed where it takes any.
  import { entered } from "../controls/field";
  import Launch from "../controls/Launch.svelte";
  import Refused from "../controls/Refused.svelte";
  import Save from "../controls/Save.svelte";
  import { Saves } from "../controls/save.svelte";
  import { send } from "../controls/send";
  import { picked } from "../controls/settings";
  import type { WikiSettings } from "../status";

  let { settings }: { settings: WikiSettings } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let shown = $derived(settings);
  const saves = new Saves();

  /** PATCH `body` as the setting `key`; `back` puts a refused field back to what is set. */
  async function save(key: string, body: Record<string, unknown>, back: () => void) {
    const sent = await saves.run(key, () => send("PATCH", "/api/wiki/settings", body));
    if (sent.ok) shown = sent.answer;
    else back();
  }

  /** The budget's fields, each a whole number. */
  const BUDGET = [
    ["hour", "Hour"],
    ["calls", "Calls"],
    ["depth", "Depth"],
    ["concurrency", "Calls at once"],
  ] as const;
  /** An empty or partial number is sent as "" and refused: null would take the default. */
  const whole = (value: string) => (value.trim() === "" || Number.isNaN(Number(value)) ? "" : Number(value));
  const invalid = (key: string) => saves.refused?.key === key || undefined;
</script>

<section class="settings" aria-label="Settings for every Wiki">
  <p>These apply to every Wiki, of every Repo.</p>

  <div class="part" role="group" aria-labelledby="{id}-launch">
    <div class="field-head">
      <strong id="{id}-launch">Launch</strong>
      <Save state={saves.of("launch")} />
    </div>
    <Launch
      harnesses={shown.harnesses}
      launch={shown.launch}
      invalid={saves.refused?.key === "launch"}
      busy={saves.of("launch") === "saving"}
      pick={(field, value, back) => save("launch", { launch: picked(shown.launch, field, value) }, back)}
    />
  </div>

  <div class="part" role="group" aria-labelledby="{id}-budget">
    <strong id="{id}-budget">Budget</strong>
    <div class="budget">
      {#each BUDGET as [key, title] (key)}
        <div class="field">
          <div class="field-head">
            <label class="field-name" for="{id}-{key}">{title}</label>
            <Save state={saves.of(key)} />
          </div>
          <input
            id="{id}-{key}"
            type="number"
            min={key === "hour" ? 0 : 1}
            max={key === "hour" ? 23 : undefined}
            value={shown[key]}
            aria-invalid={invalid(key)}
            aria-busy={saves.of(key) === "saving"}
            use:entered={{
              set: String(shown[key]),
              save: (value, input) => save(key, { [key]: whole(value) }, () => (input.value = String(shown[key]))),
            }}
          />
        </div>
      {/each}
    </div>
    <p>The loop checks each Repo's Wiki daily from Hour, local time. A build makes at most Calls model calls, Calls at once at a time, dividing the code at most Depth deep.</p>
  </div>

  <div class="part field">
    <div class="field-head">
      <label class="field-name" for="{id}-embed">Embedding model</label>
      <Save state={saves.of("embed_model")} />
    </div>
    <input
      id="{id}-embed"
      value={shown.embed_model}
      autocomplete="off"
      aria-invalid={invalid("embed_model")}
      aria-busy={saves.of("embed_model") === "saving"}
      use:entered={{
        set: shown.embed_model,
        save: (value, input) => save("embed_model", { embed_model: value.trim() }, () => (input.value = shown.embed_model)),
      }}
    />
    <p>The Ollama model that embeds each Wiki, for agents' questions through <code>ask</code>.</p>
  </div>

  {#if saves.refused}
    <Refused error={saves.refused.error} help={saves.refused.help} />
  {/if}
</section>

<style>
  .settings {
    display: grid;
    gap: 16px;
    max-width: 720px;
  }
  .part {
    display: grid;
    gap: 8px;
  }
  p {
    color: var(--ink-muted);
  }
  .budget {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px 12px;
  }

  /* Two by two on a phone. */
  @media (width < 720px) {
    .budget {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
