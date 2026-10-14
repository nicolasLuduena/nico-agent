<script lang="ts">
  // A Repo's panel, in the column right of its Project's map: the Dispatch
  // form, its one action, then its Readiness, room, switches, settings,
  // Library links and Install, each folded to a line; then its removal. Headed by its slug, on its line colour, when the tab holds more than its own.
  import { repoLine } from "../hues";
  import type { Repo, Status } from "../status";
  import Checks from "./Checks.svelte";
  import DispatchForm from "./DispatchForm.svelte";
  import Install from "./Install.svelte";
  import { inFlight } from "./launch";
  import LibraryLinks from "./LibraryLinks.svelte";
  import Remove from "./Remove.svelte";
  import Room from "./Room.svelte";
  import { patch } from "./send";
  import Settings from "./Settings.svelte";
  import { type Holder, projectOf } from "./settings";
  import Switches from "./Switches.svelte";

  let { repo, status, headed = false }: { repo: Repo; status: Status; headed?: boolean } = $props();

  const holder: Holder = $derived({
    own: "repo",
    panel: `repo ${repo.slug}`,
    settings: repo,
    under: projectOf(repo.slug, status.projects),
    patch: (body) => patch(repo.slug, body),
  });
  const line = $derived(repoLine(repo.slug, holder.under));
</script>

<section class="controls" class:lined={line} style:--line={line} aria-label={repo.slug}>
  <!-- A new Repo starts the panel fresh: no other Repo's picks, saves, refusals or open sections. -->
  {#key repo.slug}
    {#if headed}<h2 class="head">{repo.slug}</h2>{/if}
    <DispatchForm {repo} {status} panel={holder.panel} />
    <Checks {repo} panel={holder.panel} />
    <Room {holder} live={inFlight(repo, status.dispatches)} />
    <Switches {holder} />
    <Settings {holder} harnesses={repo.harnesses} {repo} projects={status.projects} />
    <LibraryLinks {holder} wikis={status.wikis} />
    <Install {repo} panel={holder.panel} />
    <Remove {repo} />
  {/key}
</section>
