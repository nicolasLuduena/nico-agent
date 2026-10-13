<script lang="ts">
  // A Repo's panel, in the column right of its Project's map: the Dispatch
  // form, then its room, switches and settings, then its removal; headed by
  // its slug when the tab holds more than its own.
  import type { Repo, Status } from "../status";
  import DispatchForm from "./DispatchForm.svelte";
  import { inFlight } from "./launch";
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
    <DispatchForm {repo} {status} />
    <Room {holder} live={inFlight(repo, status.dispatches)} />
    <Switches {holder} />
    <Settings {holder} harnesses={repo.harnesses} {repo} projects={status.projects} />
    <Remove {repo} />
  {/key}
</section>
