<script lang="ts">
  // Dispatch by hand: one of the Repo's Ready, Stackable or Gardening issues, on a
  // Harness, model and Effort that start on the last launch used.
  import { Button } from "$lib/components/ui/button/index.js";
  import { reload } from "../live";
  import { number, type Repo, type Status } from "../status";
  import { asksToAssign, assignMe } from "./assign";
  import Fold from "./Fold.svelte";
  import Press from "./Press.svelte";
  import LaunchPicker from "./LaunchPicker.svelte";
  import { harnessHue } from "../hues";
  import { otherHarness, startingLaunch } from "./launch";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { repo, status, panel }: { repo: Repo; status: Status; panel: string } = $props();

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
  /** Whether the form starts on a launch used before in the Repo, rather than its Implementer's. */
  const used = $derived(status.dispatches.some((d) => d.repo === repo.slug && d.implementer.harness in repo.harnesses));
  /** Who reviews it: the Reviewer set, or else another Harness than the one picked. */
  const ruled = $derived(repo.reviewer.from === "default");
  const reviewer = $derived(ruled ? otherHarness(Object.keys(repo.harnesses), launch.harness) : repo.reviewer.value.harness);

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

<Fold {panel} title="Dispatch" summary={issues.length ? `${issues.length} to dispatch` : "Nothing to dispatch"} alarm={sent !== null && !sent.outcome.ok}>
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
    <div class="said">
      <p>{used ? "Starts on the last launch used in this Repo" : "Starts on the Implementer's launch in Settings"}</p>
      <p>
        {#if repo.switches.review?.value === false}
          Not reviewed: review is off for this Repo
        {:else}
          Reviewed on <span class="harness" style:--harness={harnessHue(reviewer)} aria-hidden="true"></span>{reviewer}, {!ruled
            ? "as Settings sets it"
            : reviewer === launch.harness
              ? "the only Harness"
              : "not the Implementer's Harness"}
        {/if}
      </p>
    </div>
    <Button type="submit" disabled={!issue || running} aria-busy={running}>
      {running ? "Dispatching…" : "Dispatch"}
    </Button>
  </form>
  {#if sent?.outcome.ok}
    <p role="status">Dispatched {number(sent.issue, repo.slug)}.</p>
  {:else if sent && !sent.outcome.ok}
    <Refused error={sent.outcome.error} help={sent.outcome.help} />
    {#if asksToAssign(sent.outcome.help)}
      <Press issue={sent.issue} action={assignMe} ondone={() => (sent = null)} />
    {/if}
  {/if}
</Fold>

<style>
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .said {
    display: grid;
    gap: 2px;
    color: var(--ink-muted);
  }
</style>
