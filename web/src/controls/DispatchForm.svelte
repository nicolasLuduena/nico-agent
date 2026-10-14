<script lang="ts">
  // Dispatch by hand: one of the Repo's Ready, Stackable or Gardening issues, on a
  // Harness, model and Effort that start on the last launch used.
  import { reload } from "../live";
  import { number, type Repo, type Status } from "../status";
  import { asksToAssign, assignMe } from "./assign";
  import Press from "./Press.svelte";
  import LaunchPicker from "./LaunchPicker.svelte";
  import { startingLaunch } from "./launch";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { repo, status }: { repo: Repo; status: Status } = $props();
  const id = $props.id();

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

<section aria-labelledby="{id}-head">
  <h2 class="label" id="{id}-head">Dispatch</h2>
  <form onsubmit={submit}>
    <label class="field">
      <span class="field-name">Issue</span>
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
    <LaunchPicker
      harnesses={repo.harnesses}
      launch={{ harness: launch.harness, model, effort }}
      pick={(field, value) => (pick = field === "harness" ? { issue: pick.issue, harness: value ?? launch.harness } : { ...pick, [field]: value })}
    />
    <button type="submit" class="button" disabled={!issue || running} aria-busy={running}>
      {running ? "Dispatching…" : "Dispatch"}
    </button>
  </form>
  {#if sent?.outcome.ok}
    <p role="status">Dispatched {number(sent.issue, repo.slug)}.</p>
  {:else if sent && !sent.outcome.ok}
    <Refused error={sent.outcome.error} help={sent.outcome.help} />
    {#if asksToAssign(sent.outcome.help)}
      <Press issue={sent.issue} action={assignMe} ondone={() => (sent = null)} />
    {/if}
  {/if}
</section>

<style>
  /* The panel's one action, first, set off from the folded sections under it. */
  section {
    display: grid;
    gap: 8px;
    padding-bottom: 8px;
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
</style>
