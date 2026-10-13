<script lang="ts">
  // What every Wiki is built on, `[wiki]` in config.toml, each setting
  // written on change through PATCH /api/wiki/settings. The model and the
  // Effort are picked from the Harness's own where it lists them, and typed
  // where it takes any.
  import { choices } from "../controls/launch";
  import Refused from "../controls/Refused.svelte";
  import { send, type Sent } from "../controls/send";
  import { picked } from "../controls/settings";
  import type { Launch, WikiSettings } from "../status";

  let { settings }: { settings: WikiSettings } = $props();

  // The PATCH's answer, until /api/status's next one.
  let shown = $derived(settings);
  let saving = $state<string | null>(null);
  let refused = $state<Sent | null>(null);

  /** PATCH `body` as the setting `key`; `back` puts a refused field back to what is set. */
  async function save(key: string, body: Record<string, unknown>, back: () => void) {
    saving = key;
    refused = null;
    const sent = await send("PATCH", "/api/wiki/settings", body);
    saving = null;
    if (sent.ok) shown = sent.answer;
    else {
      refused = sent;
      back();
    }
  }

  const takes = $derived(shown.harnesses[shown.launch.harness] ?? { models: null, efforts: null });
  const pick = (field: keyof Launch, value: string | null, back: () => void) => save("launch", { launch: picked(shown.launch, field, value) }, back);

  /** The budget's fields, each a whole number. */
  const BUDGET = [
    ["hour", "Hour"],
    ["calls", "Calls"],
    ["depth", "Depth"],
    ["concurrency", "Calls at once"],
  ] as const;
</script>

<!-- A model or Effort: a select of what the Harness lists, or a text field where it lists none. -->
{#snippet chosen(field: "model" | "effort", title: string, listed: string[] | null)}
  {@const value = shown.launch[field]}
  <label>
    <span class="label">{title}</span>
    {#if listed}
      <select aria-label={title} value={value ?? ""} disabled={saving === "launch"} onchange={(e) => {
        const select = e.currentTarget;
        pick(field, select.value || null, () => (select.value = shown.launch[field] ?? ""));
      }}>
        {#each choices(listed, value) as m (m)}
          <option value={m ?? ""}>{m ?? "default"}</option>
        {/each}
      </select>
    {:else}
      <input aria-label={title} value={value ?? ""} placeholder="the Harness's default" disabled={saving === "launch"} onchange={(e) => {
        const input = e.currentTarget;
        pick(field, input.value.trim() || null, () => (input.value = shown.launch[field] ?? ""));
      }} />
    {/if}
  </label>
{/snippet}

<section class="settings" aria-label="Settings for every Wiki">
  <p>These apply to every Wiki, of every Repo.</p>

  <div class="row launch" role="group" aria-label="Launch">
    <label>
      <span class="label">Harness</span>
      <select aria-label="Harness" value={shown.launch.harness} disabled={saving === "launch"} onchange={(e) => {
        const select = e.currentTarget;
        pick("harness", select.value, () => (select.value = shown.launch.harness));
      }}>
        {#each Object.keys(shown.harnesses) as name (name)}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>
    {@render chosen("model", "Model", takes.models)}
    {@render chosen("effort", "Effort", takes.efforts)}
  </div>

  <div class="row budget" role="group" aria-label="Budget">
    {#each BUDGET as [key, title] (key)}
      <label>
        <span class="label">{title}</span>
        <!-- An empty or partial number is sent as "" and refused: null would take the default. -->
        <input
          type="number"
          min={key === "hour" ? 0 : 1}
          max={key === "hour" ? 23 : undefined}
          value={shown[key]}
          disabled={saving === key}
          onchange={(e) => {
            const input = e.currentTarget;
            const n = input.valueAsNumber;
            save(key, { [key]: Number.isNaN(n) ? "" : n }, () => (input.value = String(shown[key])));
          }}
        />
      </label>
    {/each}
  </div>
  <p>The loop checks each Repo's Wiki daily from Hour, local time. A build makes at most Calls model calls, Calls at once at a time, dividing the code at most Depth deep.</p>

  <label class="wide">
    <span class="label">Embedding model</span>
    <input
      value={shown.embed_model}
      disabled={saving === "embed_model"}
      onchange={(e) => {
        const input = e.currentTarget;
        save("embed_model", { embed_model: input.value.trim() }, () => (input.value = shown.embed_model));
      }}
    />
  </label>
  <p>The Ollama model that embeds each Wiki, for agents' questions through <code>ask</code>.</p>

  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
</section>

<style>
  .settings {
    display: grid;
    gap: 8px;
    max-width: 720px;
  }
  p {
    color: var(--ink-muted);
  }
  .row {
    display: grid;
    gap: 8px 12px;
    padding-top: 8px;
  }
  .launch {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .budget {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .wide {
    padding-top: 8px;
  }
  label .label {
    color: var(--ink-muted);
  }
  select,
  input {
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
    text-overflow: ellipsis;
  }
  input::placeholder {
    color: var(--ink-muted);
  }
  select:disabled,
  input:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  /* Two by two on a phone. */
  @media (width < 720px) {
    .launch {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .launch label:first-child {
      grid-column: 1 / -1;
    }
    .budget {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
