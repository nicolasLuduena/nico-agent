<script lang="ts">
  // The Repo's launches, Base and Project as /api/status shows them, each
  // written to config.toml on change; the Repo's own launch or Base goes back
  // to its Project's or the default.
  import { reload } from "../live";
  import type { Project, Repo, Status } from "../status";
  import From from "./From.svelte";
  import { choices } from "./launch";
  import Refused from "./Refused.svelte";
  import { patch, type Sent } from "./send";
  import { picked, unset } from "./settings";

  let { repo, status, project }: { repo: Repo; status: Status; project: Project | undefined } = $props();

  // The PATCH's answer, until /api/status's next one.
  let shown = $derived({ implementer: repo.implementer, reviewer: repo.reviewer, base: repo.base });
  let saving = $state<string | null>(null);
  let refused = $state<Sent | null>(null);

  /** The Project it names; none while it is its own. */
  const joined = $derived(project && project.name !== repo.slug ? project.name : null);
  const projects = $derived(status.projects.map((p) => p.name).filter((name) => name !== repo.slug));

  /** PATCH `body` as the setting `key`; `back` puts a refused field back to what is set. */
  async function save(key: string, body: Record<string, unknown>, back?: () => void) {
    saving = key;
    refused = null;
    const sent = await patch(repo.slug, body);
    saving = null;
    if (sent.ok) {
      shown = { implementer: sent.answer.implementer, reviewer: sent.answer.reviewer, base: sent.answer.base };
      // Its Project, and so what it takes from it, shows from /api/status.
      if (key === "project") reload();
    } else {
      refused = sent;
      back?.();
    }
  }

  /** What a text field sends: its name, or null to take the Project's or the default. */
  const named = (input: HTMLInputElement) => input.value.trim() || null;
</script>

{#snippet launch(key: "implementer" | "reviewer", title: string)}
  {@const setting = shown[key]}
  {@const takes = repo.harnesses[setting.value.harness] ?? { models: null, efforts: null }}
  {@const pick = (field: "harness" | "model" | "effort", select: HTMLSelectElement) =>
    save(key, { [key]: picked(setting.value, field, select.value || null) }, () => (select.value = setting.value[field] ?? ""))}
  <div class="launch" role="group" aria-labelledby="{key}-head">
    <div class="row">
      <span class="name" id="{key}-head">{title}</span>
      <From {setting} {project} keys={[key]} name={title} busy={saving === key} onundo={() => save(key, unset([key]))} />
    </div>
    <label class="wide">
      <span class="label">Harness</span>
      <select aria-label="{title} Harness" value={setting.value.harness} disabled={saving === key} onchange={(e) => pick("harness", e.currentTarget)}>
        {#each Object.keys(repo.harnesses) as name (name)}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="label">Model</span>
      <select aria-label="{title} model" value={setting.value.model ?? ""} disabled={saving === key} onchange={(e) => pick("model", e.currentTarget)}>
        {#each choices(takes.models, setting.value.model) as m (m)}
          <option value={m ?? ""}>{m ?? "default"}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="label">Effort</span>
      <select aria-label="{title} Effort" value={setting.value.effort ?? ""} disabled={saving === key} onchange={(e) => pick("effort", e.currentTarget)}>
        {#each choices(takes.efforts, setting.value.effort) as m (m)}
          <option value={m ?? ""}>{m ?? "default"}</option>
        {/each}
      </select>
    </label>
  </div>
{/snippet}

<section aria-labelledby="settings-head">
  <h2 class="label" id="settings-head">Settings</h2>
  {@render launch("implementer", "Implementer")}
  {@render launch("reviewer", "Reviewer")}
  <div class="row">
    <label class="name" for="base">Base</label>
    <From setting={shown.base} {project} keys={["base"]} name="Base" busy={saving === "base"} onundo={() => save("base", unset(["base"]))} />
  </div>
  <input
    id="base"
    value={shown.base.value ?? ""}
    placeholder="origin's default branch"
    disabled={saving === "base"}
    onchange={async (e) => {
      const input = e.currentTarget;
      await save("base", { base: named(input) });
      // Emptied, it shows what takes its place, which may be the value it last showed.
      input.value = shown.base.value ?? "";
    }}
  />
  <div class="row">
    <label class="name" for="project">Project</label>
    {#if joined}
      <button type="button" class="quiet" disabled={saving === "project"} onclick={() => save("project", { project: null })}>Leave {joined}</button>
    {/if}
  </div>
  <input
    id="project"
    list="projects"
    value={joined ?? ""}
    placeholder="its own"
    disabled={saving === "project"}
    onchange={(e) => {
      const input = e.currentTarget;
      save("project", { project: named(input) }, () => (input.value = joined ?? ""));
    }}
  />
  <datalist id="projects">
    {#each projects as name (name)}
      <option value={name}></option>
    {/each}
  </datalist>
  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
  }
  .launch {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px 12px;
    padding-bottom: 8px;
  }
  .row,
  .wide {
    grid-column: 1 / -1;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    min-height: 36px;
  }
  .name {
    margin-right: auto;
    font-weight: 600;
  }
  label:not(.name) {
    display: grid;
    gap: 4px;
    min-width: 0;
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
  select:disabled,
  input:disabled {
    opacity: 0.5;
    cursor: progress;
  }
</style>
