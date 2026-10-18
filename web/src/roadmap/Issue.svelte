<script lang="ts">
  // An open Roadmap node's inspector (desktop) or bottom sheet (phone): what the
  // Source last said of the issue, and nothing to press but Close and links.
  import { Button } from "$lib/components/ui/button/index.js";
  import { onMount } from "svelte";
  import { named } from "../controls/assign";
  import Markdown from "../Markdown.svelte";
  import { number, numbered, type Project } from "../status";
  import type { Link, RoadmapNode } from "./layout";

  let { node, project, close }: { node: RoadmapNode; project: Project; close: () => void } = $props();

  // Focus moves to the title as it opens, and back to the node that opened it as it closes.
  let panel: HTMLElement;
  let title: HTMLElement;
  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    title.focus();
    return () => {
      const at = document.activeElement;
      if (!at || at === document.body || panel.contains(at)) opener?.focus();
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

{#snippet links(head: string, issues: Link[])}
  <section>
    <h3>{head}</h3>
    {#if issues.length}
      <ul>
        {#each issues as i (i.key)}
          <li>
            {#if i.url}<a href={i.url} target="_blank" rel="noreferrer">{number(i.key, node.repo)}</a>{:else}<strong>{number(i.key, node.repo)}</strong>{/if}
            {i.title ?? ""}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="note">None open.</p>
    {/if}
  </section>
{/snippet}

<section class="inspector" aria-labelledby="roadmap-title" bind:this={panel}>
  <header>
    <div class="grip" aria-hidden="true"></div>
    <div class="bar">
      <a class="ref" href={node.url} target="_blank" rel="noreferrer">{numbered(node.key, node.repo, project.repos)}</a>
      <Button variant="outline" onclick={close}>Close</Button>
    </div>
    <h2 id="roadmap-title" tabindex="-1" bind:this={title}>{node.title}</h2>
  </header>

  <section>
    <h3>Labels</h3>
    <p class:note={!node.labels.length}>{node.labels.length ? node.labels.join(", ") : "No labels"}</p>
  </section>

  <section>
    <h3>Assigned</h3>
    <p class:note={!node.assignees.length}>{named(node.assignees).join(", ")}</p>
  </section>

  <section class="body">
    <h3>Description</h3>
    {#if node.body.trim()}
      <Markdown text={node.body} />
    {:else}
      <p class="note">No description.</p>
    {/if}
  </section>

  {@render links("Blocked by", node.blocked_by)}
  {@render links("Blocks", node.blocks)}
</section>

<style>
  .inspector .ref {
    color: var(--accent);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li + li {
    margin-top: 4px;
  }
  /* The issue's own Markdown, wrapped at the inspector's measure. */
  .body {
    display: grid;
    gap: 8px;
    overflow-wrap: anywhere;
  }
  .body :global(ul),
  .body :global(ol) {
    padding-left: 20px;
    list-style: revert;
  }
</style>
