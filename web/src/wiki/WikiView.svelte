<script lang="ts">
  // A Project's Wiki view: the Wikis of its Repos and of the Library versions
  // they link, each with where its build stands and a link to its own page,
  // where it is read; and the sheet of what every Wiki is built on, there
  // before any is built too.
  import { onMount } from "svelte";
  import { ticked } from "../controls/Refused.svelte";
  import { watch } from "../live";
  import { page } from "../route";
  import type { Project, WikiSettings } from "../status";
  import { clock } from "../time";
  import SettingsForm from "./SettingsForm.svelte";
  import Sheet from "./Sheet.svelte";
  import type { Listed } from "./wiki";

  let { project, libraries, settings }: { project: Project; libraries: string[]; settings: WikiSettings } = $props();

  let listed = $state<Listed[] | null>(null);
  /** Why the Wikis could not be read; cleared by the next answer. */
  let failure = $state<string | null>(null);
  let opened = $state(false);
  const TITLE = "Settings for every Wiki";

  onMount(() =>
    watch<Listed[]>(
      "/api/wikis",
      (got) => {
        listed = got;
        failure = null;
      },
      (why) => (failure = why),
    ),
  );

  /** The Wikis of its Repos, then of the Library versions they link, by id: each built, or with its first build waiting, running or failed. */
  const wikis = $derived([...project.repos, ...libraries].flatMap((id) => (listed ?? []).filter((w) => w.id === id)));
</script>

<div class="wiki">
  {#if failure}
    <p class="errata" role="status"><strong>{failure}</strong></p>
  {/if}

  <header>
    <button type="button" class="quiet" aria-expanded={opened} aria-controls="wiki-settings" onclick={() => (opened = !opened)}>Wiki settings</button>
  </header>

  {#if listed === null}
    {#if !failure}
      <p class="none">Reading the Wikis…</p>
    {/if}
  {:else if wikis.length === 0}
    <div class="none">
      <p>No Wiki of {project.name} yet. Build one by Repo; it describes the code at the Repo's Base, each claim citing its lines:</p>
      {#each project.repos as slug (slug)}
        <p><code>nico-agent wiki build {slug}</code></p>
      {/each}
    </div>
  {:else}
    <ul class="wikis" aria-label="Wikis">
      {#each wikis as w (w.id)}
        <li>
          <a class="name" href={page(w.id)}>{w.id}</a>
          <p class="stands">
            {#if w.state === "building"}
              <span class="label">Building</span>{#if w.progress}{" "}since {clock(w.progress.at)}{/if}
            {:else if w.state === "queued"}
              <span class="label">Queued</span>
            {/if}
            {#if w.commit && w.builtAt}
              <span>Built {clock(w.builtAt)} · describes {w.commit.slice(0, 7)}</span>
            {:else}
              <span>Not built yet</span>
            {/if}
          </p>
          {#if w.state === "failed"}
            <p class="errata"><strong>Last build failed</strong> {@render ticked(w.why ?? "")}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <Sheet id="wiki-settings" title={TITLE} folded={true} open={opened} close={() => (opened = false)}>
    <SettingsForm {settings} />
  </Sheet>
</div>

<style>
  .wiki {
    display: grid;
    gap: 16px;
    padding: 16px var(--gutter) var(--gutter);
  }
  header {
    display: flex;
    justify-content: flex-end;
  }
  .none {
    display: grid;
    gap: 8px;
    color: var(--ink-muted);
  }
  /* A row per Wiki on a hairline: its name opening its page, then where its build stands. */
  .wikis {
    padding: 0;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  .wikis li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 4px 24px;
    padding: 12px 16px;
  }
  .wikis li + li {
    border-top: 1px solid var(--hairline);
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .stands {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0 12px;
    color: var(--ink-muted);
    text-align: right;
  }
  .stands .label {
    color: var(--ink);
  }
  .errata {
    display: block;
    grid-column: 1 / -1;
  }

  /* Where it stands goes under its name. */
  @media (width < 720px) {
    .wikis li {
      grid-template-columns: minmax(0, 1fr);
    }
    .stands {
      justify-content: flex-start;
      text-align: left;
    }
  }
</style>
