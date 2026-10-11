<script lang="ts">
  // Dispatch by hand: one of the Repo's Ready, Stackable or Gardening issues, on a
  // Harness, model and Effort that start on the last launch used.
  import { reload } from "../live";
  import { number, type Repo, type Status } from "../status";
  import { choices, startingLaunch } from "./launch";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { repo, status }: { repo: Repo; status: Status } = $props();

  // What the user picked; unset, what the form starts on.
  let pick = $state<{ issue?: string; harness?: string; model?: string | null; effort?: string | null }>({});
  let running = $state(false);
  let sent = $state<{ issue: string; outcome: Sent } | null>(null);

  const groups = $derived([["Ready", repo.ready], ["Stackable", repo.stackable], ["Gardening", repo.gardening]] as const);
  const issues = $derived([...repo.ready, ...repo.stackable, ...repo.gardening]);
  const issue = $derived(issues.find((i) => i.key === pick.issue)?.key ?? issues[0]?.key);
  const launch = $derived(startingLaunch(repo, status.dispatches, pick.harness));
  const model = $derived(pick.model !== undefined ? pick.model : launch.model);
  const effort = $derived(pick.effort !== undefined ? pick.effort : launch.effort);
  const takes = $derived(repo.harnesses[launch.harness] ?? { models: null, efforts: null });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!issue) return;
    running = true;
    sent = null;
    const outcome = await send("POST", "/api/dispatch", { issue, harness: launch.harness, model, effort });
    running = false;
    sent = { issue, outcome };
    if (outcome.ok) pick = {};
    // A refusal may still have recorded the Dispatch, failed at a step.
    reload();
  }
</script>

<section aria-labelledby="dispatch-head">
  <h2 class="label" id="dispatch-head">Dispatch</h2>
  <form onsubmit={submit}>
    <label class="wide">
      <span class="label">Issue</span>
      <select value={issue ?? ""} disabled={!issue} onchange={(e) => (pick.issue = e.currentTarget.value)}>
        {#if !issue}
          <option value="">Nothing to dispatch</option>
        {/if}
        {#each groups as [group, listed] (group)}
          {#if listed.length}
            <optgroup label={group}>
              {#each listed as i (i.key)}
                <option value={i.key}>{number(i.key, repo.slug)} {i.title}</option>
              {/each}
            </optgroup>
          {/if}
        {/each}
      </select>
    </label>
    <label class="wide">
      <span class="label">Harness</span>
      <select value={launch.harness} onchange={(e) => (pick = { issue: pick.issue, harness: e.currentTarget.value })}>
        {#each Object.keys(repo.harnesses) as name (name)}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="label">Model</span>
      <select value={model ?? ""} onchange={(e) => (pick.model = e.currentTarget.value || null)}>
        {#each choices(takes.models, model) as m (m)}
          <option value={m ?? ""}>{m ?? "default"}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="label">Effort</span>
      <select value={effort ?? ""} onchange={(e) => (pick.effort = e.currentTarget.value || null)}>
        {#each choices(takes.efforts, effort) as m (m)}
          <option value={m ?? ""}>{m ?? "default"}</option>
        {/each}
      </select>
    </label>
    <button type="submit" class="wide" disabled={!issue || running} aria-busy={running}>
      {running ? "Dispatching…" : "Dispatch"}
    </button>
  </form>
  {#if sent?.outcome.ok}
    <p role="status">Dispatched {number(sent.issue, repo.slug)}.</p>
  {:else if sent && !sent.outcome.ok}
    <Refused error={sent.outcome.error} help={sent.outcome.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  label .label {
    color: var(--ink-muted);
  }
  select {
    width: 100%;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--surface);
    text-overflow: ellipsis;
  }
  select:disabled {
    color: var(--ink-muted);
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
    cursor: not-allowed;
  }
  button[aria-busy="true"] {
    cursor: progress;
  }
</style>
