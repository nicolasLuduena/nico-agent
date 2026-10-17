<script lang="ts">
  // A Repo's launches, Base and Project, or a Project's launches and Base, as
  // /api/status shows them, folded under the Implementer's launch; each
  // written to config.toml as it changes, a text field on Enter or on leaving
  // it; its own launch or Base goes back to its Project's or the default.
  import { reload } from "../live";
  import { selection } from "../selection.svelte";
  import type { Launch, Project, Repo } from "../status";
  import { entered } from "./field";
  import Fold from "./Fold.svelte";
  import From from "./From.svelte";
  import LaunchPicker from "./LaunchPicker.svelte";
  import Refused from "./Refused.svelte";
  import Save from "./Save.svelte";
  import { Saves } from "./saves.svelte";
  import { type Holder, picked, unset } from "./settings";

  let {
    holder,
    harnesses,
    repo,
    projects = [],
  }: { holder: Holder; harnesses: Repo["harnesses"]; repo?: Repo; projects?: Project[] } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let shown = $derived({ implementer: holder.settings.implementer, reviewer: holder.settings.reviewer, base: holder.settings.base });
  const saves = new Saves();

  /** The Project the Repo names; none while it is its own. */
  const joined = $derived(repo && holder.under && holder.under.name !== repo.slug ? holder.under.name : null);
  const others = $derived(projects.map((p) => p.name).filter((name) => name !== repo?.slug));

  /** PATCH `body` as the setting `key`; `back` puts a refused field back to what is set. */
  async function save(key: string, body: Record<string, unknown>, back?: () => void) {
    const sent = await saves.run(key, () => holder.patch(body));
    if (sent.ok) {
      shown = { implementer: sent.answer.implementer, reviewer: sent.answer.reviewer, base: sent.answer.base };
      // Its Project, and so its page and what it takes from it, shows from /api/status; the
      // new one reads its own map, and the old one, which may be gone, is not asked again.
      if (key === "project" && repo) {
        selection.project = (body.project as string | null) ?? repo.slug;
        reload("/api/status");
      }
    } else back?.();
  }

  /** What a text field sends: its name, or null to take the Project's or the default. */
  const named = (value: string) => value.trim() || null;
  /** A launch in a line, kept whole where the line wraps: its Harness, then its model and Effort when set. */
  const said = (l: Launch) => [l.harness, l.model, l.effort].filter(Boolean).join("\u00a0·\u00a0");
</script>

{#snippet launch(key: "implementer" | "reviewer", title: string)}
  {@const setting = shown[key]}
  <div class="field" role="group" aria-labelledby="{id}-{key}">
    <div class="field-head">
      <strong id="{id}-{key}">{title}</strong>
      <Save state={saves.of(key)}>
        <From {setting} {holder} keys={[key]} name={title} onundo={() => save(key, unset([key]))} />
      </Save>
    </div>
    <LaunchPicker
      {harnesses}
      launch={setting.value}
      named={title}
      invalid={!!saves.invalid(key)}
      busy={saves.busy(key)}
      pick={(field, value, back) => save(key, { [key]: picked(setting.value, field, value) }, back)}
    />
  </div>
{/snippet}

<Fold panel={holder.panel} title="Settings" summary="Implementer {said(shown.implementer.value)}" alarm={saves.refused !== null}>
  {@render launch("implementer", "Implementer")}
  {@render launch("reviewer", "Reviewer")}
  <div class="field">
    <div class="field-head">
      <label class="field-name" for="{id}-base">Base</label>
      <Save state={saves.of("base")}>
        <From setting={shown.base} {holder} keys={["base"]} name="Base" onundo={() => save("base", unset(["base"]))} />
      </Save>
    </div>
    <input
      id="{id}-base"
      value={shown.base.value ?? ""}
      placeholder="origin's default branch"
      autocomplete="off"
      aria-invalid={saves.invalid("base")}
      aria-busy={saves.busy("base")}
      use:entered={{
        set: shown.base.value ?? "",
        save: async (value, input) => {
          await save("base", { base: named(value) });
          // Emptied, it shows what takes its place, which may be the value it last showed.
          input.value = shown.base.value ?? "";
        },
      }}
    />
  </div>
  {#if repo}
    <div class="field">
      <div class="field-head">
        <label class="field-name" for="{id}-project">Project</label>
        <Save state={saves.of("project")} />
      </div>
      <div class="project">
        <input
          id="{id}-project"
          list="{id}-projects"
          value={joined ?? ""}
          placeholder="its own"
          autocomplete="off"
          aria-invalid={saves.invalid("project")}
          aria-busy={saves.busy("project")}
          use:entered={{
            set: joined ?? "",
            save: (value, input) => save("project", { project: named(value) }, () => (input.value = joined ?? "")),
          }}
        />
        {#if joined}
          <button type="button" class="quiet" onclick={() => save("project", { project: null })}>Leave {joined}</button>
        {/if}
      </div>
      <datalist id="{id}-projects">
        {#each others as name (name)}
          <option value={name}></option>
        {/each}
      </datalist>
    </div>
  {/if}
  {#if saves.refused}
    <Refused error={saves.refused.error} help={saves.refused.help} />
  {/if}
</Fold>

<style>
  /* The Implementer and the Reviewer, each a group set off from what follows. */
  [role="group"] {
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--hairline);
  }
  .project {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .project input {
    flex: 1 1 140px;
    width: auto;
    min-width: 0;
  }
  .project button {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
</style>
