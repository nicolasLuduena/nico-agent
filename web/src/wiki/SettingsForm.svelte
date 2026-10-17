<script lang="ts">
  // What every Wiki is built on, `[wiki]` in config.toml, each setting
  // written as it changes through PATCH /api/wiki/settings, a text or number
  // field on Enter or on leaving it. The model and the Effort are picked from
  // the Harness's own where it lists them, and typed where it takes any.
  import { entered, whole } from "../controls/field";
  import LaunchPicker from "../controls/LaunchPicker.svelte";
  import Refused from "../controls/Refused.svelte";
  import Save from "../controls/Save.svelte";
  import { Saves } from "../controls/saves.svelte";
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

  /** The budget's fields, each a whole number, and what it does, shown on hovering its name. */
  const BUDGET = [
    ["hour", "Hour", "Each day from this hour, local time, the loop updates every Repo's Wiki."],
    ["calls", "Calls", "The most model calls one build makes; what they don't reach is left as Gaps, for Continue."],
    ["depth", "Depth", "How many levels deep a build divides the code into Components; anything deeper is left as Gaps."],
    ["concurrency", "Calls at once", "How many of a build's model calls run together."],
  ] as const;
</script>

<section class="settings" aria-label="Settings for every Wiki">
  <p>These apply to every Wiki, of every Repo.</p>

  <div class="part" role="group" aria-labelledby="{id}-launch">
    <div class="field-head">
      <strong id="{id}-launch">Launch</strong>
      <Save state={saves.of("launch")} />
    </div>
    <LaunchPicker
      harnesses={shown.harnesses}
      launch={shown.launch}
      invalid={!!saves.invalid("launch")}
      busy={saves.busy("launch")}
      pick={(field, value, back) => save("launch", { launch: picked(shown.launch, field, value) }, back)}
    />
  </div>

  <div class="part" role="group" aria-labelledby="{id}-budget">
    <strong id="{id}-budget">Budget</strong>
    <div class="budget">
      {#each BUDGET as [key, title, tip] (key)}
        <div class="field">
          <div class="field-head">
            <label class="field-name" for="{id}-{key}" data-tip={tip}>{title}</label>
            <Save state={saves.of(key)} />
          </div>
          <input
            id="{id}-{key}"
            type="number"
            min={key === "hour" ? 0 : 1}
            max={key === "hour" ? 23 : undefined}
            value={shown[key]}
            aria-invalid={saves.invalid(key)}
            aria-busy={saves.busy(key)}
            use:entered={{
              set: String(shown[key]),
              save: (value, input) => save(key, { [key]: whole(value) }, () => (input.value = String(shown[key]))),
            }}
          />
        </div>
      {/each}
    </div>
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
      aria-invalid={saves.invalid("embed_model")}
      aria-busy={saves.busy("embed_model")}
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

  /* A right-hand field's tip opens leftward, inside the sheet. */
  .budget > :nth-child(even) [data-tip]::after {
    left: auto;
    right: 0;
  }

  /* Two by two on a phone. */
  @media (width < 720px) {
    .budget {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
