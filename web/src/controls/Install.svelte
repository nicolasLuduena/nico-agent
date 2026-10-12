<script lang="ts">
  // The Repo's Install as /api/status shows it: its command, written to
  // config.toml on change (emptied, removed), and how the last one went, a
  // failed or refused one on the errata rule with what it printed.
  import { reload } from "../live";
  import type { Repo } from "../status";
  import { clock } from "../time";
  import Refused, { ticked } from "./Refused.svelte";
  import { patch, type Sent } from "./send";

  let { repo }: { repo: Repo } = $props();

  let saving = $state(false);
  let refused = $state<Sent | null>(null);
  const last = $derived(repo.install?.last ?? null);

  async function save(input: HTMLInputElement) {
    saving = true;
    refused = null;
    const sent = await patch(repo.slug, { install: input.value.trim() || null });
    saving = false;
    if (sent.ok) reload();
    else {
      refused = sent;
      input.value = repo.install?.command ?? "";
    }
  }
</script>

<section aria-labelledby="install-head">
  <h2 class="label" id="install-head">Install</h2>
  <input
    aria-labelledby="install-head"
    value={repo.install?.command ?? ""}
    placeholder="none: nothing runs after a merge"
    disabled={saving}
    onchange={(e) => save(e.currentTarget)}
  />
  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
  {#if last?.ok}
    <p class="muted">Installed {last.sha?.slice(0, 7)} at {clock(last.at)}</p>
  {:else if last}
    <div class="errata">
      <p class="said">Failed at {clock(last.at)}</p>
      <pre>{last.output}</pre>
      <p>{@render ticked(`Run \`nico-agent install ${repo.slug}\` once it is fixed`)}</p>
    </div>
  {:else if repo.install}
    <p class="muted">Runs in its clone after each merge into its Base</p>
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
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
  .said {
    font-weight: 600;
  }
  pre {
    font: inherit;
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-muted);
  }
</style>
