<script lang="ts">
  // The Repo's Install as /api/status shows it, folded under how the last one
  // went: its command, written to config.toml as it is entered (emptied,
  // removed), and the last Install, a failed or refused one on the errata rule
  // with what it printed, which opens the section by itself.
  import { Input } from "$lib/components/ui/input/index.js";
  import { fromAction } from "svelte/attachments";
  import { reload } from "../live";
  import type { Repo } from "../status";
  import { clock } from "../time";
  import { entered } from "./field";
  import Fold from "./Fold.svelte";
  import Refused, { ticked } from "./Refused.svelte";
  import Save from "./Save.svelte";
  import { Saves } from "./saves.svelte";
  import { patch } from "./send";

  let { repo, panel }: { repo: Repo; panel: string } = $props();
  const id = $props.id();

  const saves = new Saves();
  const last = $derived(repo.install?.last ?? null);
  const summary = $derived(
    last?.ok ? `Installed ${last.sha?.slice(0, 7)}` : last ? `Failed at ${clock(last.at)}` : repo.install ? "Not run yet" : "None",
  );

  async function save(value: string, input: HTMLInputElement) {
    const sent = await saves.run("install", () => patch(repo.slug, { install: value.trim() || null }));
    if (sent.ok) reload();
    else input.value = repo.install?.command ?? "";
  }
</script>

<Fold {panel} title="Install" {summary} alarm={saves.refused !== null || (last !== null && !last.ok)}>
  <div class="field">
    <div class="field-head">
      <label class="field-name" for="{id}-command">Install command</label>
      <Save state={saves.of("install")} />
    </div>
    <Input
      id="{id}-command"
      value={repo.install?.command ?? ""}
      placeholder="none: nothing runs after a merge"
      autocomplete="off"
      aria-invalid={saves.invalid("install")}
      aria-busy={saves.busy("install")}
      {@attach fromAction(entered, () => ({ set: repo.install?.command ?? "", save }))}
    />
  </div>
  {#if saves.refused}
    <Refused error={saves.refused.error} help={saves.refused.help} />
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
</Fold>

<style>
  .said {
    font-weight: 600;
  }
  pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--ink-muted);
  }
</style>
