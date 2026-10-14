<script lang="ts">
  // A Project's defaults, above its Repos' panels: its room, switches and
  // settings as its Repos take them where they set none, each folded to a
  // line and written to its `projects.<name>` in config.toml; one it sets
  // goes back to the default.
  import { reload } from "../live";
  import type { Project, Repo } from "../status";
  import Room from "./Room.svelte";
  import { patchProject } from "./send";
  import Settings from "./Settings.svelte";
  import type { Holder } from "./settings";
  import Switches from "./Switches.svelte";

  let { project, harnesses }: { project: Project; harnesses: Repo["harnesses"] } = $props();
  const id = $props.id();

  const holder: Holder = $derived({
    own: "project",
    panel: `project ${project.name}`,
    settings: project,
    under: undefined,
    patch: async (body) => {
      const sent = await patchProject(project.name, body);
      // Its Repos' panels show what they now take from it.
      if (sent.ok) reload();
      return sent;
    },
  });
</script>

<section class="controls" aria-labelledby="{id}-head">
  {#key project.name}
    <div>
      <h2 class="head" id="{id}-head">{project.name}</h2>
      <p>Defaults for its Repos, where they set none</p>
    </div>
    <Room {holder} />
    <Switches {holder} />
    <Settings {holder} {harnesses} />
  {/key}
</section>

<style>
  p {
    color: var(--ink-muted);
  }
</style>
