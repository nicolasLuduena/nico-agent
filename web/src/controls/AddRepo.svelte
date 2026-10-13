<script lang="ts">
  // Add a Repo, as `repo add` does: its owner/name, the path of its clone and,
  // if any, the Project it joins. Its tab opens once added.
  import { reload } from "../live";
  import { selection } from "../selection.svelte";
  import type { Status } from "../status";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { status }: { status: Status } = $props();

  let running = $state(false);
  let sent = $state<{ slug: string; outcome: Sent } | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    // Empty is unset: `repo add` refuses a missing slug or path, and a Project left out keeps the one named.
    const field = (name: string) => String(data.get(name) ?? "").trim() || null;
    const slug = field("slug") ?? "";
    running = true;
    sent = null;
    const outcome = await send("POST", "/api/repo", { slug: field("slug"), path: field("path"), project: field("project") });
    running = false;
    sent = { slug, outcome };
    if (!outcome.ok) return;
    form.reset();
    selection.repo = slug;
    selection.issue = null;
    reload();
  }
</script>

<section aria-labelledby="add-head">
  <h2 class="label" id="add-head">Add a Repo</h2>
  <form onsubmit={submit}>
    <label>
      <span class="label">Repo</span>
      <input name="slug" placeholder="owner/name" required autocomplete="off" />
    </label>
    <label>
      <span class="label">Its clone</span>
      <input name="path" placeholder="/path/to/its/clone" required autocomplete="off" />
    </label>
    <label>
      <span class="label">Its Project</span>
      <input name="project" list="add-projects" placeholder="its own" autocomplete="off" />
    </label>
    <datalist id="add-projects">
      {#each status.projects as p (p.name)}
        <option value={p.name}></option>
      {/each}
    </datalist>
    <button type="submit" disabled={running} aria-busy={running}>{running ? "Adding…" : "Add"}</button>
  </form>
  {#if sent?.outcome.ok}
    <p role="status">{sent.outcome.answer.repo}.</p>
  {:else if sent && !sent.outcome.ok}
    <Refused error={sent.outcome.error} help={sent.outcome.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 12px;
    margin: 0 var(--gutter) var(--gutter);
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
  button {
    min-height: 36px;
    padding: 8px 16px;
    border: 0;
    border-radius: 2px;
    background: var(--ink);
    color: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    opacity: 0.85;
  }
  button:disabled {
    opacity: 0.5;
    cursor: progress;
  }
</style>
