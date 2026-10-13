<script lang="ts">
  // The Libraries tab: the Library versions no Repo links, kept for the
  // user's own sessions, each with where its Wiki stands and its removal,
  // asked twice; then the form that adds one, which queues its Wiki.
  import { reload } from "./live";
  import Refused from "./controls/Refused.svelte";
  import { send, type Sent } from "./controls/send";
  import type { Status } from "./status";
  import { libraryId, standing } from "./wiki/wiki";

  let { status }: { status: Status } = $props();

  let asking = $state<string | null>(null);
  let running = $state<string | null>(null);
  let refused = $state<{ id: string; sent: Sent } | null>(null);
  let added = $state<Sent | null>(null);

  async function remove(id: string) {
    running = id;
    refused = null;
    const sent = await send("DELETE", `/api/libraries/${encodeURIComponent(id)}`);
    running = null;
    asking = null;
    if (sent.ok) reload("/api/status");
    else refused = { id, sent };
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    running = "";
    added = null;
    // No subfolder is the whole repository: left out, not empty.
    added = await send("POST", "/api/libraries", { repo: field("repo"), tag: field("tag"), ...(field("path") && { path: field("path") }) });
    running = null;
    if (!added.ok) return;
    form.reset();
    reload("/api/status");
  }
</script>

<div class="libraries">
  <p class="muted">
    Library versions no Repo links, whose Wikis your own sessions ask through <code>nico-agent mcp</code>. Link one to a Repo in its settings
    instead, for its agents.
  </p>
  {#if status.libraries.length === 0}
    <p class="muted">None added.</p>
  {:else}
    <ul aria-label="Libraries">
      {#each status.libraries as library (libraryId(library))}
        {@const id = libraryId(library)}
        <li>
          <span class="version">
            <strong>{library.repo}</strong>
            <span>{library.tag}{library.path ? ` · ${library.path}` : ""}</span>
            <span class="muted">{standing(status.wikis, id)}</span>
          </span>
          <span class="buttons">
            {#if asking === id}
              <span role="status">Remove it? Its Wiki leaves the Bucket's files; its history keeps it.</span>
              <button type="button" class="quiet" disabled={running === id} aria-busy={running === id} onclick={() => remove(id)}>
                {running === id ? "Removing…" : `Remove ${id}`}
              </button>
              <button type="button" class="quiet" disabled={running === id} onclick={() => (asking = null)}>Keep it</button>
            {:else}
              <button type="button" class="quiet" onclick={() => ((asking = id), (refused = null))}>Remove {id}…</button>
            {/if}
          </span>
          {#if refused?.id === id && !refused.sent.ok}
            <div class="refused"><Refused error={refused.sent.error} help={refused.sent.help} /></div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <section aria-labelledby="add-library-head">
    <h2 class="label" id="add-library-head">Add a Library</h2>
    <form onsubmit={add}>
      <label>
        <span class="label">Library</span>
        <input name="repo" placeholder="owner/name" required autocomplete="off" />
      </label>
      <label>
        <span class="label">Tag</span>
        <input name="tag" placeholder="v1.2.3" required autocomplete="off" />
      </label>
      <label>
        <span class="label">Subfolder</span>
        <input name="path" placeholder="the whole repository" autocomplete="off" />
      </label>
      <button type="submit" disabled={running === ""} aria-busy={running === ""}>{running === "" ? "Adding…" : "Add"}</button>
    </form>
    {#if added?.ok}
      <p role="status">{added.answer.library}.</p>
    {:else if added && !added.ok}
      <Refused error={added.error} help={added.help} />
    {/if}
  </section>
</div>

<style>
  .libraries {
    display: grid;
    gap: 16px;
    padding: 16px var(--gutter) var(--gutter);
  }
  .muted {
    color: var(--ink-muted);
  }
  ul {
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--hairline);
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--hairline);
  }
  .version {
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .buttons button {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .refused {
    flex: 1 1 100%;
  }
  /* As Add a Repo: a surface section, its fields in a row, stacked on a phone. */
  section {
    display: grid;
    gap: 12px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  h2 {
    font-size: 14px;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    flex: 1 1 200px;
    min-width: 0;
  }
  label .label {
    color: var(--ink-muted);
  }
  input {
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
  }
  form button {
    min-height: 36px;
    padding: 8px 16px;
    border: 0;
    border-radius: 2px;
    background: var(--ink);
    color: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  form button:hover:not(:disabled) {
    opacity: 0.85;
  }
  form button:disabled {
    opacity: 0.5;
    cursor: progress;
  }
</style>
