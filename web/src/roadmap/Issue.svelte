<script lang="ts">
  // An open Roadmap node's panel (desktop) or bottom sheet (phone): what the
  // Source last said of the issue, and nothing to press but Close and links.
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
    <h3 class="label">{head}</h3>
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

<section class="panel" aria-labelledby="roadmap-title" bind:this={panel}>
  <header class="line">
    <h2 id="roadmap-title" tabindex="-1" bind:this={title}>
      {node.title}
      <a href={node.url} target="_blank" rel="noreferrer">{numbered(node.key, node.repo, project.repos)}</a>
    </h2>
    <button type="button" class="quiet" onclick={close}>Close</button>
  </header>

  <section>
    <h3 class="label">Labels</h3>
    <p class:note={!node.labels.length}>{node.labels.length ? node.labels.join(", ") : "No labels"}</p>
  </section>

  <section>
    <h3 class="label">Assigned</h3>
    <p class:note={!node.assignees.length}>{named(node.assignees).join(", ")}</p>
  </section>

  <section class="body">
    <h3 class="label">Description</h3>
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
  .panel {
    padding: 24px;
    background: var(--surface);
    border-left: 1px solid var(--rule);
    box-shadow: 0 0 0 1px var(--hairline);
    animation: slide 160ms ease-out;
  }
  @keyframes slide {
    from {
      transform: translateX(16px);
    }
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }
  h2 {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  h2 a {
    font-weight: 700;
  }
  section > section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--hairline);
  }
  h3 {
    margin: 0 0 8px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li + li {
    margin-top: 4px;
  }
  /* The issue's own Markdown, wrapped at the panel's measure. */
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
  .note {
    color: var(--ink-muted);
  }

  /* Beside a Roadmap taller than the window, the panel stays in view. */
  @media (width >= 720px) {
    .panel {
      position: sticky;
      top: 0;
      max-height: 100vh;
      overflow-y: auto;
    }
  }

  /* The bottom sheet: up to 85vh, scrolling inside, closed by Close or Escape. */
  @media (width < 720px) {
    .panel {
      position: fixed;
      inset: auto 0 0;
      z-index: 10;
      max-height: 85vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 16px;
      border-left: 0;
      border-top: 1px solid var(--rule);
      animation-name: rise;
    }
    @keyframes rise {
      from {
        transform: translateY(100%);
      }
    }
    header {
      position: sticky;
      top: -16px;
      padding: 8px 0;
      background: var(--surface);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
