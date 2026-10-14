<script lang="ts">
  // The Library versions a Repo links, as /api/status shows them, folded
  // under how many, each with where its Wiki stands: Unlink takes one out, the
  // form links another; each written to config.toml as the Repo's own list,
  // which a new version with no Wiki queues. Its own list goes back to its
  // Project's or the default.
  import type { WikiState } from "../status";
  import { type Library, libraryId, standing } from "../wiki/wiki";
  import Fold from "./Fold.svelte";
  import From from "./From.svelte";
  import Refused from "./Refused.svelte";
  import Save from "./Save.svelte";
  import { Saves } from "./saves.svelte";
  import { type Holder, unset } from "./settings";

  let { holder, wikis }: { holder: Holder; wikis: WikiState[] } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let linked = $derived(holder.settings.libraries);
  const saves = new Saves();
  const saving = $derived(saves.busy("libraries"));

  async function save(body: Record<string, unknown>) {
    const sent = await saves.run("libraries", () => holder.patch(body));
    if (sent.ok) linked = sent.answer.libraries;
    return sent.ok;
  }

  async function link(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    // No subfolder is the whole repository: left out, not empty.
    const added: Library = { repo: field("repo"), tag: field("tag"), ...(field("path") && { path: field("path") }) };
    if (await save({ libraries: [...linked.value, added] })) form.reset();
  }
</script>

<Fold
  panel={holder.panel}
  title="Libraries"
  summary={linked.value.length === 0 ? "None linked" : `${linked.value.length} linked`}
  alarm={saves.refused !== null}
>
  <div class="field-head">
    <span class="field-name" id="{id}-linked">Linked versions</span>
    <Save state={saves.of("libraries")}>
      <From setting={linked} {holder} keys={["libraries"]} name="Libraries" onundo={() => save(unset(["libraries"]))} />
    </Save>
  </div>
  {#if linked.value.length === 0}
    <p class="muted">None linked: its agents read Libraries' code themselves</p>
  {:else}
    <ul aria-labelledby="{id}-linked">
      {#each linked.value as library, i (i)}
        <li>
          <span class="version">
            <strong>{library.repo}</strong>
            <span>{library.tag}{library.path ? ` · ${library.path}` : ""}</span>
            <span class="muted">{standing(wikis, libraryId(library))}</span>
          </span>
          <button
            type="button"
            class="quiet"
            aria-label="Unlink {libraryId(library)}"
            disabled={saving}
            onclick={() => save({ libraries: linked.value.filter((_, j) => j !== i) })}>Unlink</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  <form onsubmit={link} aria-label="Link a Library">
    <label class="field">
      <span class="field-name">Library</span>
      <input name="repo" placeholder="owner/name" required autocomplete="off" />
    </label>
    <label class="field">
      <span class="field-name">Tag</span>
      <input name="tag" placeholder="v1.2.3" required autocomplete="off" />
    </label>
    <label class="field wide">
      <span class="field-name">Subfolder</span>
      <input name="path" placeholder="the whole repository" autocomplete="off" />
    </label>
    <button type="submit" class="quiet" disabled={saving} aria-busy={saving}>Link</button>
  </form>
  {#if saves.refused}
    <Refused error={saves.refused.error} help={saves.refused.help} />
  {/if}
</Fold>

<style>
  ul {
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .version {
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-muted);
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: end;
    gap: 8px 12px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  form button {
    justify-self: start;
  }
</style>
