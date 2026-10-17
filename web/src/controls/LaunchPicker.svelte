<script lang="ts">
  // A launch, picked as the Dispatch form, the Implementer, the Reviewer and
  // the Wiki's take it: its Harness, marked in its hue, then its model and
  // Effort, each a select of what the Harness lists, or a text field where it
  // takes any, suggesting what the Harness's own files name. `pick` gets each change, and how to put the field back should
  // serve refuse it.
  import { harnessHue } from "../hues";
  import type { Launch, Repo } from "../status";
  import { entered } from "./field";
  import { choices } from "./launch";

  let {
    harnesses,
    launch,
    named = "",
    rule,
    invalid = false,
    busy = false,
    pick,
  }: {
    harnesses: Repo["harnesses"];
    launch: Launch;
    /** Whose launch it is, which names each field: `Implementer model`; none, `Model`. */
    named?: string;
    /** The label of a first Harness option that leaves the Harness to a rule; chosen, `launch.harness` is "". */
    rule?: string;
    invalid?: boolean;
    busy?: boolean;
    pick: (field: keyof Launch, value: string | null, back: () => void) => unknown;
  } = $props();

  const id = $props.id();
  const takes = $derived(harnesses[launch.harness] ?? { models: null, efforts: null });
  const LABEL = { harness: "Harness", model: "Model", effort: "Effort" };
  /** A field's accessible name: its label, or after whose launch it is, `Implementer model`. */
  const called = (field: keyof Launch) => (named ? `${named} ${field === "model" ? "model" : LABEL[field]}` : LABEL[field]);
</script>

{#snippet chosen(field: "model" | "effort", listed: string[] | null, suggested: string[] = [])}
  {@const value = launch[field]}
  <label class="field">
    <span class="field-name">{LABEL[field]}</span>
    {#if launch.harness === ""}
      <select aria-label={called(field)} disabled><option>default</option></select>
    {:else if listed}
      <select
        aria-label={called(field)}
        value={value ?? ""}
        aria-invalid={invalid || undefined}
        aria-busy={busy}
        onchange={(e) => {
          const select = e.currentTarget;
          pick(field, select.value || null, () => (select.value = launch[field] ?? ""));
        }}
      >
        {#each choices(listed, value) as m (m)}
          <option value={m ?? ""}>{m ?? "default"}</option>
        {/each}
      </select>
    {:else}
      <input
        aria-label={called(field)}
        value={value ?? ""}
        placeholder="default"
        autocomplete="off"
        list={suggested.length ? `${id}-${field}` : undefined}
        aria-invalid={invalid || undefined}
        aria-busy={busy}
        use:entered={{
          set: value ?? "",
          save: async (typed, input) => pick(field, typed.trim() || null, () => (input.value = launch[field] ?? "")),
        }}
      />
      {#if suggested.length}
        <datalist id="{id}-{field}">
          {#each suggested as s (s)}<option value={s}></option>{/each}
        </datalist>
      {/if}
    {/if}
  </label>
{/snippet}

<div class="launch">
  <div class="fields">
    <label class="field">
      <span class="field-name">{LABEL.harness}</span>
      <span class="marked" style:--harness={harnessHue(launch.harness)}>
        <span class="harness" class:ruled={launch.harness === ""} aria-hidden="true"></span>
        <select
          aria-label={called("harness")}
          value={launch.harness}
          aria-invalid={invalid || undefined}
          aria-busy={busy}
          onchange={(e) => {
            const select = e.currentTarget;
            pick("harness", select.value, () => (select.value = launch.harness));
          }}
        >
          {#if rule}<option value="">{rule}</option>{/if}
          {#each Object.keys(harnesses) as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </span>
    </label>
    {@render chosen("model", takes.models, takes.suggested?.models)}
    {@render chosen("effort", takes.efforts, takes.suggested?.efforts)}
  </div>
</div>

<style>
  .launch {
    container-type: inline-size;
  }
  /* The Harness across, model and Effort side by side under it; in a row of three where there is room. */
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px 12px;
  }
  .fields > :first-child {
    grid-column: 1 / -1;
  }
  @container (width >= 480px) {
    .fields {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .fields > :first-child {
      grid-column: auto;
    }
  }
  /* The Harness's diamond inside its select, as it is named everywhere. */
  .marked {
    position: relative;
    display: block;
  }
  .harness {
    position: absolute;
    top: 50%;
    left: 10px;
    margin-top: -4px;
    pointer-events: none;
  }
  .marked select {
    padding-left: 28px;
  }
  /* No one Harness: the diamond hollow. */
  .harness.ruled {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
  }
</style>
