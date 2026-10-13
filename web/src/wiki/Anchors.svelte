<script lang="ts">
  // The Anchors a claim cites, each a link to GitHub at the Wiki's commit and
  // lines; the caller lays them out.
  import { anchorUrl, type Anchor, type Wiki } from "./wiki";

  let { wiki, anchors }: { wiki: Wiki; anchors: Anchor[] } = $props();
</script>

{#each anchors as a, n (n)}
  <a href={anchorUrl(wiki, a)} target="_blank" rel="noreferrer">{a.path} <span class="lines">{a.start === a.end ? a.start : `${a.start}–${a.end}`}</span></a>
{/each}

<style>
  a {
    display: inline-flex;
    gap: 4px;
    padding: 0 4px;
    border: 1px solid var(--hairline);
    border-radius: 2px;
    text-decoration: none;
  }
  a:hover {
    border-color: var(--live);
  }
  .lines {
    font-weight: 600;
  }
</style>
