<script lang="ts">
  // A Repo's panel, in the column right of its Project's map: its Readiness
  // checks, the Dispatch form, then its room, switches, settings, Library
  // links and Install, then its removal; headed by its slug when the tab holds more than its own.
  import type { Repo, Status } from "../status";
  import Checks from "./Checks.svelte";
  import DispatchForm from "./DispatchForm.svelte";
  import Install from "./Install.svelte";
  import { inFlight } from "./launch";
  import Links from "./Links.svelte";
  import Remove from "./Remove.svelte";
  import Room from "./Room.svelte";
  import { patch } from "./send";
  import Settings from "./Settings.svelte";
  import { type Holder, projectOf } from "./settings";
  import Switches from "./Switches.svelte";

  let { repo, status, headed = false }: { repo: Repo; status: Status; headed?: boolean } = $props();

  const holder: Holder = $derived({
    own: "repo",
    settings: repo,
    under: projectOf(repo.slug, status.projects),
    patch: (body) => patch(repo.slug, body),
  });
</script>

<section class="controls" aria-label={repo.slug}>
  <!-- A new Repo starts the panel fresh: no other Repo's picks, saves or refusals. -->
  {#key repo.slug}
    {#if headed}<h2 class="head">{repo.slug}</h2>{/if}
    <Checks {repo} />
    <DispatchForm {repo} {status} />
    <Room {holder} live={inFlight(repo, status.dispatches)} />
    <Switches {holder} />
    <Settings {holder} harnesses={repo.harnesses} {repo} projects={status.projects} />
    <Links {holder} wikis={status.wikis} />
    <Install {repo} />
    <Remove {repo} />
  {/key}
</section>
