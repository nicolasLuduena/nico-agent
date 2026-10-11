<script lang="ts">
  // #253 owns this file: the Repo's map from /api/map/<repo>, drawn with dagre.
  // Fetch it with `watch` from ../live (refetched on every `changed`); the node
  // to focus and open is `selection.issue` from ../selection.svelte.
  import type { Repo } from "../status";

  let { repo }: { repo: Repo } = $props();
</script>

<div class="field" aria-label="Map of {repo.slug}">
  <p>The map of {repo.slug} draws here.</p>
</div>

<style>
  .field {
    min-height: 60vh;
    height: 100%;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--ink-muted);
  }
</style>
