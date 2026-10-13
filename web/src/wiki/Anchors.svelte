<script lang="ts">
  // The Anchors a claim cites, each set quietly, a link to GitHub at the
  // Wiki's commit and lines: its file by `name`, then its lines, never
  // broken; or its lines alone when the Component says its one file once
  // (`name` null). The full path is in the link, its name and its title.
  import { anchorUrl, type Anchor, type Wiki } from "./wiki";

  let { wiki, anchors, name }: { wiki: Wiki; anchors: Anchor[]; name: ((path: string) => string) | null } = $props();

  const lines = (a: Anchor) => (a.start === a.end ? `${a.start}` : `${a.start}–${a.end}`);
</script>

{#each anchors as a, n (n)}
  {@const word = a.start === a.end ? "line" : "lines"}
  {@const said = name ? `${a.path} ${lines(a)}` : `${a.path} ${word} ${lines(a)}`}
  <a href={anchorUrl(wiki, a)} target="_blank" rel="noreferrer" title={said} aria-label={said}
    >{name ? name(a.path) : word} <span class="lines">{lines(a)}</span></a
  >
{/each}

<style>
  a {
    color: var(--ink-muted);
    white-space: nowrap;
    text-decoration-color: var(--hairline);
  }
  a:hover {
    color: var(--live);
    text-decoration-color: currentColor;
  }
  .lines {
    font-weight: 600;
  }
</style>
