<script lang="ts">
  // The Library versions a Repo links, as /api/status shows them, each with
  // where its Wiki stands: Unlink takes one out, the form links another;
  // each written to config.toml as the Repo's own list, which a new version
  // with no Wiki queues. Its own list goes back to its Project's or the default.
  import type { WikiState } from "../status";
  import { type Library, libraryId, standing } from "../wiki/wiki";
  import From from "./From.svelte";
  import Refused from "./Refused.svelte";
  import type { Sent } from "./send";
  import { type Holder, unset } from "./settings";

  let { holder, wikis }: { holder: Holder; wikis: WikiState[] } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let linked = $derived(holder.settings.libraries);
  let saving = $state(false);
  let refused = $state<Sent | null>(null);

  async function save(body: Record<string, unknown>) {
    saving = true;
    refused = null;
    const sent = await holder.patch(body);
    saving = false;
    if (sent.ok) linked = sent.answer.libraries;
    else refused = sent;
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

<section aria-labelledby="{id}-head">
  <div class="row">
    <h2 class="label" id="{id}-head">Libraries</h2>
    <From setting={linked} {holder} keys={["libraries"]} name="Libraries" busy={saving} onundo={() => save(unset(["libraries"]))} />
  </div>
  {#if linked.value.length === 0}
    <p class="muted">None linked: its agents read Libraries' code themselves</p>
  {:else}
    <ul>
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
    <label>
      <span class="label">Library</span>
      <input name="repo" placeholder="owner/name" required autocomplete="off" disabled={saving} />
    </label>
    <label>
      <span class="label">Tag</span>
      <input name="tag" placeholder="v1.2.3" required autocomplete="off" disabled={saving} />
    </label>
    <label class="wide">
      <span class="label">Subfolder</span>
      <input name="path" placeholder="the whole repository" autocomplete="off" disabled={saving} />
    </label>
    <button type="submit" class="quiet" disabled={saving} aria-busy={saving}>{saving ? "Saving…" : "Link"}</button>
  </form>
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
    justify-content: space-between;
    gap: 4px 12px;
    min-height: 36px;
  }
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
  label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  label .label {
    color: var(--ink-muted);
  }
  .wide {
    grid-column: 1 / -1;
  }
  form button {
    justify-self: start;
  }
  input {
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
    text-overflow: ellipsis;
  }
  input:disabled {
    opacity: 0.5;
    cursor: progress;
  }
</style>
