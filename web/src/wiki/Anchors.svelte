<script lang="ts">
  // The Anchors a claim cites, each a quiet citation linking GitHub at the
  // Wiki's commit and lines: its file by `name`, then its lines, never
  // broken; or its lines alone when the Component says its one file once
  // (`name` null). The full path is in the link, its name and its title.
  import { anchorUrl, type Anchor, type Wiki } from "./wiki";

  let { wiki, anchors, name }: { wiki: Wiki; anchors: Anchor[]; name: ((path: string) => string) | null } = $props();

  const lines = (a: Anchor) => (a.start === a.end ? `${a.start}` : `${a.start}–${a.end}`);
</script>

{#each anchors as a, n (n)}
  {@const shown = name?.(a.path)}
  <a href={anchorUrl(wiki, a)} target="_blank" rel="noreferrer" title="{a.path} {lines(a)}"
    ><span class="hidden">{shown ? a.path.slice(0, -shown.length) : `${a.path} `}</span>{shown ?? (a.start === a.end ? "line" : "lines")}
    <span class="lines">{lines(a)}</span></a
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
  /* The folders the name leaves out, read aloud but not shown. */
  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
