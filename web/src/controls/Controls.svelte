<script lang="ts">
  // #254 owns this file: the Repo's five switches (PATCH
  // /api/repo/<slug>/switches) and the Dispatch form (POST /api/dispatch),
  // in the 320px column right of the map. `repo` and `status` are
  // /api/status's, refetched on every `changed`; extend ../status.ts's types
  // with the fields read (switches, harnesses, implementer...).
  import type { Repo, Status } from "../status";

  let { repo, status }: { repo: Repo; status: Status } = $props();
</script>

<p class="placeholder">Switches and the Dispatch form for {repo.slug} go here.</p>

<style>
  .placeholder {
    color: var(--ink-muted);
  }
</style>
